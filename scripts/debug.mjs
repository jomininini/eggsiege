// Ad-hoc debug runner: node scripts/debug.mjs <steps.json-ish js file>
// The file exports `async function run(page, h)` where h has wait/shot/ev helpers.
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'

const url = process.env.URL ?? 'http://localhost:3000/'
const mod = await import(pathToFileURL(process.argv[2]).href)
const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
const browser = await chromium.launch({ args })
const page = await (await browser.newContext({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, locale: 'zh-CN' })).newPage()
const errors = []
page.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', e => errors.push(String(e.stack ?? e)))
await page.addInitScript(q => { if (q && !localStorage.getItem('eggsiege.save')) localStorage.setItem('eggsiege.save', JSON.stringify({ version: 2, musicVolume: 0.5, sfxVolume: 0.8, muted: false, sensitivity: 1, invertY: false, quality: q, wins: 0, matches: 0, bestKills: 0 })) }, process.env.QUALITY ?? 'low')
await page.goto(url)
await page.waitForSelector('.screen.title.on', { timeout: 60_000 })
const h = {
  wait: ms => new Promise(r => setTimeout(r, ms)),
  shot: name => page.screenshot({ path: `shots/${name}.png` }),
  ev: (fn, arg) => page.evaluate(fn, arg),
  start: async () => {
    await page.click('[data-a=play]')
    await page.waitForSelector('.screen.hud.on')
    await page.evaluate(() => { window.__game.input.freeLook = true })
  },
}
try {
  await mod.run(page, h)
} catch (e) {
  console.error('debug: error', e)
}
if (errors.length) console.log('page errors:\n' + errors.slice(0, 10).join('\n'))
await browser.close()
