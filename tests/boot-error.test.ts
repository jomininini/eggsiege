import { describe, expect, it } from 'vitest'
import { bootErrorMessage } from '../src/engine/boot-error'

describe('startup error messages', () => {
  it('explains WebGL initialization failures', () => {
    const m = bootErrorMessage(new Error('Error creating WebGL context.'), true)
    expect(m.hint).toContain('hardware acceleration')
    expect(m.detail).toBe('Error creating WebGL context.')
  })
  it('offers a reload action for module loading failures', () => {
    const m = bootErrorMessage(new Error('Failed to fetch dynamically imported module'), true)
    expect(m.hint).toContain('connection')
    expect(m.reload).toBe('Reload game')
  })
  it('provides a Chinese message in the default language', () => {
    expect(bootErrorMessage('network unavailable', false).title).toBe('游戏暂时无法启动')
  })
})
