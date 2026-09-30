import * as THREE from 'three'
import type { Collision } from './collide'
import { CONFIG, RT } from './config'
import { L } from './i18n'
import { BASES, BEACHES, CANAL_ROUTE, EGG, inIsland, ISLAND, ISLAND_POINT, LAKE, POINTS, type PointDef } from './map'
import type { NavGrid, P2 } from './nav'
import type { MatchState } from './rules'
import { SoldierMesh } from './soldier'
import { chest, type Shooter, type Unit } from './units'
import type { Vehicle } from './vehicles'

/** Something a bot can shoot at besides soldiers (aircraft, island emplacements). */
export type Target = { team: number; alive: boolean; airborne: boolean; pos: THREE.Vector3; ref: unknown }
export type SeekerSpec = { point(): THREE.Vector3 | null; ref: unknown }

/** What a bot needs from the game. */
export interface BotHost {
  time: number
  col: Collision
  nav: NavGrid
  units: Unit[]
  match: MatchState
  /** Enemy aircraft (helicopters, drones). */
  air: Target[]
  /** Hard targets on the ground (island AA / rocket battery). */
  hard: Target[]
  boats: Vehicle[]
  vehicleOf(u: Unit): { pos: THREE.Vector3; center: THREE.Vector3; ref?: unknown } | null
  fire(shooter: Shooter, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, tracer: number): void
  fireMissile(bot: Bot, from: THREE.Vector3, dir: THREE.Vector3, seeker: SeekerSpec | null): void
  board(bot: Bot, v: Vehicle): void
  disembark(bot: Bot, x: number, z: number): void
  islandOwner(): number
  /** Centre of an incoming artillery strike covering (x, z), if any. */
  danger(x: number, z: number): { x: number; z: number; r: number } | null
}

const NAMES = [
  [['烈风', 'Gale'], ['炽羽', 'Ember'], ['赤狐', 'Red Fox'], ['焰刃', 'Blade'], ['雷火', 'Thunder'], ['星火', 'Spark'], ['朱雀', 'Phoenix'], ['赤霄', 'Crimson'], ['烽烟', 'Beacon'], ['赤鸢', 'Kite']],
  [['海鹰', 'Sea Hawk'], ['寒潮', 'Cold Tide'], ['蓝鲸', 'Orca'], ['冰锋', 'Frost'], ['潮汐', 'Surge'], ['苍隼', 'Falcon'], ['碧涛', 'Wave'], ['青鸾', 'Azure'], ['沧澜', 'Deep'], ['雪鸮', 'Snowy']],
]
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpDir = new THREE.Vector3()

let nextId = 100

type Role = 'attack' | 'defend' | 'marine'
type Ride = { v: Vehicle; route: P2[]; land: P2; purpose: 'island' | 'lake'; since: number; slowSince: number; reverseUntil: number }

/** A dry spot inside a capture zone (the egg zone is a ring around the lake). */
export function pointSpot(p: PointDef): P2 {
  if (p.kind === 'egg') {
    const a = Math.random() * Math.PI * 2
    const r = rnd(LAKE.r + 1.8, p.r - 1.2)
    let x = EGG.x + Math.cos(a) * r, z = EGG.z + Math.sin(a) * r
    if (Math.abs(x) < 6 && z < 0) x = Math.sign(x || 1) * 7
    return { x, z }
  }
  if (p.kind === 'island') return { x: p.x + rnd(-1, 1) * p.r * 0.55, z: p.z + rnd(-1, 1) * p.r * 0.45 }
  return { x: p.x + rnd(-1, 1) * p.r * 0.6, z: p.z + rnd(-1, 1) * p.r * 0.6 }
}

export class Bot implements Unit {
  readonly id = (nextId += 1)
  readonly isPlayer = false
  private readonly names: [string, string]
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  readonly mesh: SoldierMesh
  hp: number = CONFIG.bots.hp
  maxHp: number = CONFIG.bots.hp
  shield = 0
  alive = true
  crouch = false
  spottedUntil = 0
  sheltered = false
  spawnShieldUntil = 0
  kills = 0
  deaths = 0
  captures = 0
  lastHurt = -99
  lastAttacker: Unit | null = null
  yaw = 0
  prevYaw = 0
  pitch = 0
  speedNow = 0
  respawnAt = 0
  ride: Ride | null = null
  private path: P2[] = []
  private goal: P2 | null = null
  goalPoint = -1
  private nextThink = 0
  private nextSense = Math.random() * 0.3
  private nextWander = 0
  private target: Unit | null = null
  private targetAir: Target | null = null
  private targetVisible = false
  private reactUntil = 0
  private burstLeft = 0
  private nextShot = 0
  private missileAt = 0
  private strafe = 1
  private strafeUntil = 0
  private stuckCheck = 0
  private stuckFrom = new THREE.Vector3()
  private stuckCount = 0
  private boardTarget: Vehicle | null = null
  private fleeUntil = 0
  readonly role: Role
  private readonly bias: number

  constructor(readonly team: number, readonly index: number, scene: THREE.Scene) {
    const list = NAMES[team]
    this.names = list[index % list.length] as [string, string]
    this.mesh = new SoldierMesh(team)
    scene.add(this.mesh.root)
    this.role = RT.sea && index % 3 === 1 ? 'marine' : index % 3 === 2 ? 'defend' : 'attack'
    this.bias = index * 1.7
  }

  get name(): string {
    const suffix = this.index >= NAMES[this.team].length ? `-${this.index}` : ''
    return L(this.names[0], this.names[1]) + suffix
  }

  spawn(host: BotHost): void {
    const base = BASES[this.team]
    const a = Math.random() * Math.PI * 2, r = Math.random() * 5
    if (RT.sea && this.role === 'marine' && host.islandOwner() === this.team && Math.random() < 0.7) {
      this.pos.set(ISLAND.x + Math.cos(a) * r * 1.6, ISLAND.y, ISLAND.z + 2 + Math.sin(a) * r)
    } else this.pos.set(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r)
    this.prev.copy(this.pos)
    this.hp = this.maxHp
    this.alive = true
    this.shield = 0
    this.target = null
    this.targetAir = null
    this.path = []
    this.goal = null
    this.ride = null
    this.boardTarget = null
    this.sheltered = false
    this.nextThink = 0
    // Clear every time gate: the match clock restarts at 0 each match.
    this.nextShot = 0
    this.burstLeft = 0
    this.reactUntil = 0
    this.strafeUntil = 0
    this.nextWander = 0
    this.stuckCheck = 0
    this.fleeUntil = 0
    this.respawnAt = 0
    this.spottedUntil = 0
    this.missileAt = host.time + rnd(RT.bot.missileCd[0], RT.bot.missileCd[1]) * 0.5
    this.spawnShieldUntil = host.time + CONFIG.player.spawnShield
    this.yaw = this.team === 0 ? Math.PI / 2 : -Math.PI / 2
    this.mesh.root.visible = true
  }

  kill(host: BotHost): void {
    this.alive = false
    this.deaths += 1
    this.respawnAt = host.time + CONFIG.bots.respawn
    this.target = null
    this.ride = null
    this.boardTarget = null
    this.sheltered = false
  }

  step(dt: number, host: BotHost): void {
    this.prev.copy(this.pos)
    this.prevYaw = this.yaw
    if (!this.alive) {
      if (host.time >= this.respawnAt && host.match.phase === 'playing') this.spawn(host)
      return
    }
    const t = host.time
    if (t - this.lastHurt > CONFIG.bots.regenDelay) this.hp = Math.min(this.maxHp, this.hp + CONFIG.bots.regen * dt)
    if (t >= this.nextSense) {
      this.nextSense = t + 0.2
      this.sense(host)
    }
    if (this.ride) {
      this.rideStep(dt, host)
      this.shoot(host)
      return
    }
    if (t >= this.nextThink || (!this.path.length && !this.goal)) this.think(host)
    this.move(dt, host)
    this.shoot(host)
  }

  private eye(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + (this.ride ? 2.2 : 1.55), this.pos.z)
  }

  private sense(host: BotHost): void {
    const eye = this.eye(tmpA)
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw)
    const cosHalf = Math.cos(CONFIG.bots.fov / 2)
    const view = RT.bot.viewRange
    const candidates: { u: Unit; d: number }[] = []
    for (const u of host.units) {
      if (u.team === this.team || !u.alive) continue
      const dx = u.pos.x - this.pos.x, dz = u.pos.z - this.pos.z
      const d = Math.hypot(dx, dz)
      if (d > view) continue
      const recentlyHurt = u === this.lastAttacker && host.time - this.lastHurt < 2.5
      const facing = (dx * fx + dz * fz) / Math.max(d, 0.01) > cosHalf
      if (!facing && d > 9 && !recentlyHurt && !(u === this.target && this.targetVisible)) continue
      candidates.push({ u, d })
    }
    candidates.sort((a, b) => a.d - b.d)
    const prev = this.target
    const prevAir = this.targetAir
    this.target = null
    this.targetAir = null
    this.targetVisible = false
    for (const c of candidates.slice(0, 4)) {
      const veh = c.u.sheltered ? host.vehicleOf(c.u) : null
      if (c.u.sheltered && !veh) continue
      const aim = veh ? veh.center : chest(c.u, tmpB)
      if (host.col.lineOfSight(eye, aim)) {
        this.target = c.u
        this.targetVisible = true
        break
      }
    }
    if (!this.target) {
      for (const a of host.air) {
        if (a.team === this.team || !a.alive || !a.airborne) continue
        if (a.pos.distanceTo(this.pos) < view + 25 && host.col.lineOfSight(eye, a.pos)) {
          this.targetAir = a
          this.targetVisible = true
          break
        }
      }
    }
    if (!this.target && !this.targetAir) {
      for (const h of host.hard) {
        if (h.team === this.team || h.team < 0 || !h.alive) continue
        if (h.pos.distanceTo(this.pos) < view && host.col.lineOfSight(eye, h.pos)) {
          this.targetAir = h
          this.targetVisible = true
          break
        }
      }
    }
    if ((this.target && this.target !== prev) || (this.targetAir && this.targetAir !== prevAir)) {
      const [a, b] = RT.bot.reaction
      this.reactUntil = host.time + rnd(a, b)
      this.burstLeft = 0
    }
    // Run from incoming rocket salvos.
    if (!this.ride && host.time >= this.fleeUntil) {
      const d = host.danger(this.pos.x, this.pos.z)
      if (d) {
        const dx = this.pos.x - d.x, dz = this.pos.z - d.z
        const len = Math.hypot(dx, dz) || 1
        const out = d.r + 5
        this.setGoal(host, d.x + (dx / len) * out, d.z + (dz / len) * out)
        this.fleeUntil = host.time + 3
        this.nextThink = host.time + 4
      }
    }
  }

  private reachable(host: BotHost, x: number, z: number): boolean {
    return host.nav.connected(this.pos.x, this.pos.z, x, z)
  }

  private think(host: BotHost): void {
    this.boardTarget = null
    if (RT.sea && this.role === 'marine' && this.marineThink(host)) return
    const st = host.match.points
    let best = -1
    let bestW = -Infinity
    POINTS.forEach((p, i) => {
      if (i === ISLAND_POINT && !RT.sea) return
      if (!this.reachable(host, p.standX, p.standZ)) return
      const s = st[i]
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z)
      let w = -d * 0.35 + Math.sin(this.bias + i * 2.3 + host.time * 0.05) * 14 + Math.random() * 14
      const threatened = s.owner === this.team && ((s.capturing >= 0 && s.capturing !== this.team) || s.contested)
      if (s.owner !== this.team) w += 60 + (p.kind === 'egg' ? 35 : 0)
      else w += threatened ? 85 : p.kind === 'egg' ? 18 : 2
      if (this.role === 'defend' && s.owner === this.team) w += 22
      if (w > bestW) {
        bestW = w
        best = i
      }
    })
    if (best < 0) {
      // Stranded (e.g. on the island in standard mode): walk to a jetty and wait for a boat.
      this.goalPoint = -1
      this.setGoal(host, this.pos.x + rnd(-6, 6), this.pos.z + rnd(-6, 6))
      this.nextThink = host.time + 6
      return
    }
    this.goalPoint = best
    const spot = pointSpot(POINTS[best])
    this.setGoal(host, spot.x, spot.z)
    this.nextThink = host.time + rnd(9, 15)
  }

  /** Sea-assault logic. Returns true if it chose a marine task. */
  private marineThink(host: BotHost): boolean {
    const own = host.islandOwner()
    const onIsland = inIsland(this.pos.x, this.pos.z, 1)
    if (onIsland) {
      if (own === this.team && Math.random() < 0.6) {
        const boat = this.freeBoat(host, true)
        if (boat) return this.goBoard(host, boat)
      }
      this.goalPoint = ISLAND_POINT
      const spot = pointSpot(POINTS[ISLAND_POINT])
      this.setGoal(host, spot.x, spot.z)
      this.nextThink = host.time + rnd(8, 12)
      return true
    }
    if (own !== this.team) {
      const boat = this.freeBoat(host, false)
      if (boat) return this.goBoard(host, boat)
    }
    return false
  }

  private dockSpot(v: Vehicle): P2 {
    if (v.island) return { x: Math.sign(v.spawn.x) * 10, z: -106.5 }
    return { x: Math.sign(v.spawn.x) * 100, z: v.spawn.z }
  }

  private freeBoat(host: BotHost, island: boolean): Vehicle | null {
    let best: Vehicle | null = null
    let bestD = Infinity
    for (const v of host.boats) {
      if (!v.alive || !v.enabled || v.driver || v.island !== island) continue
      if (v.team !== this.team) continue
      if (Math.hypot(v.pos.x - v.spawn.x, v.pos.z - v.spawn.z) > 9) continue
      const s = this.dockSpot(v)
      if (!this.reachable(host, s.x, s.z)) continue
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z)
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    return best
  }

  private goBoard(host: BotHost, v: Vehicle): boolean {
    this.boardTarget = v
    this.goalPoint = -1
    const s = this.dockSpot(v)
    this.setGoal(host, s.x, s.z)
    this.nextThink = host.time + 30
    return true
  }

  private startRide(host: BotHost, v: Vehicle): void {
    host.board(this, v)
    const route: P2[] = []
    let land: P2
    let purpose: Ride['purpose']
    if (v.island) {
      route.push({ x: v.pos.x * 0.35, z: -98 }, ...CANAL_ROUTE.map(p => ({ ...p })))
      const side = Math.random() < 0.5 ? -1 : 1
      land = { x: side * 7.2, z: -12.5 }
      purpose = 'lake'
    } else {
      if (Math.abs(v.pos.x) > 98) route.push({ x: v.pos.x, z: -102 })
      const b = BEACHES[this.team]
      route.push({ x: (v.pos.x + b.wx) / 2, z: -112 }, { x: b.wx, z: b.wz })
      land = { x: b.lx, z: b.lz }
      purpose = 'island'
    }
    this.ride = { v, route, land, purpose, since: host.time, slowSince: host.time, reverseUntil: 0 }
    this.boardTarget = null
    this.path = []
    this.goal = null
  }

  private rideStep(dt: number, host: BotHost): void {
    const r = this.ride!
    const v = r.v
    if (!v.alive || v.driver !== this) {
      this.ride = null
      this.sheltered = false
      return
    }
    const arrive = () => {
      host.disembark(this, r.land.x, r.land.z)
      this.ride = null
      this.nextThink = 0
      if (r.purpose === 'lake') {
        this.goalPoint = POINTS.findIndex(p => p.kind === 'egg')
        const spot = pointSpot(POINTS[this.goalPoint])
        this.setGoal(host, spot.x, spot.z)
        this.nextThink = host.time + 12
      }
    }
    if (host.time - r.since > 110) {
      arrive()
      return
    }
    const wp = r.route[0]
    if (!wp) {
      arrive()
      return
    }
    const dx = wp.x - v.pos.x, dz = wp.z - v.pos.z
    const d = Math.hypot(dx, dz)
    const last = r.route.length === 1
    if (d < (last ? 4 : 6)) {
      r.route.shift()
      if (!r.route.length) {
        arrive()
        return
      }
    }
    const dyaw = wrap(Math.atan2(dx, dz) - v.yaw)
    let steer = Math.max(-1, Math.min(1, -dyaw * 2.4))
    let throttle = Math.abs(dyaw) > 1.2 ? 0.35 : 1
    const inland = v.pos.z > -84
    if (inland) throttle = Math.min(throttle, 0.5)
    if (last && d < 16) throttle = Math.min(throttle, 0.45)
    if (Math.abs(v.speed) > 3) r.slowSince = host.time
    else if (host.time - r.slowSince > 2.2 && r.reverseUntil < host.time) {
      r.reverseUntil = host.time + 1.3
      r.slowSince = host.time + 1.3
    }
    if (host.time < r.reverseUntil) {
      throttle = -0.8
      steer = -steer
    }
    v.drive(dt, throttle, steer, host.col)
    this.pos.copy(v.pos)
    this.yaw = v.yaw
    this.speedNow = 0
  }

  private setGoal(host: BotHost, x: number, z: number): void {
    this.goal = { x, z }
    this.path = host.nav.findPath(this.pos.x, this.pos.z, x, z)
  }

  private move(dt: number, host: BotHost): void {
    const cfg = CONFIG.bots
    let mx = 0, mz = 0
    let speed = cfg.speed
    if (this.boardTarget) {
      const v = this.boardTarget
      if (!v.alive || v.driver || !v.enabled) {
        this.boardTarget = null
        this.nextThink = 0
      } else if (Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) < 8.5) {
        this.startRide(host, v)
        return
      }
    }
    if (this.path.length) {
      const wp = this.path[0]
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z
      const d = Math.hypot(dx, dz)
      if (d < 1.1) this.path.shift()
      else {
        mx = dx / d
        mz = dz / d
      }
    } else if (this.goalPoint >= 0 && host.time >= this.nextWander) {
      // Hold the zone: drift between spots inside it.
      this.nextWander = host.time + rnd(2.5, 5)
      const spot = pointSpot(POINTS[this.goalPoint])
      this.setGoal(host, spot.x, spot.z)
    }
    const fighting = (this.target || this.targetAir) && this.targetVisible
    if (fighting) {
      const tp = this.target ? this.target.pos : this.targetAir!.pos
      const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z
      const d = Math.hypot(dx, dz) || 1
      if (host.time > this.strafeUntil) {
        this.strafe = Math.random() < 0.5 ? -1 : 1
        this.strafeUntil = host.time + rnd(0.6, 1.6)
      }
      if (d < 32) {
        const sx = (-dz / d) * this.strafe, sz = (dx / d) * this.strafe
        mx = mx * 0.35 + sx * 0.8
        mz = mz * 0.35 + sz * 0.8
        speed *= 0.7
      } else speed *= 0.65
    }
    if (host.time < this.fleeUntil) speed = cfg.speed * 1.25
    // Separation from allies.
    for (const u of host.units) {
      if (u === this || !u.alive || u.team !== this.team) continue
      const dx = this.pos.x - u.pos.x, dz = this.pos.z - u.pos.z
      const d2 = dx * dx + dz * dz
      if (d2 < 1.6 && d2 > 1e-4) {
        mx += dx * 0.8
        mz += dz * 0.8
      }
    }
    const len = Math.hypot(mx, mz)
    if (len > 1e-3) {
      mx /= len
      mz /= len
    }
    const vx = mx * speed, vz = mz * speed
    const ox = this.pos.x, oz = this.pos.z
    this.pos.x += vx * dt
    this.pos.z += vz * dt
    host.col.pushOut(this.pos, 0.4, 1.7, 0.62)
    const g = host.col.groundAt(this.pos.x, this.pos.z, 0.4, this.pos.y + 0.62)
    if (g < this.pos.y - 1.2 && g < -0.5) {
      // Do not step off a pier / bank into the water.
      this.pos.x = ox
      this.pos.z = oz
    } else this.pos.y = g
    this.speedNow = len > 1e-3 ? speed : 0
    // Facing.
    let want = this.yaw
    if (fighting) {
      const tp = this.target ? this.target.pos : this.targetAir!.pos
      want = Math.atan2(tp.x - this.pos.x, tp.z - this.pos.z)
      const aimY = this.target ? tp.y + 1.2 : tp.y
      this.pitch = Math.atan2(aimY - (this.pos.y + 1.55), Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z))
    } else {
      if (len > 1e-3) want = Math.atan2(mx, mz)
      this.pitch *= 0.9
    }
    const dy = wrap(want - this.yaw)
    this.yaw += dy * Math.min(1, dt * (fighting ? 12 : 7))
    // Stuck recovery.
    if (host.time >= this.stuckCheck) {
      const moved = this.stuckFrom.distanceTo(this.pos)
      if (this.path.length && moved < 0.6 && !fighting) {
        this.stuckCount += 1
        if (this.stuckCount > 2) {
          this.stuckCount = 0
          this.think(host)
        } else if (this.goal) {
          this.path = host.nav.findPath(this.pos.x + rnd(-2, 2), this.pos.z + rnd(-2, 2), this.goal.x, this.goal.z)
        }
      } else this.stuckCount = 0
      this.stuckFrom.copy(this.pos)
      this.stuckCheck = host.time + 1.5
    }
  }

  private shoot(host: BotHost): void {
    if (!this.targetVisible || host.time < this.reactUntil) return
    if (this.tryMissile(host)) return
    if (host.time < this.nextShot) return
    const cfg = CONFIG.bots
    let aim: THREE.Vector3
    if (this.target) {
      if (!this.target.alive) return
      const veh = this.target.sheltered ? host.vehicleOf(this.target) : null
      aim = veh ? tmpB.copy(veh.center) : chest(this.target, tmpB)
      if (!veh && Math.random() < 0.18) aim.y += 0.45
    } else if (this.targetAir) aim = tmpB.copy(this.targetAir.pos)
    else return
    if (this.burstLeft <= 0) {
      const [a, b] = cfg.burst
      this.burstLeft = Math.round(rnd(a, b))
    }
    const eye = this.eye(tmpA)
    const dist = eye.distanceTo(aim)
    tmpDir.subVectors(aim, eye).normalize()
    const spread = RT.bot.spread * (1 + dist / 45) * (this.speedNow > 0 || this.ride ? 1.3 : 1)
    tmpDir.x += (Math.random() - 0.5) * spread * 2
    tmpDir.y += (Math.random() - 0.5) * spread * 2
    tmpDir.z += (Math.random() - 0.5) * spread * 2
    tmpDir.normalize()
    host.fire({ team: this.team, name: this.name, unit: this }, eye, tmpDir, RT.bot.damage, this.team === 0 ? 0xffa08a : 0x9ad8ff)
    this.burstLeft -= 1
    if (this.burstLeft <= 0) {
      const [a, b] = cfg.burstPause
      this.nextShot = host.time + rnd(a, b)
    } else this.nextShot = host.time + cfg.fireInterval
  }

  /** Occasionally fire a Flyfish-2 at vehicles, aircraft, emplacements or clustered infantry. */
  private tryMissile(host: BotHost): boolean {
    if (host.time < this.missileAt || this.ride) return false
    const eye = this.eye(tmpA)
    let seeker: SeekerSpec | null = null
    let aim: THREE.Vector3 | null = null
    if (this.target) {
      const veh = this.target.sheltered ? host.vehicleOf(this.target) : null
      if (veh) {
        const c = veh.center
        const tgt = this.target
        seeker = { point: () => (tgt.alive && tgt.sheltered ? c : null), ref: veh.ref ?? veh }
        aim = c
      } else {
        const d = this.target.pos.distanceTo(this.pos)
        if (d > 16 && d < 75 && Math.random() < 0.3) aim = tmpB.copy(this.target.pos).setY(this.target.pos.y + 0.4)
      }
    } else if (this.targetAir) {
      const a = this.targetAir
      if (a.pos.distanceTo(this.pos) < CONFIG.launcher.lockRange * 0.7) {
        seeker = { point: () => (a.alive ? a.pos : null), ref: a.ref }
        aim = a.pos
      }
    }
    if (!aim) {
      this.missileAt = host.time + 2
      return false
    }
    tmpDir.subVectors(aim, eye).normalize()
    if (seeker) tmpDir.y += 0.08
    host.fireMissile(this, eye.clone(), tmpDir.clone().normalize(), seeker)
    const [a, b] = RT.bot.missileCd
    this.missileAt = host.time + rnd(a, b)
    this.nextShot = host.time + 0.8
    return true
  }

  render(alpha: number, dt: number): void {
    const r = this.mesh.root
    r.visible = this.alive ? !this.ride : r.visible
    r.position.lerpVectors(this.prev, this.pos, alpha)
    const dy = wrap(this.yaw - this.prevYaw)
    r.rotation.y = this.prevYaw + dy * alpha
    this.mesh.animate(dt, this.speedNow, this.pitch, !this.alive, false)
  }
}
