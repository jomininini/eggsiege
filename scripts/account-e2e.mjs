// End-to-end test of player login + cloud profile against the running dev server (pnpm dev).
// It creates a throwaway test user in the managed database, signs a session cookie with the
// project's MANUS_JWT_SECRET (the same token shape the OAuth callback issues), drives the real UI
// in two separate browser contexts ("devices"), checks the database, and removes its test rows.
// Usage: node scripts/account-e2e.mjs   (needs DATABASE_URL, MANUS_JWT_SECRET, MANUS_PROJECT_ID)
import { chromium } from 'playwright'
import { SignJWT } from '../server/node_modules/jose/dist/webapi/index.js'
import mysql from '../server/node_modules/mysql2/promise.js'

const URL_ = process.env.URL ?? 'http://localhost:3000/'
const OPEN_ID = 'e2e_eggsiege_tester'
const NAME = 'E2E 测试员'
const SAVE_KEY = 'eggsiege.save'
const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
const log = (...a) => console.log('[account-e2e]', ...a)
const fail = msg => {
  throw new Error(msg)
}
const wait = ms => new Promise(r => setTimeout(r, ms))

const db = await mysql.createConnection(process.env.DATABASE_URL)
const cleanup = async () => {
  const [u] = await db.query('SELECT id FROM users WHERE openId = ?', [OPEN_ID])
  for (const r of u) {
    await db.query('DELETE FROM match_records WHERE userId = ?', [r.id])
    await db.query('DELETE FROM player_profiles WHERE userId = ?', [r.id])
  }
  await db.query('DELETE FROM users WHERE openId = ?', [OPEN_ID])
}
const profile = async uid => (await db.query('SELECT * FROM player_profiles WHERE userId = ?', [uid]))[0][0]

const browser = await chromium.launch({ args })
const errors = []
async function device(name, { cookie, local }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' })
  if (cookie) await ctx.addCookies([{ name: 'webdev_app_session', value: cookie, url: URL_, httpOnly: true, sameSite: 'Lax' }])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${name}: ${e}`))
  await page.addInitScript(([k, v]) => {
    try {
      if (v && !localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(v))
    } catch {
      // Not the game origin (e.g. the aborted OAuth navigation).
    }
  }, [SAVE_KEY, local])
  await page.goto(URL_)
  await page.waitForSelector('.screen.title.on', { timeout: 60_000 })
  return { ctx, page }
}
const baseLocal = { version: 2, musicVolume: 0.5, sfxVolume: 0.8, muted: false, sensitivity: 1, invertY: false, quality: 'low', lang: 'zh', mode: 'standard', perTeam: 6, difficulty: 'normal' }

let ok = false
try {
  await cleanup()
  await db.query('INSERT INTO users (openId, name, loginMethod) VALUES (?, ?, ?)', [OPEN_ID, NAME, 'e2e'])
  const [[user]] = await db.query('SELECT id FROM users WHERE openId = ?', [OPEN_ID])
  const secret = new TextEncoder().encode(process.env.MANUS_JWT_SECRET)
  const token = await new SignJWT({ openId: OPEN_ID, appId: process.env.MANUS_PROJECT_ID, name: NAME })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setExpirationTime('2h')
    .sign(secret)

  // 1. Logged out: sign-in card, and the button starts the real Manus OAuth redirect.
  {
    const { ctx, page } = await device('anon', { local: baseLocal })
    await page.waitForSelector('.acct [data-a=login]', { timeout: 20_000 })
    await page.screenshot({ path: 'shots/30-acct-logged-out.png' })
    let authUrl = ''
    await page.route(/\/app-auth\b/, r => {
      authUrl = r.request().url()
      return r.abort()
    })
    await page.click('.acct [data-a=login]')
    for (let i = 0; i < 40 && !authUrl; i++) await wait(250)
    const u = new URL(authUrl || 'http://x/')
    if (!authUrl || u.searchParams.get('responseType') !== 'code' || !u.searchParams.get('redirectUri')?.endsWith('/api/oauth/callback')) fail(`login did not redirect to OAuth portal (${authUrl})`)
    log('logged-out card + OAuth redirect OK →', u.origin + u.pathname)
    await ctx.close()
  }

  // 2. Device 1, first login: profile created from local settings, local career imported once.
  const d1 = await device('device1', { cookie: token, local: { ...baseLocal, matches: 3, wins: 2, bestKills: 7 } })
  await d1.page.waitForSelector('.acct .acct-id', { timeout: 30_000 })
  const card = await d1.page.textContent('.acct')
  if (!card.includes(NAME)) fail(`account card missing callsign: ${card}`)
  let p = await profile(user.id)
  if (!p || p.matches !== 3 || p.wins !== 2 || p.bestKills !== 7 || !p.importedLocal) fail(`local import wrong: ${JSON.stringify(p)}`)
  log('first login: profile created, local career imported (3 matches / 2 wins / best 7)')

  // Settings change syncs to the cloud (debounced).
  await d1.page.click('[data-diff=hard]')
  await d1.page.click('[data-mode=sea]')
  await wait(3000)
  p = await profile(user.id)
  const st = typeof p.settings === 'string' ? JSON.parse(p.settings) : p.settings
  if (st.difficulty !== 'hard' || st.mode !== 'sea') fail(`settings not synced: ${JSON.stringify(st)}`)
  log('settings synced to cloud (difficulty=hard, mode=sea)')

  // Callsign edit.
  await d1.page.click('.acct [data-a=profile]')
  await d1.page.waitForSelector('.profile-m.on form.cs')
  await d1.page.fill('.profile-m form.cs input', '金蛋猎手')
  await d1.page.click('.profile-m form.cs button')
  await wait(1500)
  p = await profile(user.id)
  if (p.callsign !== '金蛋猎手') fail(`callsign not saved: ${p.callsign}`)
  await d1.page.screenshot({ path: 'shots/31-service-record.png' })
  await d1.page.click('.profile-m [data-a=pclose]')
  log('callsign saved')

  // Play a match to the end: the result uploads, XP is awarded server-side.
  await d1.page.click('[data-a=play]')
  await d1.page.waitForSelector('.screen.hud.on')
  await d1.page.evaluate(() => {
    const w = window.__game
    w.input.freeLook = true
    const g = w.game
    g.match.timeLeft -= 95
    g.match.scores[0] = 998
    g.match.points.forEach(pt => {
      pt.owner = 0
      pt.progress = 1
    })
  })
  await d1.page.waitForSelector('.screen.end.on', { timeout: 90_000 })
  await d1.page.waitForFunction(() => document.querySelector('.end-sync')?.textContent?.includes('XP'), null, { timeout: 30_000 })
  const syncLine = await d1.page.textContent('.end-sync')
  await d1.page.screenshot({ path: 'shots/32-end-synced.png' })
  const [recs] = await db.query('SELECT * FROM match_records WHERE userId = ?', [user.id])
  p = await profile(user.id)
  if (recs.length !== 1 || recs[0].result !== 'win' || recs[0].mode !== 'sea' || recs[0].difficulty !== 'hard' || p.matches !== 4 || p.xp <= 0) fail(`match not recorded: ${JSON.stringify({ recs, p })}`)
  log(`match recorded: "${syncLine.trim()}" · xp=${p.xp} · duration=${recs[0].durationSec}s`)
  await d1.ctx.close()

  // 3. Device 2 (fresh storage, different local defaults): cloud settings + records restored.
  const d2 = await device('device2', { cookie: token, local: { ...baseLocal, lang: 'zh', difficulty: 'easy', mode: 'standard' } })
  await d2.page.waitForSelector('.acct .acct-id', { timeout: 30_000 })
  await d2.page.waitForFunction(() => window.__game?.account?.profile?.matches === 4, null, { timeout: 20_000 })
  const restored = await d2.page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('eggsiege.save') ?? '{}')
    return { diff: raw.difficulty, mode: raw.mode, diffOn: document.querySelector('[data-diff].on')?.getAttribute('data-diff'), career: document.querySelector('.career')?.textContent, callsign: document.querySelector('.acct-id b')?.textContent }
  })
  if (restored.diff !== 'hard' || restored.mode !== 'sea' || restored.diffOn !== 'hard' || !restored.career?.includes('4') || restored.callsign !== '金蛋猎手') fail(`device 2 not restored: ${JSON.stringify(restored)}`)
  await d2.page.click('.acct [data-a=profile]')
  await d2.page.waitForSelector('.profile-m.on .rrow:not(.h)')
  const rows = await d2.page.$$eval('.profile-m .rrow:not(.h)', r => r.length)
  if (rows !== 1) fail(`device 2 history rows = ${rows}`)
  await d2.page.screenshot({ path: 'shots/33-device2-record.png' })
  log('device 2: settings, callsign, career and match history restored from the cloud')

  // English UI renders the profile too.
  await d2.page.click('.profile-m [data-a=pclose]')
  await d2.page.click('.brief [data-lang=en]')
  await d2.page.waitForFunction(() => document.querySelector('.acct')?.textContent?.includes('Service record'))
  await d2.page.click('.acct [data-a=profile]')
  await d2.page.waitForSelector('.profile-m.on .rrow:not(.h)')
  await d2.page.screenshot({ path: 'shots/34-service-record-en.png' })

  // 4. Sign out returns to the sign-in card.
  await d2.page.click('.profile-m [data-a=logout]')
  await d2.page.waitForSelector('.acct [data-a=login]', { timeout: 15_000 })
  log('sign out OK')
  await d2.ctx.close()
  if (errors.length) fail(`page errors:\n${errors.join('\n')}`)
  ok = true
} catch (e) {
  console.error('[account-e2e] FAIL:', e.message)
  process.exitCode = 1
} finally {
  await cleanup().catch(e => console.error('cleanup failed', e))
  await db.end()
  await browser.close()
  if (ok) log('PASS (test rows removed)')
}
