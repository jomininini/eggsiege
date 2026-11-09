// Development entry: Vite owns preview availability; the account API is optional.
// An API crash must not take down offline gameplay. Production still fails fast on DB errors.
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function startDev({ env = process.env, spawnChild = spawn, log = console, onFatal = code => { process.exitCode = code } } = {}) {
  const apiPort = env.API_PORT ?? '3001'
  const required = ['MANUS_PROJECT_ID', 'MANUS_JWT_SECRET', 'MANUS_OAUTH_API_URL', 'MANUS_OAUTH_PORTAL_URL', 'DATABASE_URL']
  const missing = required.filter(k => !env[k])
  let stopping = false
  let api
  let vite

  const stop = () => {
    if (stopping) return
    stopping = true
    api?.kill('SIGTERM')
    vite?.kill('SIGTERM')
  }
  const apiUnavailable = message => {
    if (!stopping) log.warn(`[dev] Account API ${message}; preview stays online with local saves. Restore project credentials and restart pnpm dev to reconnect.`)
  }

  if (missing.length) {
    log.warn(`[dev] API disabled (missing ${missing.join(', ')}); game runs offline.`)
  } else {
    api = spawnChild(process.execPath, ['server/index.mjs'], {
      stdio: 'inherit', env: { ...env, PORT: apiPort, NODE_ENV: 'development' },
    })
    api.on('error', error => apiUnavailable(`could not start: ${error.message}`))
    api.on('exit', (code, signal) => apiUnavailable(`stopped (${signal ?? code})`))
  }

  // Launch the installed Vite entry directly: no npx download or intermediary process.
  vite = spawnChild(process.execPath, ['node_modules/vite/bin/vite.js'], {
    stdio: 'inherit', env: { ...env, API_PORT: apiPort },
  })
  const fatal = code => {
    if (stopping) return
    onFatal(code)
    stop()
  }
  vite.on('error', error => {
    log.error(`[dev] Vite could not start: ${error.message}`)
    fatal(1)
  })
  vite.on('exit', (code, signal) => {
    if (stopping) return
    log.error(`[dev] Vite stopped (${signal ?? code}).`)
    fatal(code ?? 1)
  })
  return { stop }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { stop } = startDev()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
