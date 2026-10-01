import { createGameApp } from './app.mjs'
import { migrate } from './migrate.mjs'
import { gameRouter } from './routers.mjs'

for (const name of ['MANUS_PROJECT_ID', 'MANUS_JWT_SECRET', 'MANUS_OAUTH_API_URL', 'MANUS_OAUTH_PORTAL_URL', 'DATABASE_URL']) {
  if (!process.env[name]) throw new Error(`Required Webdev runtime value is missing: ${name}`)
}
const app = createGameApp(gameRouter)
const port = Number(process.env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
// Apply unfinished schema migrations (tracked in schema_migrations) before serving.
await migrate()
app.listen(port, '0.0.0.0')
