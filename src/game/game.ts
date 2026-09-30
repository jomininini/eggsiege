import * as THREE from 'three'
import type { Audio, Sfx } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { Bot, type BotHost, type SeekerSpec, type Target } from './bots'
import { raySphere } from './collide'
import { applyOptions, CONFIG, launcherName, pistolName, PLAYER_TEAM, RT, teamShort, weaponName, type MatchOptions } from './config'
import { Drone, ScoutDrone } from './drone'
import { Emplacement } from './emplace'
import { Fx } from './fx'
import { Heli, type HeliHost } from './heli'
import { L } from './i18n'
import {
  BASES, BOAT_SPAWNS, CAR_SPAWNS, DRONE_PADS, EGG, EMPLACEMENTS, HELIPADS, ISLAND, ISLAND_BOATS, ISLAND_DEPOT, ISLAND_POINT, LAND, POINTS, SHORE_Z, SKILLS,
  STATIONS, WATER_Y, heliTargets, isWater, pointName, pointShort, stationName, type SkillId,
} from './map'
import { NavGrid } from './nav'
import { Ordnance, type OrdnanceHost, type Projectile } from './ordnance'
import { Player, ViewModel, WEAPON_ORDER, type WeaponSlot } from './player'
import { addKill, createMatch, eggIndex, stepPoint, tickMatch, type EndReason, type MatchState } from './rules'
import { rayUnit, type Shooter, type Unit } from './units'
import { Vehicle } from './vehicles'
import { World } from './world'

export type GameState = 'title' | 'playing' | 'paused' | 'ended'
export type FeedEntry = { killer: string; killerTeam: number; victim: string; victimTeam: number; head: boolean; weapon: string }
export type Toast = { text: string; kind: 'info' | 'good' | 'bad' | 'gold' }
export type MarkerKind = 'point' | 'enemy' | 'ally' | 'heli' | 'vehicle' | 'drone' | 'hit' | 'lock' | 'emplace' | 'strike' | 'scout'
export type Marker = { x: number; y: number; kind: MarkerKind; label: string; color: string; dist: number; edge: boolean; progress?: number }
export type MatchResult = {
  winner: number; reason: EndReason; scores: number[]; kills: number[]; time: number; sea: boolean
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
/** Seat / weapon status for the HUD. */
export type SeatStatus = {
  kind: 'aa' | 'arty'
  name: string
  hp: number
  maxHp: number
  lockMode: boolean
  lockK: number
  samWait: number
  readyWait: number
  salvoLeft: number
  cursor: { x: number; z: number; r: number; dist: number } | null
}
export type Strike = { x: number; z: number; r: number; team: number; until: number; ring: THREE.Mesh; disc: THREE.Mesh }

type Grenade = { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; fuseAt: number; owner: Shooter }
/** Something that can be locked / homed on: vehicles, aircraft, emplacements. */
type Hardware = { ref: unknown; team: number; pos: THREE.Vector3; air: boolean; label: string }

const tmpV = new THREE.Vector3()
const tmpV2 = new THREE.Vector3()
const tmpV3 = new THREE.Vector3()
const tmpDir = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const NORTH_UP = new THREE.Vector3(0, 0, 1)
const TEAM_HEX = ['#ff4d5e', '#3fa9ff']
const NEUTRAL_HEX = '#e8edf2'
const GOLD_HEX = '#ffd35c'

export class Game implements BotHost, HeliHost, OrdnanceHost {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(CONFIG.player.fov, 16 / 9, 0.05, 1600)
  readonly world: World
  readonly col
  readonly nav: NavGrid
  readonly fx: Fx
  readonly ord: Ordnance
  readonly player = new Player()
  readonly viewModel = new ViewModel()
  bots: Bot[] = []
  readonly vehicles: Vehicle[] = []
  readonly helis: Heli[] = []
  readonly emps: Emplacement[] = []
  readonly scouts: ScoutDrone[] = []
  readonly strikes: Strike[] = []
  readonly drone: Drone
  units: Unit[] = []
  match: MatchState
  state: GameState = 'title'
  time = 0
  /** Interaction hint shown in the centre of the screen. */
  prompt = ''
  heliMenu = false
  respawnIsland = false
  private ammoAcc = 0
  private depotMissileAcc = 0
  private idleSince = new Map<Vehicle, number>()
  air: Target[] = []
  hard: Target[] = []
  private events: GameEvents | null = null
  private vehicle: Vehicle | null = null
  private heliRide: Heli | null = null
  private seat: Emplacement | null = null
  private readonly cursor = new THREE.Vector3(0, 0, 0)
  private readonly cursorRing: THREE.Mesh
  private stationReady: number[] = STATIONS.map(() => 0)
  private grenades: Grenade[] = []
  private enemyHeliAt = 0
  private aiArtyAt = [0, 0]
  private lastScan = 0
  private lockBeepAt = 0
  private camYaw = 0
  private camPitch = -0.2
  private wallTime = 0
  private muzzleLight: THREE.PointLight
  private lookDelta = { x: 0, y: 0 }
  private healSoundAt = 0
  private buffWarned: Record<SkillId, boolean> = { scan: false, shield: false, steady: false, rush: false }
  private lastHurtDir = 0
  private deathCam = new THREE.Vector3()
  private lastIslandOwner = -1
  private spottedWarned = new Set<ScoutDrone>()
  private builtFor = ''

  constructor(private readonly renderer: Renderer, private readonly input: Input, private readonly audio: Audio) {
    this.world = new World(this.scene, renderer.gl)
    this.col = this.world.col
    this.nav = new NavGrid(this.col.boxes)
    this.fx = new Fx(this.scene)
    this.ord = new Ordnance(this.scene, this.fx)
    this.drone = new Drone(this.scene)
    this.scene.add(this.camera)
    this.camera.add(this.viewModel.group)
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 9, 2)
    this.scene.add(this.muzzleLight)
    for (const s of CAR_SPAWNS) this.vehicles.push(new Vehicle('car', s.team, s, this.scene))
    for (const s of BOAT_SPAWNS) this.vehicles.push(new Vehicle('boat', s.team, s, this.scene))
    for (const s of ISLAND_BOATS) this.vehicles.push(new Vehicle('boat', -1, { team: -1, ...s }, this.scene, true))
    for (let t = 0; t < 2; t += 1) this.helis.push(new Heli(t, this.scene))
    for (let t = 0; t < 2; t += 1) this.scouts.push(new ScoutDrone(t, this.scene))
    const label = this.world.label.bind(this.world)
    for (const d of EMPLACEMENTS) this.emps.push(new Emplacement(d, this.scene, label))
    this.cursorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.93, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false, toneMapped: false }),
    )
    this.cursorRing.rotation.x = -Math.PI / 2
    this.cursorRing.renderOrder = 5
    this.cursorRing.visible = false
    this.scene.add(this.cursorRing)
    this.match = createMatch(POINTS.map(p => p.kind))
    this.setupDemo()
    this.world.sun.shadow.mapSize.set(renderer.shadowMapSize, renderer.shadowMapSize)
  }

  on(events: GameEvents): void {
    this.events = events
  }

  // ─── lifecycle ──────────────────────────────────────────────────────────
  /** (Re)create the bot squads for the current RT settings (team size and mode change roles). */
  private rebuildBots(): void {
    const key = `${RT.perTeam}|${RT.sea}`
    if (key === this.builtFor && this.bots.length) return
    this.builtFor = key
    for (const b of this.bots) this.scene.remove(b.mesh.root)
    this.bots = []
    for (let team = 0; team < 2; team += 1) {
      const n = team === PLAYER_TEAM ? RT.perTeam - 1 : RT.perTeam
      for (let i = 0; i < n; i += 1) this.bots.push(new Bot(team, i, this.scene))
    }
  }

  private resetWorld(): void {
    this.time = 0
    this.rebuildBots()
    this.match = createMatch(POINTS.map(p => p.kind))
    this.stationReady = STATIONS.map(() => 0)
    for (const g of this.grenades) this.scene.remove(g.mesh)
    this.grenades = []
    this.ord.clear()
    for (const s of this.strikes) this.scene.remove(s.ring, s.disc)
    this.strikes.length = 0
    for (const v of this.vehicles) {
      v.setEnabled(RT.sea || !(v.island || BOAT_SPAWNS.some(b => b.sea && b.x === v.spawn.x && b.z === v.spawn.z)))
      v.setTeam(v.island ? -1 : v.spawn.team)
      v.reset()
    }
    for (const e of this.emps) {
      e.reset()
      e.setEnabled(RT.sea)
    }
    for (const s of this.scouts) s.reset()
    this.spottedWarned.clear()
    this.world.setSeaMode(RT.sea)
    for (const h of this.helis) {
      h.parkNow()
      h.readyAt = 0
    }
    if (this.drone.active) this.drone.land(0)
    this.drone.readyAt = 0
    this.enemyHeliAt = CONFIG.heli.enemyFirstCall
    this.aiArtyAt = [RT.bot.artyInterval * 0.8, RT.bot.artyInterval * 0.6]
    this.lastIslandOwner = -1
    this.vehicle = null
    this.heliRide = null
    this.seat = null
    this.cursorRing.visible = false
    this.heliMenu = false
    this.respawnIsland = false
    this.ammoAcc = 0
    this.ammoHintAt = -99
    this.lockBeepAt = 0
    this.healSoundAt = 0
    for (const u of this.units) u.spottedUntil = 0
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
      const p = POINTS[i % (POINTS.length - 1)]
      b.pos.set(p.x + (b.team === 0 ? -1 : 1) * (14 + (i % 3) * 3), 0, p.z + ((i * 7) % 9) - 4)
      if (p.kind === 'egg') b.pos.z += 20
      b.prev.copy(b.pos)
    })
  }

  start(opts?: MatchOptions): void {
    if (opts) applyOptions(opts)
    this.resetWorld()
    this.player.resetStats()
    const base = BASES[PLAYER_TEAM]
    this.player.reset(base.x + 3, base.z, -Math.PI / 2, 0)
    this.player.mode = 'foot'
    this.units = [this.player, ...this.bots]
    this.buffWarned = { scan: false, shield: false, steady: false, rush: false }
    this.setState('playing')
    this.input.active = true
    this.toast(L(`夺取金蛋！占领据点累积积分，或守住金蛋 ${CONFIG.match.eggHoldToWin} 秒直接获胜`, `Take the Golden Egg! Hold points for score, or keep the Egg for ${CONFIG.match.eggHoldToWin}s to win outright`), 'gold')
    if (RT.sea) this.toast(L('出海模式：抢滩出海岛可获得防空炮、远程火箭炮与巡逻艇，经水道直捣金蛋湖', 'Sea mode: storm the Offshore Isle to gain AA, rocket artillery and patrol boats, then sail the canal into the Egg Lake'), 'info')
  }

  /** Called when the UI language changes. */
  relabel(): void {
    this.world.relabel()
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

  islandOwner(): number {
    return RT.sea ? this.match.points[ISLAND_POINT].owner : -1
  }

  // ─── simulation ─────────────────────────────────────────────────────────
  step(dt: number): void {
    if (this.state === 'paused' || this.state === 'ended') return
    const demo = this.state === 'title'
    this.time += dt
    this.refreshTargets()
    this.syncIsland(demo)
    if (!demo) this.stepPlayer(dt)
    for (const b of this.bots) b.step(dt, this)
    for (const v of this.vehicles) {
      if (!v.enabled) continue
      if (!v.driver) {
        v.drive(dt, 0, 0, this.col)
        if (!v.alive && this.time >= v.respawnAt && v.respawnAt > 0) v.reset()
        // Abandoned away from its spawn (e.g. beached after a landing): return it after a while.
        else if (v.alive && Math.hypot(v.pos.x - v.spawn.x, v.pos.z - v.spawn.z) > 9) {
          const since = this.idleSince.get(v) ?? this.time
          this.idleSince.set(v, since)
          const nearPlayer = this.player.alive && v.pos.distanceTo(this.player.pos) < 35
          if (this.time - since > (v.kind === 'boat' ? 20 : 45) && !nearPlayer) {
            v.reset()
            this.idleSince.delete(v)
          }
        } else this.idleSince.delete(v)
      } else this.idleSince.delete(v)
    }
    for (const h of this.helis) h.step(dt, this)
    this.stepScouts(dt, demo)
    this.stepEmplacements(dt, demo)
    this.ord.step(dt, this)
    this.stepStrikes()
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

  /** Aircraft and hard targets the bots / AA can see this step. */
  private refreshTargets(): void {
    const air: Target[] = []
    for (const h of this.helis) air.push({ team: h.team, alive: h.alive, airborne: h.airborne, pos: h.center.clone(), ref: h })
    if (this.drone.active) air.push({ team: this.drone.team, alive: true, airborne: true, pos: this.drone.pos, ref: this.drone })
    for (const s of this.scouts) if (s.active) air.push({ team: s.team, alive: true, airborne: true, pos: s.pos, ref: s })
    this.air = air
    const hard: Target[] = []
    for (const e of this.emps) if (e.enabled && e.alive && e.team >= 0) hard.push({ team: e.team, alive: true, airborne: false, pos: e.center, ref: e })
    this.hard = hard
  }

  /** Island emplacements and patrol boats follow the island's owner. */
  private syncIsland(demo: boolean): void {
    if (!RT.sea) return
    const own = this.islandOwner()
    for (const e of this.emps) e.setTeam(own)
    for (const v of this.vehicles) if (v.island && !v.driver) v.setTeam(own)
    if (own !== this.lastIslandOwner) {
      if (!demo && own >= 0) {
        this.toast(
          L(`${teamShort(own)}控制出海岛：海盾防空炮、潮汐火箭炮与巡逻艇已归属${teamShort(own)}`, `${teamShort(own)} holds the Offshore Isle: its AA, rocket battery and patrol boats now serve ${teamShort(own)}`),
          own === PLAYER_TEAM ? 'gold' : 'bad',
        )
      }
      if (this.seat && this.seat.team !== this.player.team) this.exitSeat()
      this.lastIslandOwner = own
    }
  }

  private stepPlayer(dt: number): void {
    const p = this.player
    const input = this.input
    const look = input.takeLook()
    this.lookDelta = look
    const t = this.time
    if (p.tickWeapon(dt, t)) this.sfx('ui')
    if (!p.alive) {
      const canIsland = RT.sea && this.islandOwner() === p.team
      if (canIsland) {
        if (input.consume('n2')) this.respawnIsland = true
        if (input.consume('n1')) this.respawnIsland = false
      } else this.respawnIsland = false
      if (t >= p.respawnAt) {
        if (this.respawnIsland && canIsland) {
          p.reset(ISLAND.x + (Math.random() - 0.5) * 8, ISLAND.z + 3 + Math.random() * 3, 0, t)
          p.pos.y = ISLAND.y
          p.prev.copy(p.pos)
          this.toast(L('已在出海岛重新部署', 'Redeployed on the Offshore Isle'), 'info')
        } else {
          const base = BASES[PLAYER_TEAM]
          p.reset(base.x + 3 * Math.random(), base.z + (Math.random() - 0.5) * 6, -Math.PI / 2, t)
          this.toast(L('已在红方部署区重新部署', 'Redeployed at the Red staging area'), 'info')
        }
      }
      return
    }
    // Buff expiry notices.
    for (const k of Object.keys(p.buffs) as SkillId[]) {
      if (p.buffs[k] > 0 && p.buffs[k] <= t && !this.buffWarned[k]) {
        this.buffWarned[k] = true
        p.buffs[k] = 0
        if (k === 'shield') p.shield = 0
        this.toast(L(`${SKILLS[k].name.zh} 已结束`, `${SKILLS[k].name.en} ended`), 'info')
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
      case 'aa': this.stepAA(dt, look); break
      case 'arty': this.stepArty(dt, look); break
    }
  }

  private handleWeaponKeys(): void {
    const p = this.player
    const input = this.input
    let to: WeaponSlot | null = null
    if (input.consume('swap')) to = WEAPON_ORDER[(WEAPON_ORDER.indexOf(p.weapon) + 1) % WEAPON_ORDER.length]
    if (!this.heliMenu) {
      if (input.consume('n1')) to = 'rifle'
      if (input.consume('n2')) to = 'pistol'
      if (input.consume('n3')) to = 'launcher'
    }
    if (to && p.switchWeapon(to, this.time)) {
      this.sfx('swap')
      this.viewModel.setLock(0)
    }
  }

  private stepFoot(dt: number, look: { x: number; y: number }): void {
    const p = this.player
    const input = this.input
    const t = this.time
    p.look(look.x, look.y)
    p.ads += ((input.held('aim') && !p.sprinting && !(p.weapon !== 'launcher' && p.reloading) ? 1 : 0) - p.ads) * Math.min(1, dt * 12)
    const ev = p.move(dt, input, this.col, t)
    if (ev === 'jump') this.sfx('jump')
    if (ev === 'splash') this.sfx('splash')
    this.handleWeaponKeys()
    this.updateLock(dt)
    if (input.consume('reload')) {
      if (p.startReload(t)) this.sfx('reload')
      else if (p.weapon === 'rifle' && p.reserve < 1) this.ammoHint(true)
    }
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
    if (this.time < p.switchUntil) return
    if (p.weapon === 'launcher') {
      this.tryLauncherFire()
      return
    }
    const t = this.time
    if (p.reloading || t < p.nextFire) return
    const pistol = p.weapon === 'pistol'
    if (pistol ? p.pmag <= 0 : p.mag <= 0) {
      if (this.input.consume('fire')) this.sfx('empty')
      if (p.startReload(t)) this.sfx('reload')
      else if (!pistol && p.rifleDry) {
        // Rifle is bone dry: fall back to the sidearm and point at the nearest resupply.
        p.switchWeapon('pistol', t)
        this.sfx('swap')
        this.ammoHint(true)
      }
      return
    }
    p.nextFire = t + 60 / (pistol ? CONFIG.pistol.rpm : CONFIG.weapon.rpm)
    if (pistol) p.pmag -= 1
    else p.mag -= 1
    p.shots += 1
    const origin = this.camera.getWorldPosition(tmpV).clone()
    const dir = this.aimDir(p.spread(t))
    this.viewModel.fire()
    const muzzle = this.viewModel.muzzle(tmpV2).clone()
    this.muzzleLight.position.copy(muzzle)
    this.muzzleLight.intensity = 3
    this.fire({ team: p.team, name: p.name, unit: p }, origin, dir, pistol ? CONFIG.pistol.damage : CONFIG.weapon.damage, pistol ? 0xfff2c8 : 0xffe2a0, muzzle, true, pistol)
    p.applyRecoil(t)
    this.sfx('shot')
    if ((pistol ? p.pmag : p.mag) === 0) {
      if (p.startReload(t)) this.sfx('reload')
      else if (!pistol && p.rifleDry) this.ammoHint(true)
    } else if (!pistol && p.reserve < CONFIG.lowReserve && p.mag === 10) this.ammoHint(false)
  }

  /** Flyfish-2: dumb-fire straight, or guided when a lock is held (right mouse on a vehicle/aircraft/emplacement). */
  private tryLauncherFire(): void {
    const p = this.player
    const t = this.time
    if (p.rocketReloadUntil > 0 || t < p.nextFire) return
    if (p.rocket <= 0) {
      if (this.input.consume('fire')) {
        this.sfx('empty')
        if (p.rocketReserve <= 0) this.toast(L('导弹已用完，前往餐厅补给点补充', 'Out of missiles — resupply at a canteen'), 'bad')
      }
      if (p.startRocketReload(t)) this.sfx('reload')
      return
    }
    const L0 = CONFIG.launcher
    p.rocket = 0
    p.nextFire = t + 0.6
    p.shots += 1
    const origin = this.camera.getWorldPosition(new THREE.Vector3())
    const dir = this.aimDir(p.ads > 0.6 ? 0.002 : 0.012)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const from = origin.clone().addScaledVector(dir, 1.1).addScaledVector(right, 0.28).add(new THREE.Vector3(0, -0.12, 0))
    const locked = p.lockTarget && p.lockT >= L0.lockTime
    const seeker = locked ? this.seekerFor(p.lockTarget) : null
    if (seeker) dir.y += 0.06
    this.ord.launch({
      kind: 'missile', from, dir: dir.normalize(), speed: L0.speed, turn: L0.turn, owner: { team: p.team, name: p.name, unit: p }, seeker,
      life: L0.life, radius: L0.radius, damage: L0.damage, direct: L0.direct, weapon: launcherName(), gravity: seeker ? 0 : -1.5,
    })
    this.fx.puff(from.clone().addScaledVector(dir, -1.6), 0.9, 0.9, 0xd9dcdf, 2, 0.2)
    this.fx.shake = Math.max(this.fx.shake, 0.18)
    this.sfx('missile')
    p.lockT = 0
    p.lockTarget = null
    this.viewModel.setLock(0)
    if (p.startRocketReload(t)) this.sfx('reload')
  }

  /** Everything a missile can lock on to, for a given shooter team. */
  private hardware(team: number, airOnly = false): Hardware[] {
    const out: Hardware[] = []
    for (const h of this.helis) if (h.team !== team && h.airborne && h.alive) out.push({ ref: h, team: h.team, pos: h.center.clone(), air: true, label: h.name })
    for (const a of this.air) {
      if (a.team === team || a.ref instanceof Heli) continue
      out.push({ ref: a.ref, team: a.team, pos: a.pos, air: true, label: L('无人机', 'drone') })
    }
    if (airOnly) return out
    for (const v of this.vehicles) {
      if (!v.enabled || !v.alive) continue
      const vt = v.driver ? v.driver.team : v.team
      if (vt === team || (!v.driver && vt < 0)) continue
      out.push({ ref: v, team: vt, pos: v.center, air: false, label: v.label })
    }
    for (const e of this.emps) if (e.enabled && e.alive && e.team >= 0 && e.team !== team) out.push({ ref: e, team: e.team, pos: e.center, air: false, label: e.name })
    return out
  }

  /** Best target inside the aim cone with line of sight. */
  private lockCandidate(origin: THREE.Vector3, dir: THREE.Vector3, team: number, cone: number, range: number, airOnly: boolean): Hardware | null {
    let best: Hardware | null = null
    let bestA = cone
    for (const h of this.hardware(team, airOnly)) {
      tmpV3.subVectors(h.pos, origin)
      const d = tmpV3.length()
      if (d > range || d < 4) continue
      const a = tmpV3.normalize().angleTo(dir)
      if (a < bestA && this.col.lineOfSight(origin, h.pos)) {
        bestA = a
        best = h
      }
    }
    return best
  }

  private seekerFor(ref: unknown): SeekerSpec | null {
    if (ref instanceof Heli) return { point: () => (ref.alive && ref.airborne ? ref.center.clone() : null), ref }
    if (ref instanceof Vehicle) return { point: () => (ref.alive ? ref.center : null), ref }
    if (ref instanceof Emplacement) return { point: () => (ref.alive ? ref.center : null), ref }
    if (ref instanceof ScoutDrone) return { point: () => (ref.active ? ref.pos : null), ref }
    if (ref instanceof Drone) return { point: () => (ref.active ? ref.pos : null), ref }
    return null
  }

  private updateLock(dt: number): void {
    const p = this.player
    const L0 = CONFIG.launcher
    if (p.weapon !== 'launcher' || p.ads < 0.6 || p.rocket <= 0) {
      if (p.lockT > 0 || p.lockTarget) {
        p.lockT = 0
        p.lockTarget = null
        this.viewModel.setLock(0)
      }
      return
    }
    const origin = this.camera.getWorldPosition(tmpV).clone()
    const dir = this.aimDir(0)
    const cand = this.lockCandidate(origin, dir, p.team, L0.lockCone, L0.lockRange, false)
    if (cand && cand.ref === p.lockTarget) {
      const was = p.lockT >= L0.lockTime
      p.lockT = Math.min(L0.lockTime, p.lockT + dt)
      if (!was && p.lockT >= L0.lockTime) this.sfx('locked')
      else if (!was && this.time >= this.lockBeepAt) {
        this.lockBeepAt = this.time + 0.18
        this.sfx('lock')
      }
    } else {
      p.lockTarget = cand ? cand.ref : null
      p.lockT = 0
    }
    this.viewModel.setLock(p.lockTarget ? p.lockT / L0.lockTime : 0)
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
      if (v.island && v.team !== p.team) this.prompt = L('巡逻艇归出海岛占领方所有：先占领出海岛', 'Patrol boats belong to whoever holds the Offshore Isle')
      else this.prompt = L(`按 E 驾驶${v.label}（耐久 ${Math.ceil(v.hp)}）`, `Press E to drive the ${v.label} (armour ${Math.ceil(v.hp)})`)
      return
    }
    const e = this.nearEmplacement()
    if (e) {
      if (!e.alive) this.prompt = L(`${e.name} 已被摧毁，${Math.ceil(e.respawnAt - this.time)} 秒后修复`, `${e.name} destroyed — repaired in ${Math.ceil(e.respawnAt - this.time)}s`)
      else if (e.team !== p.team) this.prompt = L(`占领出海岛后才能操作${e.name}`, `Capture the Offshore Isle to operate the ${e.name}`)
      else if (e.kind === 'aa') this.prompt = L('按 E 操作海盾防空炮（F 切换瞄准/锁定模式）', 'Press E to man the Sea Shield AA (F toggles aim / lock mode)')
      else {
        const wait = e.readyAt - this.time
        this.prompt = wait > 0 ? L(`潮汐火箭炮装填中 ${Math.ceil(wait)} 秒（仍可进入选定目标）`, `Tide rocket battery reloading ${Math.ceil(wait)}s (you can still aim)`) : L('按 E 操作潮汐远程火箭炮：大范围轰炸科学园', 'Press E to operate the Tide rocket battery: wide-area bombardment')
      }
      return
    }
    const pad = this.nearDronePad()
    if (pad >= 0) {
      const wait = this.drone.readyAt - this.time
      const d = DRONE_PADS[pad]
      this.prompt = wait > 0 ? L(`无人机充电中 ${Math.ceil(wait)} 秒`, `Drone charging ${Math.ceil(wait)}s`) : L(`按 E 起飞侦察无人机（${d.name}）`, `Press E to launch the recon drone (${d.en})`)
      return
    }
    const hp = HELIPADS[PLAYER_TEAM]
    if (Math.hypot(p.pos.x - hp.x, p.pos.z - hp.z) < hp.r + 3 && p.pos.y < 2) {
      const h = this.helis[PLAYER_TEAM]
      const wait = h.readyAt - this.time
      if (this.heliMenu) this.prompt = L('选择机降目标：', 'Choose insertion target: ') + heliTargets().map((tg, i) => `${i + 1} ${pointShort(POINTS[tg.index])}`).join(' · ') + L('（E 取消）', ' (E cancels)')
      else if (h.busy) this.prompt = L('直升机执行任务中', 'Helicopter is on a mission')
      else if (wait > 0) this.prompt = L(`直升机整备中 ${Math.ceil(wait)} 秒`, `Helicopter rearming ${Math.ceil(wait)}s`)
      else this.prompt = L('按 E 登上直升机（机降 + 空中火力支援）', 'Press E to board the helicopter (air insertion + fire support)')
    }
  }

  private nearVehicle(): Vehicle | null {
    const p = this.player
    let best: Vehicle | null = null
    let bestD = 4.2
    for (const v of this.vehicles) {
      if (!v.enabled || !v.alive || v.driver) continue
      const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z)
      if (d < bestD && Math.abs(v.pos.y - p.pos.y) < 3) {
        best = v
        bestD = d
      }
    }
    return best
  }

  private nearEmplacement(): Emplacement | null {
    if (!RT.sea) return null
    const p = this.player
    for (const e of this.emps) {
      if (!e.enabled) continue
      const r = e.kind === 'aa' ? 3.8 : 4.8
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < r && Math.abs(e.pos.y - p.pos.y) < 3) return e
    }
    return null
  }

  private nearDronePad(): number {
    const p = this.player
    return DRONE_PADS.findIndex(d => Math.hypot(d.x - p.pos.x, d.z - p.pos.z) < d.r + 0.6 && Math.abs(p.pos.y - d.y) < 1.2)
  }

  private interact(): void {
    const p = this.player
    const v = this.nearVehicle()
    if (v) {
      if (v.island && v.team !== p.team) {
        this.sfx('deny')
        return
      }
      this.enterVehicle(v)
      return
    }
    const e = this.nearEmplacement()
    if (e) {
      if (!e.alive || e.team !== p.team || e.operator) {
        this.sfx('deny')
        return
      }
      this.enterSeat(e)
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
      this.toast(L('无人机升空：飞越敌区自动标记敌人；1-5 呼叫直升机支援，B 呼叫火箭炮轰炸', 'Drone up: fly over enemies to mark them; 1-5 call helicopter support, B calls a rocket strike'), 'info')
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

  // ─── island emplacements (player seat) ──────────────────────────────────
  private enterSeat(e: Emplacement): void {
    const p = this.player
    e.operator = p
    this.seat = e
    e.sign.visible = false
    p.mode = e.kind
    p.sheltered = false
    p.ads = 0
    p.lockT = 0
    p.lockTarget = null
    this.viewModel.setLock(0)
    this.sfx('vehicle')
    if (e.kind === 'aa') {
      p.yaw = e.yaw
      p.pitch = Math.min(0.6, e.pitch)
      this.toast(L('海盾防空炮：左键开火。F 切换【瞄准模式】高射炮 / 【锁定模式】防空导弹，右键放大，E 离开', 'Sea Shield AA: left click fires. F toggles AIM (flak) / LOCK (SAM) mode, right click zooms, E leaves'), 'info')
    } else {
      if (this.cursor.lengthSq() === 0 || this.cursor.z < SHORE_Z) this.cursor.set(0, 0, 18)
      this.toast(L('潮汐远程火箭炮：WASD/鼠标移动目标圈，左键发射 10 连齐射，Shift 加速，E 离开', 'Tide rocket battery: WASD/mouse moves the target ring, left click fires a 10-rocket salvo, Shift speeds up, E leaves'), 'info')
    }
  }

  private exitSeat(): void {
    const e = this.seat
    const p = this.player
    if (!e) return
    e.operator = null
    e.sign.visible = true
    e.lockT = 0
    e.lockTarget = null
    this.seat = null
    this.cursorRing.visible = false
    if (p.mode === 'aa' || p.mode === 'arty') {
      p.mode = 'foot'
      const back = e.kind === 'aa' ? 2.6 : 5.5
      p.pos.set(e.pos.x + Math.sin(p.yaw) * back, e.pos.y, e.pos.z + Math.cos(p.yaw) * back)
      p.pos.y = this.col.groundAt(p.pos.x, p.pos.z, 0.4, e.pos.y + 2)
      p.prev.copy(p.pos)
      p.vel.set(0, 0, 0)
      p.pitch = 0
    }
  }

  private stepAA(dt: number, look: { x: number; y: number }): void {
    const e = this.seat!
    const p = this.player
    const input = this.input
    const A = CONFIG.aa
    if (!e.alive || e.team !== p.team) {
      this.exitSeat()
      return
    }
    p.ads += ((input.held('aim') ? 1 : 0) - p.ads) * Math.min(1, dt * 10)
    p.look(look.x * (1 - p.ads * 0.55), look.y * (1 - p.ads * 0.55))
    p.pitch = Math.max(-0.12, Math.min(1.45, p.pitch))
    e.yaw = p.yaw
    e.pitch = p.pitch
    p.prev.copy(p.pos)
    e.seat(tmpV)
    p.pos.set(tmpV.x, tmpV.y - p.eyeY, tmpV.z)
    if (input.consume('mode')) {
      e.lockMode = !e.lockMode
      e.lockT = 0
      e.lockTarget = null
      this.sfx('swap')
      this.toast(e.lockMode ? L('锁定模式：准星对准飞行器保持锁定，锁定后左键发射防空导弹', 'LOCK mode: keep the reticle on an aircraft until locked, then left click fires a SAM') : L('瞄准模式：高射炮近炸引信，适合近距离与水面目标', 'AIM mode: proximity-fused flak, good at short range and against boats'), 'info')
    }
    const origin = this.camera.getWorldPosition(tmpV).clone()
    const dir = this.aimDir(0)
    const t = this.time
    if (!e.lockMode) {
      e.flakCd -= dt
      if (input.held('fire') && e.flakCd <= 0) {
        e.flakCd = A.flakInterval
        this.fireFlak(e, { team: p.team, name: p.name, unit: p }, origin, this.aimDir(0.006), true)
        this.fx.shake = Math.max(this.fx.shake, 0.12)
      }
    } else {
      const cand = this.lockCandidate(origin, dir, p.team, A.samCone, A.range, true)
      if (cand && cand.ref === e.lockTarget) {
        const was = e.lockT >= A.samLock
        e.lockT = Math.min(A.samLock, e.lockT + dt)
        if (!was && e.lockT >= A.samLock) this.sfx('locked')
        else if (!was && t >= this.lockBeepAt) {
          this.lockBeepAt = t + 0.15
          this.sfx('lock')
        }
      } else {
        e.lockTarget = cand ? cand.ref : null
        e.lockT = 0
      }
      if (input.consume('fire')) {
        if (t < e.samReadyAt) this.sfx('deny')
        else if (e.lockTarget && e.lockT >= A.samLock) {
          this.launchSam(e, { team: p.team, name: p.name, unit: p }, e.lockTarget)
          e.lockT = 0
        } else this.sfx('deny')
      }
    }
    const mode = e.lockMode ? L('锁定模式', 'LOCK') : L('瞄准模式', 'AIM')
    const sam = e.samReadyAt - t
    this.prompt = `${e.name} · ${mode} · ${L('耐久', 'armour')} ${Math.ceil(e.hp)}/${e.maxHp}${e.lockMode ? (sam > 0 ? L(` · 导弹装填 ${Math.ceil(sam)} 秒`, ` · SAM reload ${Math.ceil(sam)}s`) : L(' · 导弹就绪', ' · SAM ready')) : ''} · ${L('F 切换 · E 离开', 'F toggle · E leave')}`
    if (input.consume('interact')) this.exitSeat()
  }

  private stepArty(dt: number, look: { x: number; y: number }): void {
    const e = this.seat!
    const p = this.player
    const input = this.input
    const A = CONFIG.artillery
    if (!e.alive || e.team !== p.team) {
      this.exitSeat()
      return
    }
    p.prev.copy(p.pos)
    const sp = A.cursorSpeed * (input.held('sprint') ? 2.2 : 1) * dt
    this.cursor.x -= input.move.x * sp + look.x * 55
    this.cursor.z += input.move.y * sp - look.y * 55
    this.cursor.x = Math.max(LAND.minX - 10, Math.min(LAND.maxX + 10, this.cursor.x))
    this.cursor.z = Math.max(SHORE_Z - 25, Math.min(LAND.maxZ, this.cursor.z))
    const dx = this.cursor.x - e.pos.x, dz = this.cursor.z - e.pos.z
    const dist = Math.hypot(dx, dz)
    if (dist > A.range) {
      this.cursor.x = e.pos.x + (dx / dist) * A.range
      this.cursor.z = e.pos.z + (dz / dist) * A.range
    }
    this.cursor.y = Math.max(0, this.col.groundAt(this.cursor.x, this.cursor.z, 0.2, 80))
    e.track(dx, dist * 0.6, dz, dt, 1.6)
    const wait = e.readyAt - this.time
    if (input.consume('fire')) {
      if (wait > 0 || e.salvoLeft > 0) this.sfx('deny')
      else {
        this.startSalvo(e, this.cursor.x, this.cursor.z, p.team)
        this.toast(L(`火箭炮齐射已发射 → 距离 ${Math.round(dist)} 米`, `Salvo away → ${Math.round(dist)} m`), 'good')
      }
    }
    this.prompt = wait > 0
      ? L(`潮汐火箭炮装填中 ${Math.ceil(wait)} 秒 · E 离开`, `Tide battery reloading ${Math.ceil(wait)}s · E leave`)
      : L(`潮汐火箭炮就绪 · 目标距离 ${Math.round(dist)} 米 · 左键齐射 · E 离开`, `Tide battery ready · target ${Math.round(dist)} m · left click to fire · E leave`)
    if (input.consume('interact')) this.exitSeat()
  }

  // ─── vehicles, helicopter, drone ────────────────────────────────────────
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
    this.toast(L(`直升机起飞，目标：${target.name}。可在舱门射击，按 E 提前跳伞`, `Lift-off to ${target.name}. Fire from the door, press E to jump early`), 'good')
  }

  private callHeliSupport(choice: number): void {
    const h = this.helis[PLAYER_TEAM]
    const target = heliTargets()[choice]
    if (!h.call({ insert: false, x: target.x, z: target.z, name: target.name }, this.time, null)) {
      this.toast(h.busy ? L('直升机正在执行任务', 'Helicopter is on a mission') : L(`直升机整备中 ${Math.ceil(h.readyAt - this.time)} 秒`, `Helicopter rearming ${Math.ceil(h.readyAt - this.time)}s`), 'bad')
      this.sfx('deny')
      return
    }
    this.sfx('heliCall')
    this.toast(L(`空中支援出发：${target.name}`, `Air support inbound: ${target.name}`), 'good')
  }

  onHeliDrop(heli: Heli): void {
    if (heli.passenger !== this.player || this.player.mode !== 'heli') return
    this.exitHeli(L('已机降：直升机将在上空提供火力支援', 'Inserted: the helicopter will circle and provide fire support'))
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
    this.toast(L(`${heli.name} 被击落！`, `${heli.name} shot down!`), heli.team === PLAYER_TEAM ? 'bad' : 'good')
    this.splash(heli.pos, 8, 80, { team: 1 - heli.team, name: L('坠机', 'crash') })
  }

  private stepHeliRide(dt: number, look: { x: number; y: number }): void {
    const p = this.player
    const h = this.heliRide
    if (!h || !h.alive) {
      if (h) this.exitHeli(L('直升机受损，紧急跳伞！', 'Helicopter hit — bail out!'))
      if (p.alive) this.damageUnit(p, 35, { team: 1, name: L('坠机', 'crash') }, false, p.pos)
      return
    }
    p.look(look.x, look.y)
    p.ads += ((this.input.held('aim') ? 1 : 0) - p.ads) * Math.min(1, dt * 12)
    p.prev.copy(p.pos)
    h.seat(tmpV)
    p.pos.set(tmpV.x, tmpV.y - p.eyeY + 0.2, tmpV.z)
    p.vel.set(0, 0, 0)
    this.handleWeaponKeys()
    this.updateLock(dt)
    if (this.input.consume('reload')) {
      if (p.startReload(this.time)) this.sfx('reload')
    }
    if (this.input.held('fire')) this.tryPlayerFire()
    this.prompt = h.phase === 'hover' ? L('即将机降…', 'Inserting…') : L(`乘坐直升机前往 ${h.mission?.name ?? ''} · 按 E 跳伞`, `En route to ${h.mission?.name ?? ''} · press E to jump`)
    if (this.input.consume('interact')) this.exitHeli(L('跳伞！', 'Jump!'))
  }

  private enterVehicle(v: Vehicle): void {
    const p = this.player
    v.driver = p
    this.vehicle = v
    p.mode = 'vehicle'
    p.sheltered = true
    p.ads = 0
    p.lockT = 0
    p.lockTarget = null
    this.viewModel.setLock(0)
    this.camYaw = v.yaw + Math.PI
    this.camPitch = -0.25
    this.sfx('vehicle')
    this.toast(L(`${v.label}：W/S 油门，A/D 转向，左键车载机枪，E 下车`, `${v.label}: W/S throttle, A/D steer, left click mounted gun, E to exit`), 'info')
  }

  private exitVehicle(): void {
    const v = this.vehicle
    const p = this.player
    if (!v) return
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw)
    const offsets: [number, number][] = [[2.6, 0], [-2.6, 0], [0, -4], [0, 4.2], [3, -3], [-3, -3], [4.8, 0], [-4.8, 0], [0, 6.5], [0, -6.5]]
    let wet: THREE.Vector3 | null = null
    let placed = false
    for (const [lx, lz] of offsets) {
      const x = v.pos.x + lx * c + lz * s, z = v.pos.z - lx * s + lz * c
      const g = this.col.groundAt(x, z, 0.4, v.pos.y + 1.5)
      const probe = { x, y: g, z }
      this.col.pushOut(probe, 0.4, 1.75, 0.62)
      if (Math.hypot(probe.x - x, probe.z - z) >= 0.05) continue
      if (v.kind === 'boat' && isWater(x, z) && g < -0.5) {
        wet ??= new THREE.Vector3(x, g, z)
        continue
      }
      p.pos.set(x, g, z)
      placed = true
      break
    }
    if (!placed && wet) p.pos.copy(wet)
    else if (!placed) p.pos.set(v.pos.x, v.pos.y + 2.5, v.pos.z)
    p.prev.copy(p.pos)
    p.vel.set(0, 0, 0)
    p.yaw = this.camYaw
    p.pitch = 0
    v.driver = null
    this.vehicle = null
    p.mode = 'foot'
    p.sheltered = false
    this.audio.setEngine(0)
    if (v.kind === 'boat' && isWater(p.pos.x, p.pos.z)) this.toast(L('涉水登陆：向岸边或台阶前进即可上岸', 'Wading ashore: head for the bank or the steps'), 'info')
  }

  private stepVehicle(dt: number, look: { x: number; y: number }): void {
    const v = this.vehicle!
    const p = this.player
    const input = this.input
    this.camYaw -= look.x
    this.camPitch = Math.max(-0.9, Math.min(0.35, this.camPitch - look.y))
    const impact = v.drive(dt, input.move.y, input.move.x, this.col)
    if (impact > 12) this.damageVehicle(v, (impact - 12) * 6, { team: -1, name: L('撞击', 'impact') })
    if (!this.vehicle) return
    p.prev.copy(p.pos)
    p.pos.copy(v.pos)
    this.audio.setEngine(Math.min(1, Math.abs(v.speed) / 20) * 0.8 + 0.2, v.kind === 'boat')
    // Ramming.
    if (v.kind === 'car' && Math.abs(v.speed) > 7) {
      for (const u of this.units) {
        if (u === p || !u.alive || u.sheltered) continue
        if (Math.hypot(u.pos.x - v.pos.x, u.pos.z - v.pos.z) < 2.6 && Math.abs(u.pos.y - v.pos.y) < 2) {
          if (u.team !== p.team) this.damageUnit(u, CONFIG.car.ramDamage * Math.abs(v.speed) / CONFIG.car.maxSpeed, { team: p.team, name: p.name, unit: p }, false, v.pos, L('战车撞击', 'ramming'))
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
    let nearShore = false
    if (v.kind === 'boat') {
      for (const [ox, oz] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) if (!isWater(v.pos.x + ox, v.pos.z + oz)) nearShore = true
    }
    const kmh = Math.round(Math.abs(v.speed) * 3.6)
    this.prompt = `${v.label} · ${L('速度', 'speed')} ${kmh} km/h · ${L('耐久', 'armour')} ${Math.ceil(v.hp)}/${v.maxHp}${nearShore ? L(' · 已靠岸，按 E 登陆', ' · at the shore, E to land') : L(' · 按 E 下车', ' · E to exit')}`
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
    const arty = this.emps.find(e => e.kind === 'arty')
    const artyOk = RT.sea && arty && arty.enabled && arty.alive && arty.team === p.team
    const artyTxt = artyOk ? (this.time >= arty.readyAt ? L(' · B 火箭炮轰炸此处', ' · B rocket strike here') : L(` · 火箭炮 ${Math.ceil(arty.readyAt - this.time)} 秒`, ` · rockets ${Math.ceil(arty.readyAt - this.time)}s`)) : ''
    this.prompt = L(`无人机侦察 · 剩余 ${Math.ceil(left)} 秒 · 已标记敌人 ${n} · 1-5 直升机支援`, `Drone recon · ${Math.ceil(left)}s left · ${n} enemies marked · 1-5 heli support`) + artyTxt + L(' · E 返回', ' · E return')
    const choice = (['n1', 'n2', 'n3', 'n4', 'n5'] as const).findIndex(a => this.input.consume(a))
    if (choice >= 0) this.callHeliSupport(choice)
    if (this.input.consume('strike')) {
      if (!RT.sea) this.toast(L('远程轰炸需在出海模式中占领出海岛', 'Rocket strikes need the Offshore Isle (sea mode)'), 'bad')
      else if (!artyOk) this.toast(L('需先占领出海岛并保证火箭炮完好', 'Hold the Offshore Isle with an intact rocket battery first'), 'bad')
      else if (this.time < arty.readyAt || arty.salvoLeft > 0) this.sfx('deny')
      else {
        this.startSalvo(arty, d.pos.x, d.pos.z, p.team)
        this.toast(L('已指引潮汐火箭炮轰炸无人机下方区域！', 'Rocket battery tasked on the area below the drone!'), 'good')
      }
    }
    if (left <= 0 || this.input.consume('interact')) this.endDrone()
  }

  private endDrone(msg?: string): void {
    this.drone.land(this.time)
    this.player.mode = 'foot'
    const n = this.units.filter(u => u.team !== PLAYER_TEAM && u.alive && u.spottedUntil > this.time).length
    this.toast(msg ?? L(`无人机返航，${n} 名敌人保持标记`, `Drone returning — ${n} enemies stay marked`), msg ? 'bad' : 'info')
  }

  // ─── combat ─────────────────────────────────────────────────────────────
  /** Hitscan shot. `visualFrom` is where the tracer starts (muzzle). */
  fire(shooter: Shooter, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, tracer: number, visualFrom?: THREE.Vector3, byPlayer = false, pistol = false): void {
    const range = pistol ? CONFIG.pistol.range : CONFIG.weapon.range
    const wall = this.col.raycast(origin, dir, range)
    let bestT = wall ? wall.t : range
    let hitUnit: Unit | null = null
    let head = false
    let hitThing: unknown = null
    for (const u of this.units) {
      if (u.team === shooter.team || u === shooter.unit || u.sheltered) continue
      const h = rayUnit(origin, dir, u, bestT)
      if (h && h.t < bestT) {
        bestT = h.t
        hitUnit = u
        head = h.head
      }
    }
    const thing = this.rayHardware(origin, dir, bestT, shooter.team)
    if (thing) {
      bestT = thing.t
      hitThing = thing.ref
      hitUnit = null
    }
    const end = origin.clone().addScaledVector(dir, bestT)
    const from = visualFrom ?? origin
    if (byPlayer || Math.random() < 0.6) this.fx.tracer(from, end, tracer)
    if (!byPlayer && shooter.unit) this.sfx('enemyShot', from)
    if (hitUnit) {
      this.fx.blood(end)
      this.damageUnit(hitUnit, damage * (head ? (pistol ? CONFIG.pistol.headMult : CONFIG.weapon.headMult) : 1), shooter, head, origin, pistol ? pistolName() : weaponName())
    } else if (hitThing) {
      this.fx.burst(end, 5, 0xfff0b0, 5, 0.05, 0.25)
      this.damageThing(hitThing, damage * 0.75, shooter)
      if (byPlayer) this.events?.hitmarker(false, false)
    } else if (wall) {
      this.fx.impact(end, tmpV.set(wall.nx, wall.ny, wall.nz), wall.water)
    }
  }

  /** Nearest vehicle / aircraft / drone / emplacement along a ray that is hostile to `team`. */
  private rayHardware(o: THREE.Vector3, d: THREE.Vector3, maxT: number, team: number): { t: number; ref: unknown } | null {
    let best = maxT
    let ref: unknown = null
    for (const v of this.vehicles) {
      if (!v.enabled || !v.alive) continue
      const vt = v.driver ? v.driver.team : v.team
      if (vt === team) continue
      const t = v.rayHit(o, d, best)
      if (t >= 0 && t < best) {
        best = t
        ref = v
      }
    }
    for (const h of this.helis) {
      if (h.team === team || !h.airborne) continue
      const t = h.rayHit(o, d, best)
      if (t >= 0 && t < best) {
        best = t
        ref = h
      }
    }
    for (const a of this.air) {
      if (a.team === team || a.ref instanceof Heli) continue
      const t = raySphere(o, d, a.pos.x, a.pos.y, a.pos.z, 1.5)
      if (t >= 0 && t < best) {
        best = t
        ref = a.ref
      }
    }
    for (const e of this.emps) {
      if (!e.enabled || !e.alive || e.team === team) continue
      const t = e.rayHit(o, d, best)
      if (t >= 0 && t < best) {
        best = t
        ref = e
      }
    }
    return ref ? { t: best, ref } : null
  }

  /** Damage any non-soldier target. */
  private damageThing(ref: unknown, amount: number, by: Shooter, weapon?: string): void {
    if (ref instanceof Vehicle) this.damageVehicle(ref, amount, by)
    else if (ref instanceof Heli) {
      const wasAlive = ref.alive
      ref.damage(amount, this)
      if (wasAlive && !ref.alive && by.unit) by.unit.kills += 0
    } else if (ref instanceof Emplacement) this.damageEmplacement(ref, amount, by)
    else if (ref instanceof ScoutDrone) {
      if (!ref.active) return
      ref.hp -= amount
      if (ref.hp <= 0) {
        this.fx.explosion(ref.pos.clone(), 0.6)
        this.sfx('explode', ref.pos)
        ref.down(this.time)
        this.toast(ref.team === PLAYER_TEAM ? L('我方侦察无人机被击落', 'Our scout drone was shot down') : L(`${by.name} 击落了敌方侦察无人机`, `${by.name} downed the enemy scout drone`), ref.team === PLAYER_TEAM ? 'bad' : 'good')
      }
    } else if (ref instanceof Drone) {
      if (!ref.active) return
      ref.hp -= amount
      if (ref.hp <= 0) {
        this.fx.explosion(ref.pos.clone(), 0.6)
        this.sfx('explode', ref.pos)
        this.endDrone(L('无人机被敌方防空火力击落！', 'Your drone was shot down!'))
        this.drone.readyAt = this.time + CONFIG.drone.cooldown * 1.5
      }
    } else if (ref && typeof ref === 'object' && 'isPlayer' in ref) {
      this.damageUnit(ref as Unit, amount, by, false, (ref as Unit).pos, weapon)
    }
  }

  damageUnit(u: Unit, amount: number, by: Shooter, head: boolean, from: THREE.Vector3, weapon: string = weaponName()): void {
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
    if (u instanceof Bot) {
      if (u.ride) {
        u.ride.v.driver = null
        u.ride = null
      }
      u.kill(this)
    }
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
      if (this.seat) this.exitSeat()
      if (this.drone.active) this.drone.land(this.time)
      this.heliMenu = false
      this.cursorRing.visible = false
      p.mode = 'dead'
      p.sheltered = false
      p.lockT = 0
      p.lockTarget = null
      this.viewModel.setLock(0)
      this.audio.setEngine(0)
      this.toast(L(`你被 ${by.name} 击倒，${CONFIG.player.respawn} 秒后重新部署`, `Taken down by ${by.name} — redeploying in ${CONFIG.player.respawn}s`), 'bad')
    }
  }

  damageVehicle(v: Vehicle, amount: number, by: Shooter): void {
    if (!v.alive) return
    v.hp -= amount
    if (v.hp > 0) return
    v.hp = 0
    const driver = v.driver
    v.destroy()
    v.respawnAt = this.time + (v.kind === 'car' ? CONFIG.car.respawn : CONFIG.boat.respawn)
    this.fx.explosion(v.center.clone(), 1.2)
    this.sfx('explode', v.pos)
    this.splash(v.center, 5, 60, by)
    if (v === this.vehicle) {
      this.exitVehicle()
      this.damageUnit(this.player, 45, by, false, v.pos, L('载具爆炸', 'vehicle explosion'))
      this.toast(L(`${v.label} 被摧毁！`, `Your ${v.label} was destroyed!`), 'bad')
    } else {
      if (driver instanceof Bot) {
        v.driver = null
        driver.ride = null
        driver.sheltered = false
        this.damageUnit(driver, 999, by, false, v.pos, L('载具爆炸', 'vehicle explosion'))
      }
      if (by.unit === this.player) this.toast(L(`摧毁敌方${v.label}`, `Enemy ${v.label} destroyed`), 'good')
    }
  }

  private damageEmplacement(e: Emplacement, amount: number, by: Shooter): void {
    if (!e.alive || !e.enabled) return
    e.hp -= amount
    if (by.unit === this.player) this.events?.hitmarker(false, false)
    if (e.hp > 0) return
    e.hp = 0
    const wasSeat = this.seat === e
    e.destroy(this.time)
    this.fx.explosion(e.center.clone(), 1.6)
    this.sfx('explode', e.pos)
    const mine = e.team === PLAYER_TEAM
    this.toast(mine ? L(`我方${e.name} 被摧毁！`, `Our ${e.name} was destroyed!`) : L(`${by.name} 摧毁了敌方${e.name}`, `${by.name} destroyed the enemy ${e.name}`), mine ? 'bad' : 'good')
    if (wasSeat) {
      this.seat = e
      this.exitSeat()
      this.damageUnit(this.player, 40, by, false, e.pos, L('爆炸', 'explosion'))
    }
  }

  vehicleOf(u: Unit): { pos: THREE.Vector3; center: THREE.Vector3; ref?: unknown } | null {
    if (u instanceof Bot) return u.ride ? { pos: u.ride.v.pos, center: u.ride.v.center, ref: u.ride.v } : null
    if (u !== this.player) return null
    if (this.vehicle) return { pos: this.vehicle.pos, center: this.vehicle.center, ref: this.vehicle }
    if (this.heliRide) return { pos: this.heliRide.pos, center: this.heliRide.center.clone(), ref: this.heliRide }
    return null
  }

  // ─── ordnance host ──────────────────────────────────────────────────────
  sweep(p: Projectile, from: THREE.Vector3, dir: THREE.Vector3, len: number): { t: number; direct: unknown; water: boolean } | null {
    const team = p.owner.team
    let best = len
    let direct: unknown = null
    let water = false
    let found = false
    const wall = this.col.raycast(from, dir, len)
    if (wall) {
      best = wall.t
      water = wall.water
      found = true
    }
    if (p.kind !== 'rocket') {
      for (const u of this.units) {
        if (u.team === team || !u.alive || u.sheltered) continue
        const h = rayUnit(from, dir, u, best)
        if (h && h.t < best) {
          best = h.t
          direct = u
          found = true
        }
      }
    }
    const thing = this.rayHardware(from, dir, best, team)
    if (thing) {
      best = thing.t
      direct = thing.ref
      found = true
    }
    // Missiles also blow up on the ground below the sea surface line.
    if (!found && from.y + dir.y * len < WATER_Y && isWater(from.x, from.z)) {
      best = Math.max(0, (WATER_Y - from.y) / (dir.y || -1))
      water = true
      found = true
    }
    return found ? { t: best, direct, water: direct ? false : water } : null
  }

  detonate(p: Projectile, at: THREE.Vector3, direct: unknown, water: boolean): void {
    const big = p.kind === 'rocket'
    if (water) {
      this.fx.impact(at, UP, true)
      this.fx.puff(at.clone().setY(WATER_Y + 0.5), big ? 3 : 2, 1.2, 0xe6f4ff, 1.6, 2)
    }
    this.fx.explosion(at, big ? 1.35 : 0.95)
    this.sfx('explode', at)
    if (this.camera.position.distanceTo(at) < 30) this.fx.shake = Math.max(this.fx.shake, big ? 0.5 : 0.3)
    if (direct) this.damageThing(direct, p.direct, p.owner, p.weapon)
    this.splash(at, p.radius, p.damage, p.owner, p.weapon, direct)
  }

  /** Bots firing a Flyfish-2. */
  fireMissile(bot: Bot, from: THREE.Vector3, dir: THREE.Vector3, seeker: SeekerSpec | null): void {
    const L0 = CONFIG.launcher
    const f = from.clone().addScaledVector(dir, 0.9)
    this.ord.launch({
      kind: 'missile', from: f, dir, speed: L0.speed * 0.9, turn: L0.turn * 0.8, owner: { team: bot.team, name: bot.name, unit: bot }, seeker,
      life: L0.life, radius: L0.radius, damage: L0.damage * 0.8, direct: L0.direct, weapon: launcherName(), gravity: seeker ? 0 : -1.5,
    })
    this.fx.puff(f.clone(), 0.8, 0.8, 0xd9dcdf, 2, 0.2)
    this.sfx('missile', f)
  }

  private fireFlak(e: Emplacement, shooter: Shooter, origin: THREE.Vector3, dir: THREE.Vector3, byPlayer: boolean): void {
    const A = CONFIG.aa
    const muzzle = e.muzzle(new THREE.Vector3())
    let bestT = -1
    let bestRef: unknown = null
    let bestPerp = 0
    for (const a of this.air) {
      if (a.team === e.team || !a.alive || !a.airborne) continue
      tmpV3.subVectors(a.pos, origin)
      const t = tmpV3.dot(dir)
      if (t < 3 || t > A.range) continue
      const perp = tmpV3.addScaledVector(dir, -t).length()
      if (perp < A.fuse && (bestT < 0 || t < bestT)) {
        bestT = t
        bestRef = a.ref
        bestPerp = perp
      }
    }
    if (bestT > 0) {
      const at = origin.clone().addScaledVector(dir, bestT)
      if (this.col.lineOfSight(origin, at)) {
        this.fx.tracer(muzzle, at, 0xffd35c)
        this.fx.burst(at, 10, 0xffc070, 7, 0.07, 0.3, -4)
        this.fx.puff(at, 1.3, 1.3, 0x3c3c3c, 1.6, 0.2)
        this.damageThing(bestRef, A.flakDamage * (1 - bestPerp / (A.fuse + 1.5)), shooter)
        if (byPlayer) this.events?.hitmarker(false, false)
        this.sfx('flak', muzzle)
        return
      }
    }
    this.fire(shooter, origin, dir, A.groundDamage, 0xffd35c, muzzle, byPlayer)
    this.sfx('flak', muzzle)
  }

  private launchSam(e: Emplacement, shooter: Shooter, ref: unknown): void {
    const A = CONFIG.aa
    const seeker = this.seekerFor(ref)
    if (!seeker) return
    const from = e.podMuzzle(new THREE.Vector3())
    const tp = seeker.point()
    const dir = tp ? tmpDir.subVectors(tp, from).normalize().clone() : e.aimDir(new THREE.Vector3())
    dir.y += 0.25
    this.ord.launch({
      kind: 'sam', from, dir: dir.normalize(), speed: A.samSpeed, turn: A.samTurn, owner: shooter, seeker, life: 7, radius: 5, damage: 50,
      direct: A.samDamage, weapon: L('海盾防空导弹', 'Sea Shield SAM'), gravity: 0,
    })
    e.samReadyAt = this.time + A.samReload
    this.fx.puff(from.clone(), 1.4, 1.2, 0xe0e4e8, 2, 0.4)
    this.sfx('missile', from)
    if (ref === this.heliRide || (ref instanceof Drone && this.player.mode === 'drone')) {
      this.toast(L('警告：防空导弹来袭！', 'WARNING: SAM inbound!'), 'bad')
      this.sfx('siren')
    }
  }

  private startSalvo(e: Emplacement, x: number, z: number, team: number): void {
    const A = CONFIG.artillery
    e.salvoLeft = A.rockets
    e.salvoAt = this.time + 0.5
    e.salvoTarget.set(x, 0, z)
    e.salvoOwner = team
    e.readyAt = this.time + A.cooldown
    const color = team === 0 ? 0xff4d5e : 0x3fa9ff
    const ring = new THREE.Mesh(new THREE.RingGeometry(A.radius - 0.8, A.radius, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }))
    const disc = new THREE.Mesh(new THREE.CircleGeometry(A.radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }))
    for (const m of [ring, disc]) {
      m.rotation.x = -Math.PI / 2
      m.position.set(x, Math.max(0, this.col.groundAt(x, z, 0.2, 60)) + 0.15, z)
      m.renderOrder = 4
      this.scene.add(m)
    }
    const until = this.time + 0.5 + A.rockets * 0.18 + A.flight + 1.6
    this.strikes.push({ x, z, r: A.radius, team, until, ring, disc })
    this.sfx('siren')
    if (team !== PLAYER_TEAM) {
      const near = Math.hypot(this.player.pos.x - x, this.player.pos.z - z) < A.radius + 25
      const idx = POINTS.findIndex(p => Math.hypot(p.x - x, p.z - z) < p.r + 12)
      const where = idx >= 0 ? pointName(POINTS[idx]) : L('园区', 'the park')
      this.toast(near ? L('警报：敌方火箭炮齐射即将落在你附近！立即离开红圈', 'ALERT: enemy rocket salvo landing near you — leave the ring!') : L(`警报：敌方火箭炮正在轰炸 ${where}`, `ALERT: enemy rockets hitting ${where}`), 'bad')
    }
  }

  private stepStrikes(): void {
    for (let i = this.strikes.length - 1; i >= 0; i -= 1) {
      const s = this.strikes[i]
      const k = 0.55 + Math.sin(this.wallTime * 9) * 0.35
      ;(s.ring.material as THREE.MeshBasicMaterial).opacity = k
      if (this.time >= s.until) {
        this.scene.remove(s.ring, s.disc)
        s.ring.geometry.dispose()
        s.disc.geometry.dispose()
        this.strikes.splice(i, 1)
      }
    }
  }

  danger(x: number, z: number): { x: number; z: number; r: number } | null {
    for (const s of this.strikes) if (Math.hypot(x - s.x, z - s.z) < s.r + 2) return s
    return null
  }

  /** Emplacement automation: salvo firing, AI air defence and AI bombardment. */
  private stepEmplacements(dt: number, demo: boolean): void {
    const t = this.time
    for (const e of this.emps) {
      if (!e.enabled) continue
      if (!e.alive) {
        if (t >= e.respawnAt) e.repair()
        e.render(dt)
        continue
      }
      if (e.kind === 'arty') {
        if (e.salvoLeft > 0 && t >= e.salvoAt) {
          e.salvoLeft -= 1
          e.salvoAt = t + 0.18
          this.launchRocket(e)
        }
        if (!demo && e.team >= 0 && e.operator === null && e.salvoLeft === 0) this.aiArty(e)
      } else if (e.team >= 0 && e.operator === null) this.autoAA(e, dt)
      e.render(dt)
    }
  }

  private launchRocket(e: Emplacement): void {
    const A = CONFIG.artillery
    const from = e.muzzle(new THREE.Vector3())
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * A.radius * 0.9
    const tx = e.salvoTarget.x + Math.cos(a) * r, tz = e.salvoTarget.z + Math.sin(a) * r
    const ty = Math.max(0, this.col.groundAt(tx, tz, 0.2, 80))
    const T = A.flight + Math.random() * 0.7
    const g = -26
    const vel = new THREE.Vector3((tx - from.x) / T, (ty - from.y) / T - 0.5 * g * T, (tz - from.z) / T)
    const speed = vel.length()
    const team = e.salvoOwner
    this.ord.launch({
      kind: 'rocket', from, dir: vel.normalize(), speed, turn: 0, owner: { team, name: L(`${teamShort(team)}潮汐火箭炮`, `${teamShort(team)} Tide battery`) }, seeker: null,
      life: T + 2.5, radius: A.blast, damage: A.rocketDamage, direct: A.rocketDamage * 1.5, weapon: L('远程火箭炮', 'rocket artillery'), gravity: g,
    })
    this.fx.puff(from.clone(), 1.6, 1.4, 0xd9dcdf, 2.2, 0.5)
    this.sfx('rocket', from)
  }

  /** AI crews pick the enemy-held zone with the most enemies and bombard it. */
  private aiArty(e: Emplacement): void {
    const t = this.time
    const team = e.team
    if (t < this.aiArtyAt[team] || t < e.readyAt) return
    let best: { x: number; z: number; n: number } | null = null
    POINTS.forEach((pt, i) => {
      if (i === ISLAND_POINT) return
      let n = 0
      for (const u of this.units) if (u.alive && u.team !== team && !u.sheltered && Math.hypot(u.pos.x - pt.x, u.pos.z - pt.z) < pt.r + 6) n += u.isPlayer ? 1.5 : 1
      const s = this.match.points[i]
      if (s.owner !== team) n += 0.5
      if (!best || n > best.n) best = { x: pt.x, z: pt.z + (pt.kind === 'egg' ? 17 : 0), n }
    })
    const b = best as { x: number; z: number; n: number } | null
    if (!b || b.n < 1.5) {
      this.aiArtyAt[team] = t + 8
      return
    }
    // Aim at the densest enemy near the zone rather than the zone centre.
    let ax = b.x, az = b.z, cnt = 1
    for (const u of this.units) if (u.alive && u.team !== team && Math.hypot(u.pos.x - b.x, u.pos.z - b.z) < 22) {
      ax += u.pos.x
      az += u.pos.z
      cnt += 1
    }
    this.startSalvo(e, ax / cnt, az / cnt, team)
    this.aiArtyAt[team] = t + RT.bot.artyInterval * (team === PLAYER_TEAM ? 1.4 : 1) + Math.random() * 10
  }

  private autoAA(e: Emplacement, dt: number): void {
    const A = CONFIG.aa
    const t = this.time
    let best: Target | null = null
    let bestD: number = A.autoRange
    for (const a of this.air) {
      if (a.team === e.team || !a.alive || !a.airborne) continue
      const d = a.pos.distanceTo(e.center)
      if (d < bestD && this.col.lineOfSight(e.center, a.pos)) {
        bestD = d
        best = a
      }
    }
    if (!best) {
      e.yaw += dt * 0.25
      e.pitch += (0.5 - e.pitch) * Math.min(1, dt)
      return
    }
    const origin = e.muzzle(tmpV2).clone()
    const lead = tmpV3.copy(best.pos)
    if (best.ref instanceof Heli) lead.addScaledVector(best.ref.vel, bestD / 260)
    const aligned = e.track(lead.x - origin.x, lead.y - origin.y, lead.z - origin.z, dt, 2.4)
    e.flakCd -= dt
    const shooter = { team: e.team, name: e.name }
    if (aligned && e.flakCd <= 0) {
      e.flakCd = 0.24
      const dir = e.aimDir(new THREE.Vector3())
      dir.x += (Math.random() - 0.5) * 0.05
      dir.y += (Math.random() - 0.5) * 0.05
      dir.z += (Math.random() - 0.5) * 0.05
      this.fireFlak(e, shooter, origin, dir.normalize(), false)
    }
    if (best.ref instanceof Heli && t >= e.autoSamAt && t >= e.samReadyAt) {
      e.autoSamAt = t + A.autoSamCd
      this.launchSam(e, shooter, best.ref)
    }
  }

  private stepScouts(dt: number, demo: boolean): void {
    const t = this.time
    for (const s of this.scouts) {
      if (!s.active) {
        if (demo || this.state !== 'playing' || t < s.nextAt) continue
        // Scout the most valuable point: the egg if not ours, else an enemy-held point.
        const st = this.match.points
        const egg = eggIndex(this.match)
        let idx = st[egg].owner !== s.team ? egg : st.findIndex((p, i) => p.owner >= 0 && p.owner !== s.team && (RT.sea || i !== ISLAND_POINT))
        if (idx < 0) idx = egg
        const p = POINTS[idx]
        s.launch(t, p.x, p.z + (p.kind === 'egg' ? 12 : 0))
        this.spottedWarned.delete(s)
        if (s.team !== PLAYER_TEAM) this.toast(L(`敌方侦察无人机飞往 ${pointName(p)}，可用步枪、导弹或防空炮击落`, `Enemy scout drone heading to ${pointName(p)} — shoot it down`), 'bad')
        continue
      }
      const enemies = this.units.filter(u => u.team !== s.team)
      s.step(dt, t, enemies, s.team === PLAYER_TEAM)
      if (s.team !== PLAYER_TEAM && !this.spottedWarned.has(s) && this.player.alive && Math.hypot(this.player.pos.x - s.pos.x, this.player.pos.z - s.pos.z) < CONFIG.scout.markRadius) {
        this.spottedWarned.add(s)
        this.toast(L('你已被敌方侦察无人机发现！', 'You have been spotted by an enemy drone!'), 'bad')
      }
    }
  }

  // ─── bot host (boats) ───────────────────────────────────────────────────
  get boats(): Vehicle[] {
    return this.vehicles.filter(v => v.kind === 'boat' && v.enabled)
  }
  board(bot: Bot, v: Vehicle): void {
    v.driver = bot
    if (v.island) v.setTeam(bot.team)
    bot.sheltered = true
  }
  disembark(bot: Bot, x: number, z: number): void {
    const v = bot.ride?.v
    if (v && v.driver === bot) v.driver = null
    bot.sheltered = false
    const g = this.col.groundAt(x, z, 0.4, 20)
    bot.pos.set(x, g, z)
    bot.prev.copy(bot.pos)
  }

  private throwGrenade(): void {
    const p = this.player
    if (p.grenades <= 0) {
      this.toast(L('手雷已用完，前往餐厅补给点补充', 'Out of grenades — resupply at a canteen'), 'bad')
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
    this.toast(L(`投掷手雷（剩余 ${p.grenades}）`, `Grenade out (${p.grenades} left)`), 'info')
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
        this.splash(g.pos, CONFIG.grenade.radius, CONFIG.grenade.damage, g.owner, L('手雷', 'grenade'))
      }
    }
  }

  /** Area damage with line-of-sight falloff: soldiers, vehicles, aircraft, drones and emplacements. */
  private splash(at: THREE.Vector3, radius: number, damage: number, by: Shooter, weapon = L('爆炸', 'explosion'), skip: unknown = null): void {
    const c = at.clone()
    c.y += 0.3
    for (const u of this.units) {
      if (!u.alive || u.sheltered || u === skip) continue
      if (u.team === by.team && u !== by.unit) continue
      const target = tmpV.set(u.pos.x, u.pos.y + 1, u.pos.z)
      const d = target.distanceTo(c)
      if (d > radius || !this.col.lineOfSight(c, target)) continue
      const k = 1 - d / radius
      this.damageUnit(u, damage * k * (u === by.unit ? 0.5 : 1), by, false, at, weapon)
    }
    for (const v of this.vehicles) {
      if (!v.enabled || !v.alive || v === skip) continue
      const team = v.driver ? v.driver.team : v.team
      if (team === by.team) continue
      const d = v.center.distanceTo(c)
      if (d < radius + 2) this.damageVehicle(v, damage * 1.6 * (1 - d / (radius + 2)), by)
    }
    for (const h of this.helis) {
      if (h.team === by.team || !h.airborne || h === skip) continue
      const d = h.center.distanceTo(c)
      if (d < radius + 4) h.damage(damage * 1.4 * (1 - d / (radius + 4)), this)
    }
    for (const e of this.emps) {
      if (!e.enabled || !e.alive || e.team === by.team || e === skip) continue
      const d = e.center.distanceTo(c)
      if (d < radius + 2.5) this.damageEmplacement(e, damage * 1.4 * (1 - d / (radius + 2.5)), by)
    }
    for (const a of this.air) {
      if (a.team === by.team || a.ref instanceof Heli || a.ref === skip) continue
      const d = a.pos.distanceTo(c)
      if (d < radius + 1) this.damageThing(a.ref, damage * (1 - d / (radius + 1)), by)
    }
  }

  // ─── objectives & stations ──────────────────────────────────────────────
  private stepCapture(dt: number, demo: boolean): void {
    const st = this.match
    POINTS.forEach((p, i) => {
      const presence = [0, 0]
      if (i !== ISLAND_POINT || RT.sea) {
        for (const u of this.units) {
          if (!u.alive) continue
          if (u === this.player && this.player.mode !== 'foot' && this.player.mode !== 'vehicle') continue
          const maxY = p.kind === 'egg' ? 7 : 4
          if (u.pos.y > maxY) continue
          if (Math.hypot(u.pos.x - p.x, u.pos.z - p.z) <= p.r) presence[u.team] += 1
        }
      }
      const e = stepPoint(st, i, presence, dt)
      this.world.setPointOwner(i, st.points[i].owner, st.points[i].capturing, st.points[i].contested, this.wallTime)
      if (!e || demo || e.type === 'ended') return
      const mine = e.team === PLAYER_TEAM
      if (e.type === 'captured') {
        const inside = this.player.alive && Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z) <= p.r
        if (inside && mine) this.player.captures += 1
        for (const b of this.bots) if (b.alive && b.team === e.team && Math.hypot(b.pos.x - p.x, b.pos.z - p.z) <= p.r) b.captures += 1
        this.toast(L(`${teamShort(e.team)}占领了 ${p.name}`, `${teamShort(e.team)} captured ${p.en}`), mine ? (p.kind === 'egg' ? 'gold' : 'good') : 'bad')
        this.sfx(mine ? 'capture' : 'lost')
      } else if (e.type === 'neutralized') {
        this.toast(L(`${p.name} 已被${teamShort(e.team)}中立化`, `${p.en} neutralised by ${teamShort(e.team)}`), mine ? 'good' : 'bad')
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
      const name = stationName(s)
      if (s.kind === 'heal') {
        if (p.hp < p.maxHp) {
          p.hp = Math.min(p.maxHp, p.hp + CONFIG.stations.healRate * dt)
          if (t >= this.healSoundAt) {
            this.healSoundAt = t + 0.8
            this.sfx('heal')
          }
          this.prompt = L(`${name}：生命恢复中 ${Math.floor(p.hp)}/${p.maxHp}`, `${name}: healing ${Math.floor(p.hp)}/${p.maxHp}`)
        } else this.prompt = L(`${name}：生命已满`, `${name}: full health`)
        return
      }
      if (!ready) {
        this.prompt = L(`${name}：冷却中 ${Math.ceil(this.stationReady[i] - t)} 秒`, `${name}: cooling down ${Math.ceil(this.stationReady[i] - t)}s`)
        return
      }
      if (s.kind === 'supply') {
        p.reserve = CONFIG.weapon.maxReserve
        if (!(p.reloading && p.weapon === 'rifle')) p.mag = CONFIG.weapon.mag
        p.pmag = CONFIG.pistol.mag
        p.grenades = Math.min(CONFIG.grenade.max, p.grenades + 2)
        p.rocketReserve = Math.min(CONFIG.launcher.maxReserve, p.rocketReserve + 2)
        if (p.rocket === 0) p.startRocketReload(t)
        this.stationReady[i] = t + CONFIG.stations.supplyCooldown
        this.toast(L(`${name} · 补给完成：弹药补满，手雷 +2，导弹 +2`, `${name} · resupplied: ammo full, +2 grenades, +2 missiles`), 'good')
        this.sfx('supply')
      } else if (s.kind === 'skill' && s.skill) {
        const sk = SKILLS[s.skill]
        p.buffs[s.skill] = t + CONFIG.stations.skillDuration
        this.buffWarned[s.skill] = false
        if (s.skill === 'shield') p.shield = CONFIG.stations.shield
        this.stationReady[i] = t + CONFIG.stations.skillCooldown
        this.toast(L(`${name} · 获得技能【${sk.name.zh}】${sk.desc.zh}（${CONFIG.stations.skillDuration} 秒）`, `${name} · skill [${sk.name.en}] ${sk.desc.en} (${CONFIG.stations.skillDuration}s)`), 'gold')
        this.sfx('skill')
      }
    })
    // Base: heal and slow ammo top-up.
    const base = BASES[PLAYER_TEAM]
    if (p.alive && p.mode === 'foot' && Math.hypot(p.pos.x - base.x, p.pos.z - base.z) < base.r) {
      p.hp = Math.min(p.maxHp, p.hp + CONFIG.stations.baseHealRate * dt)
      this.topUp(dt, 30, CONFIG.weapon.reserve)
    }
    // Offshore Isle depot (sea mode, own team holds the isle): fast ammo + missile top-up.
    if (p.alive && p.mode === 'foot' && this.islandDepotActive() && Math.hypot(p.pos.x - ISLAND_DEPOT.x, p.pos.z - ISLAND_DEPOT.z) < ISLAND_DEPOT.r) {
      const before = p.reserve
      this.topUp(dt, 60, CONFIG.weapon.maxReserve)
      if (p.mag < CONFIG.weapon.mag) {
        if (p.weapon === 'rifle') {
          if (!p.reloading) p.startReload(this.time)
        } else {
          const take = Math.min(CONFIG.weapon.mag - p.mag, p.reserve)
          p.mag += take
          p.reserve -= take
        }
      }
      p.pmag = CONFIG.pistol.mag
      this.depotMissileAcc += dt
      if (this.depotMissileAcc > 4 && p.rocketReserve < CONFIG.launcher.maxReserve) {
        this.depotMissileAcc = 0
        p.rocketReserve += 1
        if (p.rocket === 0) p.startRocketReload(this.time)
      }
      this.prompt = L(`出海岛弹药库：补充中 ${Math.floor(p.reserve)}/${CONFIG.weapon.maxReserve}`, `Isle ammo depot: resupplying ${Math.floor(p.reserve)}/${CONFIG.weapon.maxReserve}`)
      if (before < 1 && p.reserve >= 1) this.sfx('supply')
    }
    p.reserve = Math.floor(p.reserve)
  }

  /** Add whole rounds to the rifle reserve at `rate` per second, up to `cap` (keeps ammo integral). */
  private topUp(dt: number, rate: number, cap: number): void {
    const p = this.player
    if (p.reserve >= cap) {
      this.ammoAcc = 0
      return
    }
    this.ammoAcc += rate * dt
    const add = Math.floor(this.ammoAcc)
    if (add > 0) {
      this.ammoAcc -= add
      p.reserve = Math.min(cap, p.reserve + add)
    }
  }
  islandDepotActive(): boolean {
    return RT.sea && this.islandOwner() === this.player.team
  }
  /** Places the player can refill rifle ammo, nearest first. */
  ammoPoints(): { x: number; z: number; name: string; ready: boolean; d: number }[] {
    const p = this.player
    const out: { x: number; z: number; name: string; ready: boolean; d: number }[] = []
    STATIONS.forEach((s, i) => {
      if (s.kind !== 'supply') return
      out.push({ x: s.x, z: s.z, name: stationName(s), ready: this.time >= this.stationReady[i], d: 0 })
    })
    const base = BASES[PLAYER_TEAM]
    out.push({ x: base.x, z: base.z, name: L('红方部署区', 'Red staging area'), ready: true, d: 0 })
    if (this.islandDepotActive()) out.push({ x: ISLAND_DEPOT.x, z: ISLAND_DEPOT.z, name: L('出海岛弹药库', 'Isle ammo depot'), ready: true, d: 0 })
    for (const o of out) o.d = Math.hypot(o.x - p.pos.x, o.z - p.pos.z)
    // Prefer a ready point unless a cooling-down one is much closer.
    return out.sort((a, b) => (a.ready === b.ready ? a.d - b.d : a.ready ? (a.d < b.d + 60 ? -1 : 1) : b.d < a.d + 60 ? 1 : -1))
  }
  /** Rifle ammo state for the HUD: '' | 'low' | 'dry'. */
  get ammoState(): '' | 'low' | 'dry' {
    const p = this.player
    if (p.rifleDry) return 'dry'
    if (p.reserve < CONFIG.lowReserve) return 'low'
    return ''
  }
  private ammoHintAt = -99
  /** Tell the player where to resupply (rate-limited). */
  private ammoHint(dry: boolean): void {
    if (this.time < this.ammoHintAt) return
    this.ammoHintAt = this.time + 6
    const best = this.ammoPoints()[0]
    const where = best ? L(`最近补给：${best.name}（${Math.round(best.d)} 米）`, `nearest resupply: ${best.name} (${Math.round(best.d)} m)`) : ''
    if (dry) this.toast(L(`步枪弹药耗尽！已切换 P-7 手枪（无限备弹，需换弹）· ${where}`, `Rifle out of ammo! Switched to the P-7 sidearm (unlimited spares, still reloads) · ${where}`), 'bad')
    else this.toast(L(`步枪备弹不足 · ${where}`, `Rifle ammo low · ${where}`), 'info')
  }

  private stepEnemyHeli(): void {
    const h = this.helis[1]
    if (this.time < this.enemyHeliAt || h.busy) return
    this.enemyHeliAt = this.time + RT.bot.heliInterval
    const st = this.match.points
    const egg = eggIndex(this.match)
    let idx = st[egg].owner === PLAYER_TEAM ? egg : st.findIndex((s, i) => s.owner === PLAYER_TEAM && i !== ISLAND_POINT)
    if (idx < 0) idx = egg
    const target = heliTargets()[idx]
    if (h.call({ insert: false, x: target.x, z: target.z, name: target.name }, this.time, null)) {
      this.toast(L(`警告：蓝方直升机正飞往 ${target.name} 实施火力压制！`, `WARNING: Blue helicopter inbound to ${target.name}!`), 'bad')
      this.sfx('heliCall')
    }
  }

  private finish(): void {
    const m = this.match
    this.setState('ended')
    this.input.active = false
    this.audio.silenceLoops()
    if (this.seat) this.exitSeat()
    const p = this.player
    const board = this.units.map(u => ({ name: u.name, team: u.team, kills: u.kills, deaths: u.deaths, captures: u.captures, isPlayer: u.isPlayer })).sort((a, b) => b.kills * 2 + b.captures * 3 - (a.kills * 2 + a.captures * 3))
    this.sfx(m.winner === PLAYER_TEAM ? 'win' : 'lose')
    this.events?.end({
      winner: m.winner, reason: m.reason, scores: [...m.scores], kills: [...m.kills], time: CONFIG.match.seconds - m.timeLeft, sea: RT.sea,
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
    for (const s of this.scouts) s.render(alpha, frameDt, t)
    this.fx.update(frameDt)
    this.muzzleLight.intensity *= 0.6
    const shake = this.fx.shake
    let fovTarget: number = CONFIG.player.fov
    let showGun = false
    cam.up.copy(UP)
    this.cursorRing.visible = false
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
    } else if (p.mode === 'arty' && this.seat) {
      const c = this.cursor
      cam.up.copy(NORTH_UP)
      cam.position.set(c.x, c.y + 115, c.z - 32)
      cam.lookAt(c.x, c.y, c.z)
      this.cursorRing.visible = true
      this.cursorRing.position.set(c.x, c.y + 0.25, c.z)
      this.cursorRing.scale.setScalar(CONFIG.artillery.radius)
      ;(this.cursorRing.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(t * 6) * 0.3
      fovTarget = 52
    } else if (p.mode === 'aa' && this.seat) {
      const e = this.seat
      e.seat(tmpV)
      cam.position.copy(tmpV)
      cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ')
      fovTarget = CONFIG.player.fov + (26 - CONFIG.player.fov) * p.ads
    } else if (p.mode === 'dead') {
      cam.position.lerp(tmpV.set(p.pos.x + 4, p.pos.y + 6, p.pos.z + 4), Math.min(1, frameDt * 1.5))
      cam.lookAt(p.pos.x, p.pos.y + 0.5, p.pos.z)
    } else {
      const ep = tmpV.lerpVectors(p.prev, p.pos, alpha)
      cam.position.set(ep.x, ep.y + p.eyeY, ep.z)
      const bob = p.onGround ? Math.sin(p.bobPhase * 1.6) * 0.04 * Math.min(1, p.speed / 9) * (1 - p.ads) : 0
      cam.position.y += Math.abs(bob)
      cam.rotation.set(p.pitch + p.kick, p.yaw + p.kickYaw, 0, 'YXZ')
      const adsFov = p.weapon === 'launcher' ? 40 : CONFIG.player.adsFov
      fovTarget = CONFIG.player.fov + (adsFov - CONFIG.player.fov) * p.ads + (p.sprinting ? 4 : 0)
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
    for (const b of this.bots) b.mesh.root.visible = !b.ride && (b.alive || this.time - (b.respawnAt - CONFIG.bots.respawn) < 4)
    const focus = this.state === 'title' ? new THREE.Vector3(0, 0, 0) : p.mode === 'drone' ? this.drone.pos.clone().setY(0) : p.mode === 'arty' ? this.cursor.clone() : p.pos
    this.world.animate(t, focus)
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
    const top = p.mode === 'arty'
    POINTS.forEach((pt, i) => {
      if (i === ISLAND_POINT && !RT.sea) return
      const s = this.match.points[i]
      const pos = tmpV.set(pt.x, pt.kind === 'egg' ? EGG.cy + EGG.ry + 2 : 3, pt.z)
      const r = proj(pos, pt.kind === 'egg' && !top)
      if (!r) return
      const color = s.contested ? GOLD_HEX : s.owner >= 0 ? TEAM_HEX[s.owner] : NEUTRAL_HEX
      out.push({ ...r, kind: 'point', label: pointShort(pt), color, dist: Math.hypot(pt.x - camPos.x, pt.z - camPos.z), progress: s.progress })
    })
    const t = this.time
    for (const u of this.units) {
      if (u === p || !u.alive) continue
      const head = tmpV.set(u.pos.x, u.pos.y + 2.25, u.pos.z)
      const dist = head.distanceTo(camPos)
      if (u.team === p.team) {
        if (dist > 90 && !top) continue
        const r = proj(head, false)
        if (r) out.push({ ...r, kind: 'ally', label: top ? '' : u.name, color: TEAM_HEX[u.team], dist })
      } else if (u.spottedUntil > t) {
        const r = proj(head, false)
        if (r) out.push({ ...r, kind: 'enemy', label: '', color: TEAM_HEX[u.team], dist })
      }
    }
    for (const hh of this.helis) {
      if (!hh.airborne || !hh.alive) continue
      const r = proj(tmpV.copy(hh.pos).setY(hh.pos.y + 5), hh.team !== p.team)
      if (r) out.push({ ...r, kind: 'heli', label: hh.team === p.team ? L('友军直升机', 'friendly heli') : L('敌方直升机', 'enemy heli'), color: TEAM_HEX[hh.team], dist: hh.pos.distanceTo(camPos) })
    }
    for (const s of this.scouts) {
      if (!s.active) continue
      const d = s.pos.distanceTo(camPos)
      if (s.team !== p.team && d > 170) continue
      const r = proj(tmpV.copy(s.pos).setY(s.pos.y + 2), false)
      if (r) out.push({ ...r, kind: 'scout', label: s.team === p.team ? L('友军无人机', 'friendly drone') : L('敌方无人机', 'enemy drone'), color: TEAM_HEX[s.team], dist: d })
    }
    for (const s of this.strikes) {
      const r = proj(tmpV.set(s.x, 2, s.z), false)
      if (r) out.push({ ...r, kind: 'strike', label: s.team === p.team ? L('我方炮击', 'our strike') : L('炮击危险区', 'INCOMING'), color: TEAM_HEX[s.team], dist: Math.hypot(s.x - camPos.x, s.z - camPos.z) })
    }
    // Lock-on box (launcher or AA lock mode).
    const lockRef = p.mode === 'aa' && this.seat?.lockMode ? this.seat.lockTarget : p.lockTarget
    const lockK = p.mode === 'aa' && this.seat ? this.seat.lockT / CONFIG.aa.samLock : p.lockT / CONFIG.launcher.lockTime
    if (lockRef && p.alive) {
      const sk = this.seekerFor(lockRef)
      const pos = sk?.point()
      if (pos) {
        const r = proj(tmpV.copy(pos), false)
        if (r) out.push({ ...r, kind: 'lock', label: lockK >= 1 ? L('已锁定', 'LOCKED') : L('锁定中', 'LOCKING'), color: lockK >= 1 ? '#ff4d5e' : GOLD_HEX, dist: pos.distanceTo(camPos), progress: Math.min(1, lockK) })
      }
    }
    if (p.mode === 'foot') {
      for (const v of this.vehicles) {
        if (!v.enabled || !v.alive || v.driver) continue
        const d = v.pos.distanceTo(camPos)
        if (d > 45) continue
        const r = proj(tmpV.copy(v.pos).setY(v.pos.y + 3.2), false)
        if (r) out.push({ ...r, kind: 'vehicle', label: v.label, color: v.team >= 0 ? TEAM_HEX[v.team] : NEUTRAL_HEX, dist: d })
      }
      DRONE_PADS.forEach(d => {
        const dist = Math.hypot(d.x - camPos.x, d.z - camPos.z)
        if (dist > 60) return
        const r = proj(tmpV.set(d.x, d.y + 4.5, d.z), false)
        if (r) out.push({ ...r, kind: 'drone', label: this.time >= this.drone.readyAt ? L('无人机', 'drone') : L('充电中', 'charging'), color: '#7ef9ff', dist })
      })
    }
    if (RT.sea && p.mode !== 'arty') {
      for (const e of this.emps) {
        if (!e.enabled) continue
        const d = e.pos.distanceTo(camPos)
        if (d > 140 || e === this.seat) continue
        const r = proj(tmpV.copy(e.pos).setY(e.pos.y + 5.5), false)
        if (r) out.push({ ...r, kind: 'emplace', label: e.alive ? e.name : L(`${e.name}（损毁）`, `${e.name} (wrecked)`), color: e.team >= 0 ? TEAM_HEX[e.team] : NEUTRAL_HEX, dist: d })
      }
    }
    return out
  }

  /** Point currently occupied by the player (for the centre capture bar). */
  playerZone(): number {
    const p = this.player
    if (!p.alive || (p.mode !== 'foot' && p.mode !== 'vehicle')) return -1
    return POINTS.findIndex((pt, i) => (i !== ISLAND_POINT || RT.sea) && Math.hypot(p.pos.x - pt.x, p.pos.z - pt.z) <= pt.r && p.pos.y <= (pt.kind === 'egg' ? 7 : 4))
  }

  get activeVehicle(): Vehicle | null {
    return this.vehicle
  }

  /** Emplacement status for the HUD while operating one. */
  seatStatus(): SeatStatus | null {
    const e = this.seat
    if (!e) return null
    const t = this.time
    const dist = Math.hypot(this.cursor.x - e.pos.x, this.cursor.z - e.pos.z)
    return {
      kind: e.kind, name: e.name, hp: e.hp, maxHp: e.maxHp, lockMode: e.lockMode, lockK: Math.min(1, e.lockT / CONFIG.aa.samLock),
      samWait: Math.max(0, e.samReadyAt - t), readyWait: Math.max(0, e.readyAt - t), salvoLeft: e.salvoLeft,
      cursor: e.kind === 'arty' ? { x: this.cursor.x, z: this.cursor.z, r: CONFIG.artillery.radius, dist } : null,
    }
  }

  /** Whether the dead player may choose the island as respawn point. */
  get islandRespawnAvailable(): boolean {
    return RT.sea && this.islandOwner() === this.player.team
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
