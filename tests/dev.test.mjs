import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { startDev } from '../scripts/dev.mjs'

function fixture(online = true) {
  const children = []
  const spawnChild = vi.fn(() => {
    const child = new EventEmitter()
    child.kill = vi.fn(() => child.emit('exit', null, 'SIGTERM'))
    children.push(child)
    return child
  })
  const env = online ? Object.fromEntries(['MANUS_PROJECT_ID', 'MANUS_JWT_SECRET', 'MANUS_OAUTH_API_URL', 'MANUS_OAUTH_PORTAL_URL', 'DATABASE_URL'].map(k => [k, 'test-only'])) : {}
  const onFatal = vi.fn()
  const log = { warn: vi.fn(), error: vi.fn() }
  const controller = startDev({ env, spawnChild, onFatal, log })
  return { children, spawnChild, onFatal, log, controller }
}

describe('preview process supervision', () => {
  it('keeps Vite running when the account API exits with a DB failure', () => {
    const f = fixture()
    f.children[0].emit('exit', 1, null)
    expect(f.children[1].kill).not.toHaveBeenCalled()
    expect(f.onFatal).not.toHaveBeenCalled()
    expect(f.log.warn).toHaveBeenCalledWith(expect.stringContaining('preview stays online'))
  })
  it('keeps Vite running when the API cannot spawn', () => {
    const f = fixture()
    f.children[0].emit('error', new Error('missing backend dependency'))
    expect(f.children[1].kill).not.toHaveBeenCalled()
    expect(f.onFatal).not.toHaveBeenCalled()
  })
  it('starts only Vite when account environment is absent', () => {
    const f = fixture(false)
    expect(f.children).toHaveLength(1)
    expect(f.spawnChild.mock.calls[0][1]).toEqual(['node_modules/vite/bin/vite.js'])
  })
  it('preserves the Vite failure code during cleanup', () => {
    const f = fixture()
    f.children[1].emit('exit', 7, null)
    expect(f.onFatal).toHaveBeenCalledExactlyOnceWith(7)
    expect(f.children[0].kill).toHaveBeenCalledOnce()
  })
  it('handles Vite spawn errors as fatal', () => {
    const f = fixture()
    f.children[1].emit('error', new Error('spawn failure'))
    expect(f.onFatal).toHaveBeenCalledExactlyOnceWith(1)
  })
  it('explicit shutdown is idempotent and does not report child SIGTERM as a failure', () => {
    const f = fixture()
    f.controller.stop()
    f.controller.stop()
    expect(f.children[0].kill).toHaveBeenCalledOnce()
    expect(f.children[1].kill).toHaveBeenCalledOnce()
    expect(f.onFatal).not.toHaveBeenCalled()
  })
})
