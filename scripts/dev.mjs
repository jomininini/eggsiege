// Development entry: runs the login/profile API (server/index.mjs) on API_PORT (default 3001)
// next to Vite, which proxies /api to it. Without database/OAuth env the API is skipped and the
// game runs in offline mode (local saves only).
import { spawn } from 'node:child_process'

const apiPort = process.env.API_PORT ?? '3001'
const children = []
const required = ['MANUS_PROJECT_ID', 'MANUS_JWT_SECRET', 'MANUS_OAUTH_API_URL', 'MANUS_OAUTH_PORTAL_URL', 'DATABASE_URL']
const missing = required.filter(k => !process.env[k])

if (missing.length) {
  console.warn(`[dev] API disabled (missing ${missing.join(', ')}); game runs offline.`)
} else {
  children.push(spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: apiPort, NODE_ENV: 'development' } }))
}
children.push(spawn('npx', ['vite'], { stdio: 'inherit', env: { ...process.env, API_PORT: apiPort } }))

const stop = () => {
  for (const c of children) c.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const c of children) c.on('exit', code => {
  stop()
  process.exitCode = code ?? 0
})
