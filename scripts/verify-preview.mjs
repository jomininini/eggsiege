// Focused startup verification, no account writes or production data changes.
// Usage: node scripts/verify-preview.mjs [URL]
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://localhost:3000/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const errors = []
const networkErrors = []
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
await context.addInitScript(() => localStorage.setItem('eggsiege.save', JSON.stringify({ version: 2, quality: 'low', muted: true, lang: 'en', mode: 'standard', perTeam: 6, difficulty: 'normal' })))
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text())
})
page.on('response', response => {
  if (response.status() >= 400) networkErrors.push({ url: response.url(), status: response.status() })
})
const results = []
try {
  await page.goto(url)
  await page.waitForSelector('.screen.title.on', { timeout: 90_000 })
  assert.equal(await page.evaluate(() => !!window.__game), true)
  for (const mode of ['standard', 'sea']) {
    await page.click(`[data-mode=${mode}]`)
    await page.click('[data-a=play]')
    await page.waitForSelector('.screen.hud.on', { timeout: 90_000 })
    await page.evaluate(() => { window.__game.input.freeLook = true })
    await page.waitForFunction(() => window.__game.game.time > 0.3, null, { timeout: 90_000 })
    const before = await page.evaluate(() => {
      const g = window.__game.game
      return { x: g.player.pos.x, z: g.player.pos.z, shots: g.player.shots }
    })
    await page.keyboard.down('w')
    await page.mouse.down()
    await page.waitForFunction(pos => {
      const p = window.__game.game.player.pos
      return Math.hypot(p.x - pos.x, p.z - pos.z) > 1
    }, before, { timeout: 90_000 })
    await page.waitForFunction(shots => window.__game.game.player.shots > shots, before.shots, { timeout: 30_000 })
    await page.mouse.up()
    await page.keyboard.up('w')
    const result = await page.evaluate(() => {
      const g = window.__game.game
      return { state: g.state, time: g.time, shots: g.player.shots, hp: g.player.hp, bots: g.bots.length, screen: window.__game.ui.screen, contextLost: g.renderer.gl.getContext().isContextLost(), triangles: g.renderer.gl.info.render.triangles }
    })
    assert.equal(result.state, 'playing')
    assert.ok(result.shots > before.shots, 'player can fire')
    assert.equal(result.contextLost, false)
    assert.ok(result.triangles > 0, 'WebGL renders geometry')
    results.push({ mode, ...result })
    await mkdir('shots', { recursive: true })
    await page.screenshot({ path: `shots/repair-${mode}.png` })
    await page.keyboard.press('p')
    await page.waitForSelector('.screen.pause.on')
    await page.click('.screen.pause [data-a=quit]')
    await page.waitForSelector('.screen.title.on')
  }
  assert.deepEqual(errors, [], 'no JavaScript or engine errors')
  const assetErrors = networkErrors.filter(e => !new URL(e.url).pathname.startsWith('/api/'))
  assert.deepEqual(assetErrors, [], 'no failed game asset requests')
  const report = { passed: true, results, errors, networkErrors, accountStatus: await page.evaluate(() => window.__game.account.status) }
  await writeFile('/tmp/eggsiege-preview-verification.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  const state = await page.evaluate(() => {
    const w = window.__game
    return w ? { state: w.game.state, time: w.game.time, screen: w.ui.screen, shots: w.game.player.shots, mag: w.game.player.mag, nextFire: w.game.player.nextFire, reloadUntil: w.game.player.reloadUntil, active: w.input.active, captured: w.input.captured(), fire: w.input.held('fire'), hp: w.game.player.hp } : { initialized: false }
  }).catch(() => null)
  console.error(JSON.stringify({ errors, networkErrors, state }, null, 2))
  throw error
} finally {
  await browser.close()
}
