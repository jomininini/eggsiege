import * as THREE from 'three'
import type { Collision } from './collide'
import { CONFIG } from './config'
import { BASES, POINTS } from './map'
import type { NavGrid, P2 } from './nav'
import type { MatchState } from './rules'
import { SoldierMesh } from './soldier'
import { chest, type Shooter, type Unit } from './units'

/** What a bot needs from the game. */
export interface BotHost {
  time: number
  col: Collision
  nav: NavGrid
  units: Unit[]
  match: MatchState
  /** Enemy aircraft the bot may shoot at. */
  air: { team: number; alive: boolean; airborne: boolean; pos: THREE.Vector3 }[]
  /** Positions of occupied enemy vehicles to aim at when their driver is sheltered. */
  vehicleOf(u: Unit): { pos: THREE.Vector3; center: THREE.Vector3 } | null
  fire(shooter: Shooter, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, tracer: number): void
}

const NAMES = [
  ['烈风', '炽羽', '赤狐', '焰刃', '雷火', '星火', '朱雀', '赤霄'],
  ['海鹰', '寒潮', '蓝鲸', '冰锋', '潮汐', '苍隼', '碧涛', '青鸾'],
]
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpDir = new THREE.Vector3()

let nextId = 100

export class Bot implements Unit {
  readonly id = (nextId += 1)
  readonly isPlayer = false
  readonly name: string
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
  private path: P2[] = []
  private goal: P2 | null = null
  goalPoint = -1
  private nextThink = 0
  private nextSense = Math.random() * 0.3
  private nextWander = 0
  private target: Unit | null = null
  private targetAir: { pos: THREE.Vector3 } | null = null
  private targetVisible = false
  private reactUntil = 0
  private burstLeft = 0
  private nextShot = 0
  private strafe = 1
  private strafeUntil = 0
  private stuckCheck = 0
  private stuckFrom = new THREE.Vector3()
  private stuckCount = 0
  private readonly role: 'attack' | 'defend'
  private readonly bias: number

  constructor(readonly team: number, index: number, scene: THREE.Scene) {
    this.name = NAMES[team][index % NAMES[team].length] + (index >= NAMES[team].length ? `-${index}` : '')
    this.mesh = new SoldierMesh(team)
    scene.add(this.mesh.root)
    this.role = index % 3 === 2 ? 'defend' : 'attack'
    this.bias = index * 1.7
  }

  spawn(host: BotHost): void {
    const base = BASES[this.team]
    const a = Math.random() * Math.PI * 2, r = Math.random() * 5
    this.pos.set(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r)
    this.prev.copy(this.pos)
    this.hp = this.maxHp
    this.alive = true
    this.shield = 0
    this.target = null
    this.targetAir = null
    this.path = []
    this.goal = null
    this.nextThink = 0
    this.spawnShieldUntil = host.time + CONFIG.player.spawnShield
    this.yaw = this.team === 0 ? Math.PI / 2 : -Math.PI / 2
    this.mesh.root.visible = true
  }

  kill(host: BotHost): void {
    this.alive = false
    this.deaths += 1
    this.respawnAt = host.time + CONFIG.bots.respawn
    this.target = null
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
    if (t >= this.nextThink || (!this.path.length && !this.goal)) this.think(host)
    this.move(dt, host)
    this.shoot(host)
  }

  private eye(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + 1.55, this.pos.z)
  }

  private sense(host: BotHost): void {
    const eye = this.eye(tmpA)
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw)
    const cosHalf = Math.cos(CONFIG.bots.fov / 2)
    const candidates: { u: Unit; d: number }[] = []
    for (const u of host.units) {
      if (u.team === this.team || !u.alive) continue
      const dx = u.pos.x - this.pos.x, dz = u.pos.z - this.pos.z
      const d = Math.hypot(dx, dz)
      if (d > CONFIG.bots.viewRange) continue
      const recentlyHurt = u === this.lastAttacker && host.time - this.lastHurt < 2.5
      const facing = (dx * fx + dz * fz) / Math.max(d, 0.01) > cosHalf
      if (!facing && d > 9 && !recentlyHurt && !(u === this.target && this.targetVisible)) continue
      candidates.push({ u, d })
    }
    candidates.sort((a, b) => a.d - b.d)
    const prev = this.target
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
        if (a.pos.distanceTo(this.pos) < 85 && host.col.lineOfSight(eye, a.pos)) {
          this.targetAir = a
          this.targetVisible = true
          break
        }
      }
    }
    if ((this.target || this.targetAir) && this.target !== prev) {
      const [a, b] = CONFIG.bots.reaction
      this.reactUntil = host.time + rnd(a, b)
      this.burstLeft = 0
    }
  }

  private think(host: BotHost): void {
    const st = host.match.points
    let best = -1
    let bestW = -Infinity
    POINTS.forEach((p, i) => {
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
    this.goalPoint = best
    const p = POINTS[best]
    this.setGoal(host, p.x + rnd(-1, 1) * p.r * 0.6, p.z + rnd(-1, 1) * p.r * 0.6)
    this.nextThink = host.time + rnd(9, 15)
  }

  private setGoal(host: BotHost, x: number, z: number): void {
    this.goal = { x, z }
    this.path = host.nav.findPath(this.pos.x, this.pos.z, x, z)
  }

  private move(dt: number, host: BotHost): void {
    const cfg = CONFIG.bots
    let mx = 0, mz = 0
    let speed = cfg.speed
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
      const p = POINTS[this.goalPoint]
      this.nextWander = host.time + rnd(2.5, 5)
      this.setGoal(host, p.x + rnd(-1, 1) * p.r * 0.6, p.z + rnd(-1, 1) * p.r * 0.6)
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
    this.pos.x += vx * dt
    this.pos.z += vz * dt
    host.col.pushOut(this.pos, 0.4, 1.7, 0.62)
    this.pos.y = host.col.groundAt(this.pos.x, this.pos.z, 0.4, this.pos.y + 0.62)
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
    let dy = want - this.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
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
    if (!this.targetVisible || host.time < this.reactUntil || host.time < this.nextShot) return
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
    const spread = cfg.spread * (1 + dist / 45) * (this.speedNow > 0 ? 1.3 : 1)
    tmpDir.x += (Math.random() - 0.5) * spread * 2
    tmpDir.y += (Math.random() - 0.5) * spread * 2
    tmpDir.z += (Math.random() - 0.5) * spread * 2
    tmpDir.normalize()
    host.fire({ team: this.team, name: this.name, unit: this }, eye, tmpDir, cfg.damage, this.team === 0 ? 0xffa08a : 0x9ad8ff)
    this.burstLeft -= 1
    if (this.burstLeft <= 0) {
      const [a, b] = cfg.burstPause
      this.nextShot = host.time + rnd(a, b)
    } else this.nextShot = host.time + cfg.fireInterval
  }

  render(alpha: number, dt: number): void {
    const r = this.mesh.root
    r.position.lerpVectors(this.prev, this.pos, alpha)
    let dy = this.yaw - this.prevYaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    r.rotation.y = this.prevYaw + dy * alpha
    this.mesh.animate(dt, this.speedNow, this.pitch, !this.alive, false)
  }
}
