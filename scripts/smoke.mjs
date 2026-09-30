// End-to-end smoke test. By default serves dist/ (run `pnpm build` first); set SMOKE_URL to test a
// running dev server instead. Boots the game in headless Chromium, drives every major system,
// fails on any console error, and writes screenshots to ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const external = process.env.SMOKE_URL
const port = 4300 + Math.floor(Math.random() * 500)
const url = external ?? `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })
const server = external ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
let browser
const errors = []
const guard = setTimeout(() => fail('timed out'), 600_000)
function cleanup() {
  clearTimeout(guard)
  try { server?.kill('SIGTERM') } catch {}
}
async function fail(msg) {
  console.error(`smoke: FAIL — ${msg}`)
  if (errors.length) console.error('page errors:\n' + errors.slice(0, 8).join('\n'))
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}
async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('server did not start')
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('smoke:', ...a)
let page
/** Wait until the simulation clock advanced by `sec` seconds (software GPUs render slowly). */
async function sim(sec) {
  const t0 = await page.evaluate(() => window.__game.game.time)
  for (let i = 0; i < 600; i += 1) {
    await wait(100)
    const t = await page.evaluate(() => window.__game.game.time)
    if (t - t0 >= sec) return
  }
}
async function hold(key, sec) {
  await page.keyboard.down(key)
  await sim(sec)
  await page.keyboard.up(key)
}
async function press(key) {
  await page.keyboard.press(key)
  await sim(0.15)
}

try {
  await waitForServer()
  const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' })
  page = await ctx.newPage()
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`))
  await page.addInitScript(q => { if (q && !localStorage.getItem('eggsiege.save')) localStorage.setItem('eggsiege.save', JSON.stringify({ version: 2, musicVolume: 0.5, sfxVolume: 0.8, muted: false, sensitivity: 1, invertY: false, quality: q, wins: 0, matches: 0, bestKills: 0 })) }, process.env.QUALITY ?? 'low')
  await page.goto(url)
  await page.waitForSelector('.screen.title.on', { timeout: 60_000 })
  await wait(2500)
  await page.screenshot({ path: `${out}/01-title.png` })
  await page.click('[data-a=howto]')
  await wait(300)
  await page.screenshot({ path: `${out}/02-howto.png` })
  await page.click('.howto [data-a=close]')

  const st = () => page.evaluate(() => {
    const { game } = window.__game
    const p = game.player
    return { state: game.state, mode: p.mode, time: game.time, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, shots: p.shots, mag: p.mag, hp: p.hp, scores: [...game.match.scores], prompt: game.prompt }
  })
  await page.click('[data-a=play]')
  await page.waitForSelector('.screen.hud.on')
  // Headless pointer lock is unreliable: use the free-look fallback the game supports.
  await page.evaluate(() => { window.__game.input.freeLook = true })
  const before = await st()
  await page.keyboard.down('KeyW')
  await sim(1.2)
  await page.keyboard.press('Space')
  await sim(0.6)
  await page.keyboard.up('KeyW')
  const after = await st()
  const moved = Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z)
  log('moved', moved.toFixed(2), 'time', after.time.toFixed(1))
  if (after.state !== 'playing') throw new Error(`expected playing, got ${after.state}`)
  if (moved < 3) throw new Error(`player barely moved (${moved.toFixed(2)} m)`)
  await page.mouse.move(640, 360)
  await page.mouse.down()
  await sim(0.6)
  await page.mouse.up()
  const fired = await st()
  log('shots', fired.shots, 'mag', fired.mag)
  if (fired.shots < 3) throw new Error('weapon did not fire')
  await page.screenshot({ path: `${out}/03-gameplay.png` })

  // Egg plaza view.
  await page.evaluate(() => { const g = window.__game.game; g.debugTeleport(0, 30); g.player.yaw = 0; g.player.pitch = 0.3 })
  await sim(0.3)
  await page.screenshot({ path: `${out}/04-egg.png` })

  // Vehicle.
  await page.evaluate(() => { const g = window.__game.game; const v = g.vehicles[0]; g.debugTeleport(v.pos.x + 2.5, v.pos.z) })
  await sim(0.2)
  await press('KeyE')
  if ((await st()).mode !== 'vehicle') throw new Error('did not enter vehicle: ' + (await st()).prompt)
  await hold('KeyW', 1.8)
  await page.screenshot({ path: `${out}/05-vehicle.png` })
  await press('KeyE')
  { const s2 = await st(); if (s2.mode !== 'foot') throw new Error('did not exit vehicle: ' + JSON.stringify(s2)) }

  // Boat.
  await page.evaluate(() => { const g = window.__game.game; const v = g.vehicles.find(v => v.kind === 'boat' && v.team === 0); g.debugTeleport(v.pos.x + 2.6, v.pos.z, -1.55) })
  await sim(0.3)
  await press('KeyE')
  const boat = await st()
  log('boat mode', boat.mode, boat.prompt)
  if (boat.mode === 'vehicle') {
    await hold('KeyW', 2.5)
    await page.screenshot({ path: `${out}/06-boat.png` })
    await press('KeyE')
  }

  // Drone.
  await page.evaluate(() => { const { game, map } = window.__game; const d = map.DRONE_PADS[0]; game.debugTeleport(d.x, d.z, d.y) })
  await sim(0.3)
  await press('KeyE')
  await sim(1.2)
  const dr = await st()
  log('drone', dr.mode, dr.prompt)
  if (dr.mode !== 'drone') throw new Error('drone did not launch: ' + dr.prompt)
  await hold('KeyW', 1.5)
  await page.screenshot({ path: `${out}/07-drone.png` })
  await press('KeyE')

  // Helicopter insert.
  await page.evaluate(() => { const { game, map } = window.__game; const h = map.HELIPADS[0]; game.debugTeleport(h.x + 3, h.z, 0) })
  await sim(0.3)
  await press('KeyE')
  await press('Digit3')
  await sim(6)
  const hs = await st()
  log('heli', hs.mode, hs.pos.y.toFixed(1), hs.prompt)
  if (hs.mode !== 'heli') throw new Error('did not board helicopter: ' + hs.prompt)
  await page.screenshot({ path: `${out}/08-heli.png` })
  await press('KeyE')
  await sim(2.5)

  // Scoreboard + pause.
  await page.keyboard.down('Tab')
  await wait(300)
  await page.screenshot({ path: `${out}/09-board.png` })
  await page.keyboard.up('Tab')
  await page.keyboard.press('KeyP')
  await page.waitForSelector('.screen.pause.on')
  await page.screenshot({ path: `${out}/10-pause.png` })
  await page.click('[data-a=resume]')
  await page.waitForSelector('.screen.hud.on')

  // Force a win by score.
  await page.evaluate(() => { const g = window.__game.game; g.match.scores[0] = 998; g.match.points.forEach(p => { p.owner = 0; p.progress = 1 }) })
  await page.waitForSelector('.screen.end.on', { timeout: 60_000 })
  await wait(500)
  await page.screenshot({ path: `${out}/11-end.png` })
  await page.click('.end [data-a=restart]')
  await page.waitForSelector('.screen.hud.on')
  const re = await st()
  if (re.state !== 'playing' || re.scores[0] > 5) throw new Error('restart did not reset the match')

  // Let the AI play for a while to catch runtime errors.
  await page.evaluate(() => { window.__game.game.player.spawnShieldUntil = 1e9 })
  await sim(15)
  const late = await page.evaluate(() => {
    const g = window.__game.game
    return { owners: g.match.points.map(p => p.owner), kills: [...g.match.kills], scores: g.match.scores.map(Math.floor) }
  })
  log('after AI run', JSON.stringify(late))

  // ── Sea mode + English UI + options ──────────────────────────────────────
  await page.keyboard.press('KeyP')
  await page.waitForSelector('.screen.pause.on')
  await page.click('.pause [data-a=quit]')
  await page.waitForSelector('.screen.title.on')
  await page.click('.title .brief [data-lang=en]')
  await wait(400)
  await page.click('[data-mode=sea]')
  await page.click('[data-diff=easy]')
  await page.evaluate(() => { const r = document.querySelector('[data-o=perTeam]'); r.value = '4'; r.dispatchEvent(new Event('input')) })
  await wait(300)
  await page.screenshot({ path: `${out}/13-title-en.png` })
  if (!(await page.textContent('[data-a=play]')).includes('Deploy')) throw new Error('language switch did not apply')
  await page.click('[data-a=play]')
  await page.waitForSelector('.screen.hud.on')
  await page.evaluate(() => { window.__game.input.freeLook = true; window.__game.game.player.spawnShieldUntil = 1e9 })
  const opts = await page.evaluate(() => { const g = window.__game.game; return { units: g.units.length, isleChip: getComputedStyle(document.querySelectorAll('.chip')[window.__game.map.ISLAND_POINT]).display } })
  log('sea options', JSON.stringify(opts))
  if (opts.units !== 8 || opts.isleChip === 'none') throw new Error('sea mode options not applied')
  // Hand the island to red and walk up to the AA gun.
  await page.evaluate(() => {
    const { game, map } = window.__game
    const s = game.match.points[map.ISLAND_POINT]
    s.owner = 0; s.progress = 1
    for (const b of game.bots) if (b.team === 1 && map.inIsland(b.pos.x, b.pos.z, 4)) { b.alive = false; b.respawnAt = 1e9 }
  })
  await sim(0.5)
  await page.evaluate(() => { const { game, map } = window.__game; const e = map.EMPLACEMENTS[0]; game.debugTeleport(e.x + 2.4, e.z, 0.4) })
  await sim(0.4)
  await press('KeyE')
  if ((await st()).mode !== 'aa') throw new Error('could not man the AA gun: ' + (await st()).prompt)
  await page.mouse.down()
  await sim(0.8)
  await page.mouse.up()
  await press('KeyF')
  const aa = await page.evaluate(() => window.__game.game.seatStatus())
  log('aa', JSON.stringify({ lock: aa.lockMode, hp: aa.hp }))
  if (!aa.lockMode) throw new Error('AA lock mode did not toggle')
  await page.screenshot({ path: `${out}/14-aa.png` })
  await press('KeyE')
  // Rocket artillery salvo on the park.
  await page.evaluate(() => { const { game, map } = window.__game; const e = map.EMPLACEMENTS[2]; game.debugTeleport(e.x + 4, e.z, 0.4) })
  await sim(0.4)
  await press('KeyE')
  if ((await st()).mode !== 'arty') throw new Error('could not operate the rocket battery: ' + (await st()).prompt)
  await hold('KeyW', 1)
  await page.mouse.down()
  await sim(0.2)
  await page.mouse.up()
  await sim(1.5)
  await page.screenshot({ path: `${out}/15-arty.png` })
  await sim(3.5)
  const arty = await page.evaluate(() => { const g = window.__game.game; return { strikes: g.strikes.length, salvo: g.emps[2].salvoLeft, ready: g.emps[2].readyAt - g.time } })
  log('arty', JSON.stringify(arty))
  if (arty.ready <= 0) throw new Error('salvo did not fire')
  await press('KeyE')
  // Flyfish-2: lock on to an enemy car and hit it.
  const tgt = await page.evaluate(() => {
    const g = window.__game.game
    const v = g.vehicles.find(v => v.kind === 'car' && v.team === 1 && !v.driver)
    g.debugTeleport(v.pos.x - 30, v.pos.z, 0)
    const p = g.player
    p.yaw = Math.atan2(-(v.pos.x - p.pos.x), -(v.pos.z - p.pos.z))
    p.pitch = -0.03
    return { hp: v.hp, i: g.vehicles.indexOf(v) }
  })
  await sim(0.3)
  await press('KeyQ')
  await sim(0.6)
  await page.mouse.down({ button: 'right' })
  await page.evaluate(i => { const g = window.__game.game; const v = g.vehicles[i]; const p = g.player; p.yaw = Math.atan2(-(v.pos.x - p.pos.x), -(v.pos.z - p.pos.z)); p.pitch = -0.03 }, tgt.i)
  await sim(1.6)
  const lk = await page.evaluate(() => ({ w: window.__game.game.player.weapon, k: window.__game.game.player.lockT }))
  log('lock', JSON.stringify(lk))
  await page.screenshot({ path: `${out}/16-lock.png` })
  if (lk.w !== 'launcher' || lk.k < 0.7) throw new Error('missile did not lock: ' + JSON.stringify(lk))
  await page.mouse.down()
  await sim(0.1)
  await page.mouse.up()
  await page.mouse.up({ button: 'right' })
  await sim(2.5)
  const hitCar = await page.evaluate(i => window.__game.game.vehicles[i].hp, tgt.i)
  log('missile', tgt.hp, '->', hitCar)
  if (!(hitCar < tgt.hp)) throw new Error('guided missile did not damage the car')
  // Island respawn option.
  await page.evaluate(() => { const { game, map } = window.__game; for (const b of game.bots) if (b.team === 1 && map.inIsland(b.pos.x, b.pos.z, 30)) { b.alive = false; b.respawnAt = 1e9; b.ride = null } const s = game.match.points[map.ISLAND_POINT]; s.owner = 0; s.progress = 1 })
  await page.evaluate(() => { const g = window.__game.game; g.player.spawnShieldUntil = 0; g.damageUnit(g.player, 999, { team: 1, name: 'test' }, false, g.player.pos) })
  await sim(0.3)
  await press('Digit2')
  const rs = await page.evaluate(() => ({ avail: window.__game.game.islandRespawnAvailable, pick: window.__game.game.respawnIsland }))
  log('respawn', JSON.stringify(rs))
  if (!rs.avail || !rs.pick) throw new Error('island respawn not selectable')
  await sim(6)
  const rp = await st()
  if (rp.pos.z > -100) throw new Error('did not respawn on the island')
  await page.screenshot({ path: `${out}/17-island.png` })
  await page.evaluate(() => { window.__game.game.player.spawnShieldUntil = 1e9 })
  await sim(10)
  await page.setViewportSize({ width: 900, height: 600 })
  await wait(500)
  await page.screenshot({ path: `${out}/12-small.png` })
  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`)
  log('PASS')
  await browser.close()
  cleanup()
  process.exit(0)
} catch (e) {
  await fail(e instanceof Error ? e.message : String(e))
}
