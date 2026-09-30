import * as THREE from 'three'
import type { Audio, Sfx } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { Bot, type BotHost } from './bots'
import { CONFIG, PLAYER_TEAM, TEAM_SHORT } from './config'
import { Drone } from './drone'
import { Fx } from './fx'
import { Heli, type HeliHost } from './heli'
import { BASES, BOAT_SPAWNS, CAR_SPAWNS, DRONE_PADS, EGG, HELIPADS, POINTS, SHORE_Z, SKILLS, STATIONS, WATER_Y, heliTargets, type SkillId } from './map'
import { NavGrid } from './nav'
import { Player, ViewModel } from './player'
import { addKill, createMatch, eggIndex, stepPoint, tickMatch, type EndReason, type MatchState } from './rules'
import { rayUnit, type Shooter, type Unit } from './units'
import { Vehicle } from './vehicles'
import { World } from './world'

export type GameState = 'title' | 'playing' | 'paused' | 'ended'
export type FeedEntry = { killer: string; killerTeam: number; victim: string; victimTeam: number; head: boolean; weapon: string }
export type Toast = { text: string; kind: 'info' | 'good' | 'bad' | 'gold' }
export type Marker = { x: number; y: number; kind: 'point' | 'enemy' | 'ally' | 'heli' | 'vehicle' | 'drone' | 'hit'; label: string; color: string; dist: number; edge: boolean; progress?: number }
export type MatchResult = {
  winner: number; reason: EndReason; scores: number[]; kills: number[]; time: number
  player: { kills: number; deaths: number; captures: number; accuracy: number; headshots: number; damage: number }
  board: { name: string; team: number; kills: number; deaths: number; captures: number; isPlayer: boolean }[]
}
export type GameEvents = {
  feed(e: FeedEntry): void
  toast(t: Toast): void
  hurt(angle: number): void
  hitmarker(kill: boolean, head: boolean): void
  end(r: MatchResult): void
  stateChange(s: GameState): void
}

type Grenade = { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; fuseAt: number; owner: Shooter }

const tmpV = new THREE.Vector3()
const tmpV2 = new THREE.Vector3()
const tmpDir = new THREE.Vector3()
const TEAM_HEX = ['#ff4d5e', '#3fa9ff']
const NEUTRAL_HEX = '#e8edf2'

export class Game implements BotHost, HeliHost {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(CONFIG.player.fov, 16 / 9, 0.05, 1600)
  readonly world: World
  readonly col
  readonly nav: NavGrid
  readonly fx: Fx
  readonly player = new Player()
  readonly viewModel = new ViewModel()
  readonly bots: Bot[] = []
  readonly vehicles: Vehicle[] = []
  readonly helis: Heli[] = []
  readonly drone: Drone
  units: Unit[] = []
  match: MatchState
  state: GameState = 'title'
  time = 0
  /** Interaction hint shown in the centre of the screen. */
  prompt = ''
  heliMenu = false
  private events: GameEvents | null = null
  private vehicle: Vehicle | null = null
  private heliRide: Heli | null = null
  private stationReady: number[] = STATIONS.map(() => 0)
  private grenades: Grenade[] = []
  private enemyHeliAt: number = CONFIG.heli.enemyFirstCall
  private lastScan = 0
  private camYaw = 0
  private camPitch = -0.2
  private wallTime = 0
  private muzzleLight: THREE.PointLight
  private lookDelta = { x: 0, y: 0 }
  private healSoundAt = 0
  private buffWarned: Record<SkillId, boolean> = { scan: false, shield: false, steady: false, rush: false }
  private lastHurtDir = 0
  private deathCam = new THREE.Vector3()

  constructor(private readonly renderer: Renderer, private readonly input: Input, private readonly audio: Audio) {
    this.world = new World(this.scene, renderer.gl)
    this.col = this.world.col
    this.nav = new NavGrid(this.col.boxes)
    this.fx = new Fx(this.scene)
    this.drone = new Drone(this.scene)
    this.scene.add(this.camera)
    this.camera.add(this.viewModel.group)
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 9, 2)
    this.scene.add(this.muzzleLight)
    for (let team = 0; team < 2; team += 1) {
      const n = team === PLAYER_TEAM ? CONFIG.bots.perTeam - 1 : CONFIG.bots.perTeam
      for (let i = 0; i < n; i += 1) this.bots.push(new Bot(team, i, this.scene))
    }
    for (const s of CAR_SPAWNS) this.vehicles.push(new Vehicle('car', s.team, s, this.scene))
    for (const s of BOAT_SPAWNS) this.vehicles.push(new Vehicle('boat', s.team, s, this.scene))
    for (let t = 0; t < 2; t += 1) this.helis.push(new Heli(t, this.scene))
    this.match = createMatch(POINTS.map(p => p.kind))
    this.setupDemo()
    renderer.gl.shadowMap.enabled = renderer.gl.shadowMap.enabled && true
    this.world.sun.shadow.mapSize.set(renderer.shadowMapSize, renderer.shadowMapSize)
  }

  on(events: GameEvents): void {
    this.events = events
  }

  get air() {
    return this.helis
  }

  // ─── lifecycle ──────────────────────────────────────────────────────────
  private resetWorld(): void {
    this.time = 0
    this.match = createMatch(POINTS.map(p => p.kind))
    this.stationReady = STATIONS.map(() => 0)
    for (const g of this.grenades) this.scene.remove(g.mesh)
    this.grenades = []
    for (const v of this.vehicles) v.reset()
    for (const h of this.helis) {
      h.parkNow()
      h.readyAt = 0
    }
    if (this.drone.active) this.drone.land(0)
    this.drone.readyAt = 0
    this.enemyHeliAt = CONFIG.heli.enemyFirstCall
    this.vehicle = null
    this.heliRide = null
    this.heliMenu = false
    for (const b of this.bots) {
      b.kills = b.deaths = b.captures = 0
      b.spawn(this)
      b.spawnShieldUntil = 0
    }
  }

  private setupDemo(): void {
    this.resetWorld()
    this.units = [...this.bots]
    // Scatter bots so the title backdrop already shows a fight in progress.
    this.bots.forEach((b, i) => {
      const p = POINTS[i % POINTS.length]
      b.pos.set(p.x + (b.team === 0 ? -1 : 1) * (14 + (i % 3) * 3), 0, p.z + ((i * 7) % 9) - 4)
      b.prev.copy(b.pos)
    })
  }

  start(): void {
    this.resetWorld()
    this.player.resetStats()
    const base = BASES[PLAYER_TEAM]
    this.player.reset(base.x + 3, base.z, -Math.PI / 2, 0)
    this.player.mode = 'foot'
    this.units = [this.player, ...this.bots]
    this.buffWarned = { scan: false, shield: false, steady: false, rush: false }
    this.setState('playing')
    this.input.active = true
    this.toast(`夺取金蛋！占领据点累积积分，或守住金蛋 ${CONFIG.match.eggHoldToWin} 秒直接获胜`, 'gold')
  }

  pause(): void {
    if (this.state !== 'playing') return
    this.setState('paused')
    this.input.releaseAll()
    this.audio.silenceLoops()
  }
  resume(): void {
    if (this.state !== 'paused') return
    this.setState('playing')
  }
  quitToTitle(): void {
    this.setState('title')
    this.input.active = false
    this.audio.silenceLoops()
    this.setupDemo()
  }

  private setState(s: GameState): void {
    this.state = s
    this.events?.stateChange(s)
  }

  private toast(text: string, kind: Toast['kind'] = 'info'): void {
    this.events?.toast({ text, kind })
  }

  private sfx(name: Sfx, at?: THREE.Vector3): void {
    this.audio.play(name, at ? at.distanceTo(this.camera.position) : 0)
  }

  // ─── simulation ─────────────────────────────────────────────────────────
  step(dt: number): void {
    if (this.state === 'paused' || this.state === 'ended') return
    const demo = this.state === 'title'
    this.time += dt
    if (!demo) this.stepPlayer(dt)
    for (const b of this.bots) b.step(dt, this)
    for (const v of this.vehicles) {
      if (v !== this.vehicle) {
        v.drive(dt, 0, 0, this.col)
        if (!v.alive && this.time >= v.respawnAt && v.respawnAt > 0) v.reset()
      }
    }
    for (const h of this.helis) h.step(dt, this)
    this.stepGrenades(dt)
    this.stepCapture(dt, demo)
    if (!demo) {
      this.stepStations(dt)
      this.stepEnemyHeli()
      const e = tickMatch(this.match, dt)
      if (e?.type === 'ended') this.finish()
    } else if (this.match.timeLeft < 60 || this.match.phase === 'ended') {
      this.match = createMatch(POINTS.map(p => p.kind))
    } else tickMatch(this.match, dt)
  }

  private stepPlayer(dt: number): void {
    const p = this.player
    const input = this.input
    const look = input.takeLook()
    this.lookDelta = look
    const t = this.time
    p.tickWeapon(dt, t) && this.sfx('ui')
    if (!p.alive) {
      if (t >= p.respawnAt) {
        const base = BASES[PLAYER_TEAM]
        p.reset(base.x + 3 * Math.random(), base.z + (Math.random() - 0.5) * 6, -Math.PI / 2, t)
        this.toast('已在红方部署区重新部署', 'info')
      }
      return
    }
    // Buff expiry notices.
    for (const k of Object.keys(p.buffs) as SkillId[]) {
      if (p.buffs[k] > 0 && p.buffs[k] <= t && !this.buffWarned[k]) {
        this.buffWarned[k] = true
        p.buffs[k] = 0
        if (k === 'shield') p.shield = 0
        this.toast(`${SKILLS[k].name} 已结束`, 'info')
      }
    }
    if (p.buff('scan', t) && t - this.lastScan > 1) {
      this.lastScan = t
      for (const u of this.units) if (u.team !== p.team && u.alive && u.pos.distanceTo(p.pos) < 38) u.spottedUntil = Math.max(u.spottedUntil, t + 2.2)
    }
    switch (p.mode) {
      case 'foot': this.stepFoot(dt, look); break
      case 'vehicle': this.stepVehicle(dt, look); break
      case 'drone': this.stepDrone(dt, look); break
      case 'heli': this.stepHeliRide(dt, look); break
    }
  }

  private stepFoot(dt: number, look: { x: number; y: number }): void {
    const p = this.player
    const input = this.input
    const t = this.time
    p.look(look.x, look.y)
    p.ads += ((input.held('aim') && !p.sprinting && !p.reloading ? 1 : 0) - p.ads) * Math.min(1, dt * 12)
    const ev = p.move(dt, input, this.col, t)
    if (ev === 'jump') this.sfx('jump')
    if (ev === 'splash') this.sfx('splash')
    if (input.consume('reload') && p.startReload(t)) this.sfx('reload')
    if (input.held('fire') && !p.sprinting) this.tryPlayerFire()
    if (input.consume('grenade')) this.throwGrenade()
    this.updatePrompt()
    if (input.consume('interact')) this.interact()
    if (this.heliMenu) {
      const pads = HELIPADS[PLAYER_TEAM]
      if (Math.hypot(p.pos.x - pads.x, p.pos.z - pads.z) > pads.r + 4) this.heliMenu = false
      const choice = (['n1', 'n2', 'n3', 'n4', 'n5'] as const).findIndex(a => input.consume(a))
      if (choice >= 0) this.boardHeli(choice)
    }
  }

  private tryPlayerFire(): void {
    const p = this.player
    const t = this.time
    if (p.reloading || t < p.nextFire) return
    if (p.mag <= 0) {
      if (this.input.consume('fire')) this.sfx('empty')
      if (p.startReload(t)) this.sfx('reload')
      return
    }
    p.nextFire = t + 60 / CONFIG.weapon.rpm
    p.mag -= 1
    p.shots += 1
    const origin = this.camera.getWorldPosition(tmpV).clone()
    const dir = this.aimDir(p.spread(t))
    this.viewModel.fire()
    const muzzle = this.viewModel.muzzle(tmpV2).clone()
    this.muzzleLight.position.copy(muzzle)
    this.muzzleLight.intensity = 3
    this.fire({ team: p.team, name: p.name, unit: p }, origin, dir, CONFIG.weapon.damage, 0xffe2a0, muzzle, true)
    p.applyRecoil(t)
    this.sfx('shot')
    if (p.mag === 0 && p.startReload(t)) this.sfx('reload')
  }

  /** Current camera aim direction with random spread. */
  private aimDir(spread: number): THREE.Vector3 {
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    if (spread > 0) {
      const r = spread * Math.sqrt(Math.random())
      const a = Math.random() * Math.PI * 2
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
      d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize()
    }
    return d
  }

  private updatePrompt(): void {
    const p = this.player
    this.prompt = ''
    const v = this.nearVehicle()
    if (v) {
      this.prompt = `按 E 驾驶${v.label}（耐久 ${Math.ceil(v.hp)}）`
      return
    }
    const pad = this.nearDronePad()
    if (pad >= 0) {
      const wait = this.drone.readyAt - this.time
      this.prompt = wait > 0 ? `无人机充电中 ${Math.ceil(wait)} 秒` : `按 E 起飞侦察无人机（${DRONE_PADS[pad].name}）`
      return
    }
    const hp = HELIPADS[PLAYER_TEAM]
    if (Math.hypot(p.pos.x - hp.x, p.pos.z - hp.z) < hp.r + 3 && p.pos.y < 2) {
      const h = this.helis[PLAYER_TEAM]
      const wait = h.readyAt - this.time
      if (this.heliMenu) this.prompt = '选择机降目标：1 机器人中心 · 2 InnoCell · 3 金蛋 · 4 5E 大楼 · 5 大展览厅（E 取消）'
      else if (h.busy) this.prompt = '直升机执行任务中'
      else if (wait > 0) this.prompt = `直升机整备中 ${Math.ceil(wait)} 秒`
      else this.prompt = '按 E 登上直升机（机降 + 空中火力支援）'
    }
  }

  private nearVehicle(): Vehicle | null {
    const p = this.player
    let best: Vehicle | null = null
    let bestD = 4.2
    for (const v of this.vehicles) {
      if (!v.alive || v.driver) continue
      const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z)
      if (d < bestD && Math.abs(v.pos.y - p.pos.y) < 3) {
        best = v
        bestD = d
      }
    }
    return best
  }

  private nearDronePad(): number {
    const p = this.player
    return DRONE_PADS.findIndex(d => Math.hypot(d.x - p.pos.x, d.z - p.pos.z) < d.r + 0.6 && Math.abs(p.pos.y - d.y) < 1.2)
  }

  private interact(): void {
    const p = this.player
    const v = this.nearVehicle()
    if (v) {
      this.enterVehicle(v)
      return
    }
    const pad = this.nearDronePad()
    if (pad >= 0) {
      if (this.time < this.drone.readyAt) {
        this.sfx('deny')
        return
      }
      this.drone.launch(pad, this.time, p.yaw)
      p.mode = 'drone'
      this.camPitch = -1.25
      this.sfx('drone')
      this.toast('无人机升空：飞越敌区自动标记敌人，按 1-5 可呼叫直升机火力支援', 'info')
      return
    }
    const hp = HELIPADS[PLAYER_TEAM]
    if (Math.hypot(p.pos.x - hp.x, p.pos.z - hp.z) < hp.r + 3) {
      const h = this.helis[PLAYER_TEAM]
      if (this.heliMenu) this.heliMenu = false
      else if (!h.busy && this.time >= h.readyAt) this.heliMenu = true
      else this.sfx('deny')
    }
  }

  private boardHeli(choice: number): void {
    const h = this.helis[PLAYER_TEAM]
    const target = heliTargets()[choice]
    if (!h.call({ insert: true, x: target.x, z: target.z, name: target.name }, this.time, this.player)) {
      this.sfx('deny')
      return
    }
    this.heliMenu = false
    this.heliRide = h
    this.player.mode = 'heli'
    this.player.sheltered = true
    this.sfx('heliCall')
    this.toast(`直升机起飞，目标：${target.name}。可在舱门射击，按 E 提前跳伞`, 'good')
  }

  private callHeliSupport(choice: number): void {
    const h = this.helis[PLAYER_TEAM]
    const target = heliTargets()[choice]
    if (!h.call({ insert: false, x: target.x, z: target.z, name: target.name }, this.time, null)) {
      this.toast(h.busy ? '直升机正在执行任务' : `直升机整备中 ${Math.ceil(h.readyAt - this.time)} 秒`, 'bad')
      this.sfx('deny')
      return
    }
    this.sfx('heliCall')
    this.toast(`空中支援出发：${target.name}`, 'good')
  }

  onHeliDrop(heli: Heli): void {
    if (heli.passenger !== this.player || this.player.mode !== 'heli') return
    this.exitHeli('已机降：直升机将在上空提供火力支援')
  }

  private exitHeli(msg: string): void {
    const h = this.heliRide
    const p = this.player
    if (!h) return
    h.seat(tmpV)
    p.pos.set(tmpV.x, Math.max(tmpV.y - 1.5, 0), tmpV.z)
    p.prev.copy(p.pos)
    p.vel.set(0, -1, 0)
    p.mode = 'foot'
    p.sheltered = false
    p.onGround = false
    h.passenger = null
    this.heliRide = null
    this.toast(msg, 'good')
  }

  onHeliCrash(heli: Heli): void {
    this.fx.explosion(heli.pos.clone().setY(heli.pos.y + 1), 1.6)
    this.sfx('explode', heli.pos)
    this.toast(`${heli.name} 被击落！`, heli.team === PLAYER_TEAM ? 'bad' : 'good')
    this.splash(heli.pos, 8, 80, { team: 1 - heli.team, name: '坠机' })
  }

  private stepHeliRide(dt: number, look: { x: number; y: number }): void {
    const p = this.player
    const h = this.heliRide
    if (!h || !h.alive) {
      if (h) this.exitHeli('直升机受损，紧急跳伞！')
      if (p.alive) this.damageUnit(p, 35, { team: 1, name: '坠机' }, false, p.pos)
      return
    }
    p.look(look.x, look.y)
    p.ads += ((this.input.held('aim') ? 1 : 0) - p.ads) * Math.min(1, dt * 12)
    p.prev.copy(p.pos)
    h.seat(tmpV)
    p.pos.set(tmpV.x, tmpV.y - p.eyeY + 0.2, tmpV.z)
    p.vel.set(0, 0, 0)
    if (this.input.consume('reload') && p.startReload(this.time)) this.sfx('reload')
    if (this.input.held('fire')) this.tryPlayerFire()
    this.prompt = h.phase === 'hover' ? '即将机降…' : `乘坐直升机前往 ${h.mission?.name ?? ''} · 按 E 跳伞`
    if (this.input.consume('interact')) this.exitHeli('跳伞！')
  }

  private enterVehicle(v: Vehicle): void {
    const p = this.player
    v.driver = p
    this.vehicle = v
    p.mode = 'vehicle'
    p.sheltered = true
    p.ads = 0
    this.camYaw = v.yaw + Math.PI
    this.camPitch = -0.25
    this.sfx('vehicle')
    this.toast(`${v.label}：W/S 油门，A/D 转向，左键车载机枪，E 下车`, 'info')
  }

  private exitVehicle(): void {
    const v = this.vehicle
    const p = this.player
    if (!v) return
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw)
    const offsets: [number, number][] = [[2.6, 0], [-2.6, 0], [0, -4], [0, 4.2], [3, -3], [-3, -3]]
    let placed = false
    for (const [lx, lz] of offsets) {
      const x = v.pos.x + lx * c + lz * s, z = v.pos.z - lx * s + lz * c
      const test = { x, y: 0, z }
      const g = this.col.groundAt(x, z, 0.4, v.pos.y + 1.5)
      test.y = g
      const probe = { ...test }
      this.col.pushOut(probe, 0.4, 1.75, 0.62)
      if (Math.hypot(probe.x - x, probe.z - z) < 0.05) {
        p.pos.set(x, g, z)
        placed = true
        break
      }
    }
    if (!placed) p.pos.set(v.pos.x, v.pos.y + 2.5, v.pos.z)
    p.prev.copy(p.pos)
    p.vel.set(0, 0, 0)
    p.yaw = this.camYaw
    p.pitch = 0
    v.driver = null
    this.vehicle = null
    p.mode = 'foot'
    p.sheltered = false
    this.audio.setEngine(0)
    if (v.kind === 'boat' && p.pos.z < SHORE_Z) this.toast('涉水登陆：向岸边前进即可登上海滨长廊', 'info')
  }

  private stepVehicle(dt: number, look: { x: number; y: number }): void {
    const v = this.vehicle!
    const p = this.player
    const input = this.input
    this.camYaw -= look.x
    this.camPitch = Math.max(-0.9, Math.min(0.35, this.camPitch - look.y))
    const impact = v.drive(dt, input.move.y, input.move.x, this.col)
    if (impact > 12) this.damageVehicle(v, (impact - 12) * 6, { team: -1, name: '撞击' })
    p.prev.copy(p.pos)
    p.pos.copy(v.pos)
    this.audio.setEngine(Math.min(1, Math.abs(v.speed) / 20) * 0.8 + 0.2, v.kind === 'boat')
    // Ramming.
    if (v.kind === 'car' && Math.abs(v.speed) > 7) {
      for (const u of this.units) {
        if (u === p || !u.alive || u.sheltered) continue
        if (Math.hypot(u.pos.x - v.pos.x, u.pos.z - v.pos.z) < 2.6 && Math.abs(u.pos.y - v.pos.y) < 2) {
          if (u.team !== p.team) this.damageUnit(u, CONFIG.car.ramDamage * Math.abs(v.speed) / CONFIG.car.maxSpeed, { team: p.team, name: p.name, unit: p }, false, v.pos, '战车撞击')
          else {
            tmpV.set(u.pos.x - v.pos.x, 0, u.pos.z - v.pos.z).normalize()
            u.pos.addScaledVector(tmpV, 1.5)
          }
        }
      }
    }
    // Mounted gun.
    const cfg = v.kind === 'car' ? CONFIG.car : CONFIG.boat
    v.gunCd -= dt
    if (input.held('fire') && v.gunCd <= 0) {
      v.gunCd = cfg.gunInterval
      const origin = this.camera.getWorldPosition(tmpV).clone()
      const dir = this.aimDir(0.012)
      const hit = this.col.raycast(origin, dir, 260)
      const aimPoint = origin.clone().addScaledVector(dir, hit ? hit.t : 260)
      const muzzle = v.turret.getWorldPosition(tmpV2).clone()
      muzzle.y += 0.3
      const d2 = aimPoint.sub(muzzle).normalize()
      this.fire({ team: p.team, name: p.name, unit: p }, muzzle, d2, cfg.gunDamage, 0xfff09a, muzzle, true)
      this.fx.shake = Math.max(this.fx.shake, 0.08)
      this.sfx('gun')
    }
    const nearShore = v.kind === 'boat' && v.pos.z > SHORE_Z - 8
    this.prompt = `${v.label} · 速度 ${Math.round(Math.abs(v.speed) * 3.6)} km/h · 耐久 ${Math.ceil(v.hp)}/${v.maxHp}${nearShore ? ' · 已靠岸，按 E 登陆' : ' · 按 E 下车'}`
    if (input.consume('interact')) this.exitVehicle()
  }

  private stepDrone(dt: number, look: { x: number; y: number }): void {
    const d = this.drone
    const p = this.player
    d.yaw -= look.x
    this.camPitch = Math.max(-1.5, Math.min(-0.5, this.camPitch - look.y))
    d.step(dt, this.input.move, this.input.held('sprint'), this.time, this.units.filter(u => u.team !== p.team))
    p.prev.copy(p.pos)
    const left = d.endsAt - this.time
    const n = this.units.filter(u => u.team !== p.team && u.alive && u.spottedUntil > this.time).length
    this.prompt = `无人机侦察 · 剩余 ${Math.ceil(left)} 秒 · 已标记敌人 ${n} · 1-5 呼叫直升机支援 · E 返回`
    const choice = (['n1', 'n2', 'n3', 'n4', 'n5'] as const).findIndex(a => this.input.consume(a))
    if (choice >= 0) this.callHeliSupport(choice)
    if (left <= 0 || this.input.consume('interact')) this.endDrone()
  }

  private endDrone(): void {
    this.drone.land(this.time)
    this.player.mode = 'foot'
    const n = this.units.filter(u => u.team !== PLAYER_TEAM && u.alive && u.spottedUntil > this.time).length
    this.toast(`无人机返航，${n} 名敌人保持标记`, 'info')
  }

  // ─── combat ─────────────────────────────────────────────────────────────
  /** Hitscan shot. `visualFrom` is where the tracer starts (muzzle). */
  fire(shooter: Shooter, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, tracer: number, visualFrom?: THREE.Vector3, byPlayer = false): void {
    const range = CONFIG.weapon.range
    const wall = this.col.raycast(origin, dir, range)
    let bestT = wall ? wall.t : range
    let hitUnit: Unit | null = null
    let head = false
    let hitVehicle: Vehicle | null = null
    let hitHeli: Heli | null = null
    for (const u of this.units) {
      if (u.team === shooter.team || u === shooter.unit) continue
      const h = rayUnit(origin, dir, u, bestT)
      if (h && h.t < bestT) {
        bestT = h.t
        hitUnit = u
        head = h.head
      }
    }
    for (const v of this.vehicles) {
      const team = v.driver ? v.driver.team : v.team
      if (team === shooter.team) continue
      const t = v.rayHit(origin, dir, bestT)
      if (t >= 0 && t < bestT) {
        bestT = t
        hitVehicle = v
        hitUnit = null
      }
    }
    for (const h of this.helis) {
      if (h.team === shooter.team || !h.airborne) continue
      const t = h.rayHit(origin, dir, bestT)
      if (t >= 0 && t < bestT) {
        bestT = t
        hitHeli = h
        hitVehicle = null
        hitUnit = null
      }
    }
    const end = origin.clone().addScaledVector(dir, bestT)
    const from = visualFrom ?? origin
    if (byPlayer || Math.random() < 0.6) this.fx.tracer(from, end, tracer)
    if (!byPlayer && shooter.unit) this.sfx('enemyShot', from)
    if (hitUnit) {
      this.fx.blood(end)
      this.damageUnit(hitUnit, damage * (head ? CONFIG.weapon.headMult : 1), shooter, head, origin)
    } else if (hitVehicle) {
      this.fx.burst(end, 5, 0xfff0b0, 5, 0.05, 0.25)
      this.damageVehicle(hitVehicle, damage * 0.8, shooter)
      if (byPlayer) this.events?.hitmarker(false, false)
    } else if (hitHeli) {
      this.fx.burst(end, 5, 0xfff0b0, 5, 0.05, 0.25)
      hitHeli.damage(damage * 0.7, this)
      if (byPlayer) this.events?.hitmarker(false, false)
    } else if (wall) {
      this.fx.impact(end, tmpV.set(wall.nx, wall.ny, wall.nz), wall.water)
    }
  }

  damageUnit(u: Unit, amount: number, by: Shooter, head: boolean, from: THREE.Vector3, weapon: string = CONFIG.weapon.name): void {
    if (!u.alive || this.time < u.spawnShieldUntil) return
    if (this.state !== 'playing' && this.state !== 'title') return
    let dmg = amount
    if (u.shield > 0) {
      const absorbed = Math.min(u.shield, dmg)
      u.shield -= absorbed
      dmg -= absorbed
    }
    u.hp -= dmg
    u.lastHurt = this.time
    u.lastAttacker = by.unit ?? null
    const p = this.player
    if (by.unit === p) {
      p.hits += 1
      p.damageDealt += amount
      if (head) p.headshots += 1
    }
    if (u === p) {
      const ang = Math.atan2(from.x - p.pos.x, from.z - p.pos.z)
      const rel = ang - Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw))
      this.lastHurtDir = rel
      this.events?.hurt(rel)
      this.sfx('hurt')
      if (p.mode === 'drone') this.endDrone()
    }
    if (u.hp <= 0) {
      u.hp = 0
      this.killUnit(u, by, head, weapon)
    } else if (by.unit === p) {
      this.events?.hitmarker(false, head)
      this.sfx(head ? 'headshot' : 'hit')
    }
  }

  private killUnit(u: Unit, by: Shooter, head: boolean, weapon: string): void {
    u.alive = false
    const killerTeam = by.team >= 0 ? by.team : 1 - u.team
    if (this.state === 'playing') addKill(this.match, killerTeam)
    if (by.unit) by.unit.kills += 1
    this.events?.feed({ killer: by.name, killerTeam, victim: u.name, victimTeam: u.team, head, weapon })
    if (u instanceof Bot) u.kill(this)
    if (by.unit === this.player) {
      this.events?.hitmarker(true, head)
      this.sfx('kill')
    }
    if (u === this.player) {
      const p = this.player
      p.deaths += 1
      p.respawnAt = this.time + CONFIG.player.respawn
      this.deathCam.copy(this.camera.position)
      if (this.vehicle) {
        this.vehicle.driver = null
        this.vehicle = null
      }
      if (this.heliRide) {
        this.heliRide.passenger = null
        this.heliRide = null
      }
      if (this.drone.active) this.drone.land(this.time)
      this.heliMenu = false
      p.mode = 'dead'
      p.sheltered = false
      this.audio.setEngine(0)
      this.toast(`你被 ${by.name} 击倒，${CONFIG.player.respawn} 秒后重新部署`, 'bad')
    }
  }

  damageVehicle(v: Vehicle, amount: number, by: Shooter): void {
    if (!v.alive) return
    v.hp -= amount
    if (v.hp > 0) return
    v.hp = 0
    v.destroy()
    v.respawnAt = this.time + (v.kind === 'car' ? CONFIG.car.respawn : CONFIG.boat.respawn)
    this.fx.explosion(v.center.clone(), 1.2)
    this.sfx('explode', v.pos)
    this.splash(v.center, 5, 60, by)
    if (v === this.vehicle) {
      this.exitVehicle()
      this.damageUnit(this.player, 45, by, false, v.pos, '载具爆炸')
      this.toast(`${v.label} 被摧毁！`, 'bad')
    } else if (by.unit === this.player) this.toast(`摧毁敌方${v.label}`, 'good')
  }

  vehicleOf(u: Unit): { pos: THREE.Vector3; center: THREE.Vector3 } | null {
    if (u !== this.player) return null
    if (this.vehicle) return this.vehicle
    if (this.heliRide) return { pos: this.heliRide.pos, center: this.heliRide.center.clone() }
    return null
  }

  private throwGrenade(): void {
    const p = this.player
    if (p.grenades <= 0) {
      this.toast('手雷已用完，前往餐厅补给点补充', 'bad')
      this.sfx('deny')
      return
    }
    p.grenades -= 1
    const dir = this.aimDir(0)
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3a4a3a, emissive: 0xff3322, emissiveIntensity: 0.6 }))
    const pos = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6)
    mesh.position.copy(pos)
    this.scene.add(mesh)
    const vel = dir.clone().multiplyScalar(CONFIG.grenade.speed).add(new THREE.Vector3(0, 3.2, 0)).add(p.vel.clone().multiplyScalar(0.5))
    this.grenades.push({ mesh, pos, vel, fuseAt: this.time + CONFIG.grenade.fuse, owner: { team: p.team, name: p.name, unit: p } })
    this.toast(`投掷手雷（剩余 ${p.grenades}）`, 'info')
  }

  private stepGrenades(dt: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i -= 1) {
      const g = this.grenades[i]
      g.vel.y += -18 * dt
      const len = g.vel.length() * dt
      if (len > 1e-4) {
        tmpDir.copy(g.vel).normalize()
        const hit = this.col.raycast(g.pos, tmpDir, len + 0.12)
        if (hit && !hit.water) {
          g.pos.addScaledVector(tmpDir, Math.max(0, hit.t - 0.12))
          const n = tmpV.set(hit.nx, hit.ny, hit.nz)
          g.vel.addScaledVector(n, -2 * g.vel.dot(n)).multiplyScalar(0.38)
        } else g.pos.addScaledVector(g.vel, dt)
        if (hit?.water) g.vel.multiplyScalar(0.3)
      }
      g.mesh.position.copy(g.pos)
      if (this.time >= g.fuseAt) {
        this.scene.remove(g.mesh)
        this.grenades.splice(i, 1)
        this.fx.explosion(g.pos, 1)
        this.sfx('explode', g.pos)
        this.splash(g.pos, CONFIG.grenade.radius, CONFIG.grenade.damage, g.owner, '手雷')
      }
    }
  }

  /** Area damage with line-of-sight falloff. */
  private splash(at: THREE.Vector3, radius: number, damage: number, by: Shooter, weapon = '爆炸'): void {
    const c = at.clone()
    c.y += 0.3
    for (const u of this.units) {
      if (!u.alive || u.sheltered) continue
      if (u.team === by.team && u !== by.unit) continue
      const target = tmpV.set(u.pos.x, u.pos.y + 1, u.pos.z)
      const d = target.distanceTo(c)
      if (d > radius || !this.col.lineOfSight(c, target)) continue
      const k = 1 - d / radius
      this.damageUnit(u, damage * k * (u === by.unit ? 0.5 : 1), by, false, at, weapon)
    }
    for (const v of this.vehicles) {
      const team = v.driver ? v.driver.team : v.team
      if (team === by.team || !v.alive) continue
      const d = v.center.distanceTo(c)
      if (d < radius + 2) this.damageVehicle(v, damage * 1.6 * (1 - d / (radius + 2)), by)
    }
  }

  // ─── objectives & stations ──────────────────────────────────────────────
  private stepCapture(dt: number, demo: boolean): void {
    const st = this.match
    POINTS.forEach((p, i) => {
      const presence = [0, 0]
      for (const u of this.units) {
        if (!u.alive) continue
        if (u === this.player && (this.player.mode === 'heli' || this.player.mode === 'drone')) continue
        const maxY = p.kind === 'egg' ? 7 : 4
        if (u.pos.y > maxY) continue
        if (Math.hypot(u.pos.x - p.x, u.pos.z - p.z) <= p.r) presence[u.team] += 1
      }
      const e = stepPoint(st, i, presence, dt)
      this.world.setPointOwner(i, st.points[i].owner, st.points[i].capturing, st.points[i].contested, this.wallTime)
      if (!e || demo || e.type === 'ended') return
      const mine = e.team === PLAYER_TEAM
      if (e.type === 'captured') {
        const inside = this.player.alive && Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z) <= p.r
        if (inside && mine) this.player.captures += 1
        for (const b of this.bots) if (b.alive && b.team === e.team && Math.hypot(b.pos.x - p.x, b.pos.z - p.z) <= p.r) b.captures += 1
        this.toast(`${TEAM_SHORT[e.team]}占领了 ${p.name}`, mine ? (p.kind === 'egg' ? 'gold' : 'good') : 'bad')
        this.sfx(mine ? 'capture' : 'lost')
      } else if (e.type === 'neutralized') {
        this.toast(`${p.name} 已被${TEAM_SHORT[e.team]}中立化`, mine ? 'good' : 'bad')
        this.sfx(mine ? 'ui' : 'lost')
      }
    })
  }

  private stepStations(dt: number): void {
    const p = this.player
    const t = this.time
    STATIONS.forEach((s, i) => {
      const ready = t >= this.stationReady[i]
      this.world.setStationReady(i, s.kind === 'heal' || ready)
      if (!p.alive || p.mode !== 'foot') return
      if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > s.r || p.pos.y > 3) return
      if (s.kind === 'heal') {
        if (p.hp < p.maxHp) {
          p.hp = Math.min(p.maxHp, p.hp + CONFIG.stations.healRate * dt)
          if (t >= this.healSoundAt) {
            this.healSoundAt = t + 0.8
            this.sfx('heal')
          }
          this.prompt = `${s.name}：生命恢复中 ${Math.floor(p.hp)}/${p.maxHp}`
        } else this.prompt = `${s.name}：生命已满`
        return
      }
      if (!ready) {
        this.prompt = `${s.name}：冷却中 ${Math.ceil(this.stationReady[i] - t)} 秒`
        return
      }
      if (s.kind === 'supply') {
        p.reserve = CONFIG.weapon.maxReserve
        p.mag = p.reloading ? p.mag : CONFIG.weapon.mag
        p.grenades = Math.min(CONFIG.grenade.max, p.grenades + 2)
        this.stationReady[i] = t + CONFIG.stations.supplyCooldown
        this.toast(`${s.name} · 补给完成：弹药补满，手雷 +2`, 'good')
        this.sfx('supply')
      } else if (s.kind === 'skill' && s.skill) {
        const sk = SKILLS[s.skill]
        p.buffs[s.skill] = t + CONFIG.stations.skillDuration
        this.buffWarned[s.skill] = false
        if (s.skill === 'shield') p.shield = CONFIG.stations.shield
        this.stationReady[i] = t + CONFIG.stations.skillCooldown
        this.toast(`${s.name} · 获得技能【${sk.name}】${sk.desc}（${CONFIG.stations.skillDuration} 秒）`, 'gold')
        this.sfx('skill')
      }
    })
    // Base: heal and slow ammo top-up.
    const base = BASES[PLAYER_TEAM]
    if (p.alive && p.mode === 'foot' && Math.hypot(p.pos.x - base.x, p.pos.z - base.z) < base.r) {
      p.hp = Math.min(p.maxHp, p.hp + CONFIG.stations.baseHealRate * dt)
      if (p.reserve < CONFIG.weapon.reserve) p.reserve = Math.min(CONFIG.weapon.reserve, p.reserve + 30 * dt)
    }
    p.reserve = Math.floor(p.reserve * 100) / 100
  }

  private stepEnemyHeli(): void {
    const h = this.helis[1]
    if (this.time < this.enemyHeliAt || h.busy) return
    this.enemyHeliAt = this.time + CONFIG.heli.enemyInterval
    const st = this.match.points
    const egg = eggIndex(this.match)
    let idx = st[egg].owner === PLAYER_TEAM ? egg : st.findIndex(s => s.owner === PLAYER_TEAM)
    if (idx < 0) idx = egg
    const target = heliTargets()[idx]
    if (h.call({ insert: false, x: target.x, z: target.z, name: target.name }, this.time, null)) {
      this.toast(`警告：蓝方直升机正飞往 ${target.name} 实施火力压制！`, 'bad')
      this.sfx('heliCall')
    }
  }

  private finish(): void {
    const m = this.match
    this.setState('ended')
    this.input.active = false
    this.audio.silenceLoops()
    const p = this.player
    const board = this.units.map(u => ({ name: u.name, team: u.team, kills: u.kills, deaths: u.deaths, captures: u.captures, isPlayer: u.isPlayer })).sort((a, b) => b.kills * 2 + b.captures * 3 - (a.kills * 2 + a.captures * 3))
    this.sfx(m.winner === PLAYER_TEAM ? 'win' : 'lose')
    this.events?.end({
      winner: m.winner, reason: m.reason, scores: [...m.scores], kills: [...m.kills], time: CONFIG.match.seconds - m.timeLeft,
      player: { kills: p.kills, deaths: p.deaths, captures: p.captures, accuracy: p.shots ? p.hits / p.shots : 0, headshots: p.headshots, damage: Math.round(p.damageDealt) },
      board,
    })
  }

  // ─── rendering ──────────────────────────────────────────────────────────
  render(alpha: number, frameDt: number): void {
    this.wallTime += frameDt
    const t = this.wallTime
    const cam = this.camera
    const p = this.player
    for (const b of this.bots) b.render(alpha, frameDt)
    for (const v of this.vehicles) v.render(alpha, frameDt, v === this.vehicle ? this.camYaw + Math.PI : undefined)
    let rotor = 0
    for (const h of this.helis) {
      h.render(alpha, frameDt)
      if (h.airborne || h.phase === 'takeoff') rotor = Math.max(rotor, 1 - h.pos.distanceTo(cam.position) / 160)
    }
    this.audio.setRotor(this.state === 'playing' ? rotor : 0)
    this.drone.render(alpha, frameDt, t)
    this.fx.update(frameDt)
    this.muzzleLight.intensity *= 0.6
    const shake = this.fx.shake
    let fovTarget: number = CONFIG.player.fov
    let showGun = false
    if (this.state === 'title') {
      const a = t * 0.05
      cam.position.set(Math.sin(a) * 70, 34 + Math.sin(t * 0.13) * 6, Math.cos(a) * 70 + 10)
      cam.lookAt(0, 10, 0)
    } else if (p.mode === 'vehicle' && this.vehicle) {
      const v = this.vehicle
      const vp = tmpV.lerpVectors(v.prev, v.pos, alpha)
      const dist = v.kind === 'boat' ? 11 : 9
      const cy = Math.cos(this.camPitch)
      cam.position.set(vp.x + Math.sin(this.camYaw) * dist * cy, vp.y + 3 - Math.sin(this.camPitch) * dist, vp.z + Math.cos(this.camYaw) * dist * cy)
      cam.position.y = Math.max(cam.position.y, (v.kind === 'boat' ? WATER_Y : vp.y) + 1)
      cam.lookAt(vp.x, vp.y + 2.2, vp.z)
      fovTarget = 70
    } else if (p.mode === 'drone') {
      const d = this.drone
      const dp = tmpV.lerpVectors(d.prev, d.pos, alpha)
      cam.position.set(dp.x, dp.y - 0.4, dp.z)
      cam.rotation.set(this.camPitch, d.yaw, 0, 'YXZ')
      fovTarget = 68
    } else if (p.mode === 'dead') {
      cam.position.lerp(tmpV.set(p.pos.x + 4, p.pos.y + 6, p.pos.z + 4), Math.min(1, frameDt * 1.5))
      cam.lookAt(p.pos.x, p.pos.y + 0.5, p.pos.z)
    } else {
      const ep = tmpV.lerpVectors(p.prev, p.pos, alpha)
      cam.position.set(ep.x, ep.y + p.eyeY, ep.z)
      const bob = p.onGround ? Math.sin(p.bobPhase * 1.6) * 0.04 * Math.min(1, p.speed / 9) * (1 - p.ads) : 0
      cam.position.y += Math.abs(bob)
      cam.rotation.set(p.pitch + p.kick, p.yaw + p.kickYaw, 0, 'YXZ')
      fovTarget = CONFIG.player.fov + (CONFIG.player.adsFov - CONFIG.player.fov) * p.ads + (p.sprinting ? 4 : 0)
      showGun = true
    }
    if (shake > 0) {
      cam.position.x += (Math.random() - 0.5) * shake * 0.4
      cam.position.y += (Math.random() - 0.5) * shake * 0.4
    }
    if (Math.abs(cam.fov - fovTarget) > 0.05) {
      cam.fov += (fovTarget - cam.fov) * Math.min(1, frameDt * 12)
      cam.updateProjectionMatrix()
    }
    this.viewModel.update(frameDt, p, this.lookDelta.x, this.lookDelta.y, this.time, showGun && p.alive)
    for (const b of this.bots) b.mesh.root.visible = b.alive || this.time - (b.respawnAt - CONFIG.bots.respawn) < 4
    this.world.animate(t, this.state === 'title' ? new THREE.Vector3(0, 0, 0) : p.mode === 'drone' ? this.drone.pos.clone().setY(0) : p.pos)
    this.renderer.render(this.scene, cam)
  }

  // ─── HUD data ───────────────────────────────────────────────────────────
  markers(w: number, h: number): Marker[] {
    const out: Marker[] = []
    const cam = this.camera
    cam.updateMatrixWorld()
    const p = this.player
    const proj = (pos: THREE.Vector3, clampEdge: boolean): { x: number; y: number; edge: boolean } | null => {
      const v = tmpV2.copy(pos).project(cam)
      const behind = v.z > 1
      let x = v.x, y = v.y
      if (behind) {
        x = -x
        y = -y
      }
      const on = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1
      if (!on && !clampEdge) return null
      if (!on) {
        const m = Math.max(Math.abs(x), Math.abs(y)) || 1
        x /= m
        y /= m
        x *= 0.92
        y *= 0.86
        if (behind && y > -0.2) y = -0.86
      }
      return { x: (x * 0.5 + 0.5) * w, y: (-y * 0.5 + 0.5) * h, edge: !on }
    }
    const camPos = cam.position
    POINTS.forEach((pt, i) => {
      const s = this.match.points[i]
      const pos = tmpV.set(pt.x, pt.kind === 'egg' ? EGG.cy + EGG.ry + 2 : 3, pt.z)
      const r = proj(pos, pt.kind === 'egg')
      if (!r) return
      const color = s.contested ? '#ffd35c' : s.owner >= 0 ? TEAM_HEX[s.owner] : NEUTRAL_HEX
      out.push({ ...r, kind: 'point', label: pt.short, color, dist: Math.hypot(pt.x - camPos.x, pt.z - camPos.z), progress: s.progress })
    })
    const t = this.time
    for (const u of this.units) {
      if (u === p || !u.alive) continue
      const head = tmpV.set(u.pos.x, u.pos.y + 2.25, u.pos.z)
      const dist = head.distanceTo(camPos)
      if (u.team === p.team) {
        if (dist > 90) continue
        const r = proj(head, false)
        if (r) out.push({ ...r, kind: 'ally', label: u.name, color: TEAM_HEX[u.team], dist })
      } else if (u.spottedUntil > t) {
        const r = proj(head, false)
        if (r) out.push({ ...r, kind: 'enemy', label: '', color: TEAM_HEX[u.team], dist })
      }
    }
    for (const hh of this.helis) {
      if (!hh.airborne || !hh.alive) continue
      const r = proj(tmpV.copy(hh.pos).setY(hh.pos.y + 5), hh.team !== p.team)
      if (r) out.push({ ...r, kind: 'heli', label: hh.team === p.team ? '友军直升机' : '敌方直升机', color: TEAM_HEX[hh.team], dist: hh.pos.distanceTo(camPos) })
    }
    if (p.mode === 'foot') {
      for (const v of this.vehicles) {
        if (!v.alive || v.driver) continue
        const d = v.pos.distanceTo(camPos)
        if (d > 45) continue
        const r = proj(tmpV.copy(v.pos).setY(v.pos.y + 3.2), false)
        if (r) out.push({ ...r, kind: 'vehicle', label: v.label, color: v.team === 0 ? TEAM_HEX[0] : TEAM_HEX[1], dist: d })
      }
      DRONE_PADS.forEach(d => {
        const dist = Math.hypot(d.x - camPos.x, d.z - camPos.z)
        if (dist > 60) return
        const r = proj(tmpV.set(d.x, d.y + 4.5, d.z), false)
        if (r) out.push({ ...r, kind: 'drone', label: this.time >= this.drone.readyAt ? '无人机' : '充电中', color: '#7ef9ff', dist })
      })
    }
    return out
  }

  /** Point currently occupied by the player (for the centre capture bar). */
  playerZone(): number {
    const p = this.player
    if (!p.alive || p.mode === 'heli' || p.mode === 'drone') return -1
    return POINTS.findIndex(pt => Math.hypot(p.pos.x - pt.x, p.pos.z - pt.z) <= pt.r && p.pos.y <= (pt.kind === 'egg' ? 7 : 4))
  }

  get activeVehicle(): Vehicle | null {
    return this.vehicle
  }

  /** Debug/test hooks. */
  debugTeleport(x: number, z: number, y = 0): void {
    this.player.pos.set(x, y, z)
    this.player.prev.copy(this.player.pos)
  }
  get hurtDir(): number {
    return this.lastHurtDir
  }
}
