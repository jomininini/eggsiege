import * as THREE from 'three'
import type { Collision } from './collide'
import { CONFIG, TEAM_COLORS } from './config'
import { HELIPADS } from './map'
import type { Shooter, Unit } from './units'

export type HeliPhase = 'parked' | 'takeoff' | 'transit' | 'hover' | 'orbit' | 'return' | 'landing' | 'down' | 'wreck'
export type HeliMission = { insert: boolean; x: number; z: number; name: string }

export interface HeliHost {
  time: number
  col: Collision
  units: Unit[]
  fire(shooter: Shooter, origin: THREE.Vector3, dir: THREE.Vector3, damage: number, tracer: number): void
  onHeliDrop(heli: Heli): void
  onHeliCrash(heli: Heli): void
}

const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()

/** Support helicopter. Parks on its team pad; when called it inserts troops and circles a point firing its door gun. */
export class Heli {
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  readonly mesh = new THREE.Group()
  private readonly body = new THREE.Group()
  private readonly rotor = new THREE.Group()
  private readonly tailRotor = new THREE.Group()
  private readonly searchLight: THREE.Mesh
  yaw = 0
  prevYaw = 0
  bank = 0
  pitch = 0
  hp: number = CONFIG.heli.hp
  readonly maxHp: number = CONFIG.heli.hp
  phase: HeliPhase = 'parked'
  mission: HeliMission | null = null
  passenger: Unit | null = null
  readyAt = 0
  private phaseUntil = 0
  private orbitA = 0
  private gunCd = 0
  private rotorSpeed = 0
  private spin = 0
  readonly name: string
  readonly pad: { x: number; z: number }

  constructor(readonly team: number, scene: THREE.Scene) {
    this.pad = HELIPADS[team]
    this.name = team === 0 ? '红方直升机 “赤隼”' : '蓝方直升机 “海鹞”'
    const color = TEAM_COLORS[team]
    const m = (c: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.35, ...o })
    const hull = m(0x46525c)
    const accent = m(color, { emissive: color, emissiveIntensity: 0.3 })
    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(g, mat)
      mesh.position.set(x, y, z)
      mesh.scale.set(sx, sy, sz)
      mesh.castShadow = true
      parent.add(mesh)
      return mesh
    }
    const box = new THREE.BoxGeometry(1, 1, 1)
    const sphere = new THREE.SphereGeometry(1, 16, 12)
    add(this.body, sphere, hull, 0, 1.9, 0.4, 1.35, 1.25, 2.6)
    add(this.body, sphere, m(0x9fd6ea, { roughness: 0.05, transparent: true, opacity: 0.7 }), 0, 2.15, 2.1, 1.05, 0.8, 1.1)
    add(this.body, box, hull, 0, 2.3, -3.6, 0.45, 0.5, 5)
    add(this.body, box, accent, 0, 3.1, -5.9, 0.12, 1.4, 1.1)
    add(this.body, box, accent, 0, 1.5, 0.4, 2.72, 0.2, 3.6)
    add(this.body, box, m(0x1b2025), 0, 3.25, 0.2, 0.7, 0.35, 1.2)
    for (const x of [-1.1, 1.1]) {
      add(this.body, box, m(0x1b2025), x, 0.12, 0.3, 0.12, 0.12, 4)
      add(this.body, box, m(0x1b2025), x, 0.6, 1.2, 0.1, 0.9, 0.1)
      add(this.body, box, m(0x1b2025), x, 0.6, -0.6, 0.1, 0.9, 0.1)
    }
    add(this.body, box, m(0x1b2025), 1.45, 1.6, 0.6, 0.4, 0.3, 1.2)
    const bladeMat = m(0x20262b)
    for (let i = 0; i < 4; i += 1) {
      const blade = add(this.rotor, box, bladeMat, 0, 0, 0, 0.35, 0.05, 11)
      blade.rotation.y = (i / 4) * Math.PI
    }
    this.rotor.position.set(0, 3.5, 0.2)
    this.body.add(this.rotor)
    for (let i = 0; i < 2; i += 1) {
      const b = add(this.tailRotor, box, bladeMat, 0, 0, 0, 0.05, 0.2, 2)
      b.rotation.x = i * Math.PI / 2
    }
    this.tailRotor.position.set(0.3, 2.9, -6)
    this.body.add(this.tailRotor)
    const beacon = new THREE.MeshBasicMaterial({ color, toneMapped: false })
    add(this.body, new THREE.SphereGeometry(0.12, 8, 6), beacon, 0, 3.9, -5.9)
    add(this.body, new THREE.SphereGeometry(0.1, 8, 6), beacon, 0, 1.0, 1.2)
    this.searchLight = add(this.body, new THREE.ConeGeometry(4, 16, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }), 0, -6.5, 3)
    this.searchLight.castShadow = false
    this.searchLight.visible = false
    this.mesh.add(this.body)
    this.mesh.rotation.order = 'YXZ'
    scene.add(this.mesh)
    this.parkNow()
  }

  get airborne(): boolean {
    return this.phase !== 'parked' && this.phase !== 'wreck'
  }
  get alive(): boolean {
    return this.phase !== 'down' && this.phase !== 'wreck'
  }
  get busy(): boolean {
    return this.phase !== 'parked'
  }
  get center(): THREE.Vector3 {
    return tmp2.set(this.pos.x, this.pos.y + 1.9, this.pos.z)
  }

  parkNow(): void {
    this.pos.set(this.pad.x, 0, this.pad.z)
    this.prev.copy(this.pos)
    this.vel.set(0, 0, 0)
    this.yaw = this.prevYaw = this.team === 0 ? Math.PI / 2 : -Math.PI / 2
    this.phase = 'parked'
    this.mission = null
    this.hp = this.maxHp
    this.mesh.visible = true
    this.body.rotation.set(0, 0, 0)
  }

  call(mission: HeliMission, time: number, passenger: Unit | null): boolean {
    if (this.phase !== 'parked' || time < this.readyAt) return false
    this.mission = mission
    this.passenger = passenger
    this.phase = 'takeoff'
    this.readyAt = time + CONFIG.heli.cooldown
    return true
  }

  /** Door-gunner seat position for a passenger (right side). */
  seat(out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw)
    const lx = -2.25, lz = 0.9
    return out.set(this.pos.x + lx * c + lz * s, this.pos.y + 0.75, this.pos.z - lx * s + lz * c)
  }

  damage(amount: number, host: HeliHost): void {
    if (!this.alive || !this.airborne) return
    this.hp -= amount
    if (this.hp <= 0) {
      this.hp = 0
      this.phase = 'down'
      this.phaseUntil = host.time + 6
      this.spin = 0
    }
  }

  /** Ray vs a rough ellipsoid hull. */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    if (!this.alive) return -1
    const c = this.center
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z
    const r = 2.6
    const b = ox * d.x + oy * d.y + oz * d.z
    const cc = ox * ox + oy * oy + oz * oz - r * r
    const disc = b * b - cc
    if (disc < 0) return -1
    const t = -b - Math.sqrt(disc)
    return t >= 0 && t <= maxT ? t : -1
  }

  step(dt: number, host: HeliHost): void {
    this.prev.copy(this.pos)
    this.prevYaw = this.yaw
    const cfg = CONFIG.heli
    const m = this.mission
    let target: THREE.Vector3 | null = null
    let speed: number = cfg.cruise
    switch (this.phase) {
      case 'parked':
        this.rotorSpeed = Math.max(0, this.rotorSpeed - dt * 6)
        break
      case 'takeoff':
        this.rotorSpeed = Math.min(40, this.rotorSpeed + dt * 30)
        target = tmp.set(this.pad.x, cfg.height, this.pad.z)
        speed = 9
        if (this.pos.y > cfg.height - 6) this.phase = 'transit'
        break
      case 'transit':
        target = tmp.set(m!.x, cfg.height, m!.z)
        if (Math.hypot(this.pos.x - m!.x, this.pos.z - m!.z) < 6) {
          if (m!.insert && this.passenger) {
            this.phase = 'hover'
            this.phaseUntil = host.time + 2.2
          } else {
            this.phase = 'orbit'
            this.phaseUntil = host.time + cfg.supportTime
          }
        }
        break
      case 'hover':
        target = tmp.set(m!.x, 14, m!.z)
        speed = 10
        if (host.time >= this.phaseUntil && this.pos.y < 17) {
          host.onHeliDrop(this)
          this.passenger = null
          this.phase = 'orbit'
          this.phaseUntil = host.time + cfg.supportTime
        }
        break
      case 'orbit': {
        this.orbitA += dt * 0.42
        target = tmp.set(m!.x + Math.cos(this.orbitA) * 24, 26, m!.z + Math.sin(this.orbitA) * 24)
        speed = 16
        this.gunner(dt, host)
        if (host.time >= this.phaseUntil) this.phase = 'return'
        break
      }
      case 'return':
        target = tmp.set(this.pad.x, cfg.height, this.pad.z)
        if (Math.hypot(this.pos.x - this.pad.x, this.pos.z - this.pad.z) < 4) this.phase = 'landing'
        break
      case 'landing':
        target = tmp.set(this.pad.x, 0, this.pad.z)
        speed = 6
        if (this.pos.y < 0.15) {
          this.pos.y = 0
          this.vel.set(0, 0, 0)
          this.phase = 'parked'
          this.mission = null
          this.passenger = null
        }
        break
      case 'down': {
        this.spin += dt * 4
        this.yaw += this.spin * dt
        this.vel.y -= 14 * dt
        this.vel.x *= 0.99
        this.vel.z *= 0.99
        this.pos.addScaledVector(this.vel, dt)
        const g = host.col.groundAt(this.pos.x, this.pos.z, 1.5, this.pos.y + 2)
        if (this.pos.y <= Math.max(g, -1.2)) {
          this.pos.y = Math.max(g, -1.2)
          this.phase = 'wreck'
          this.phaseUntil = host.time + cfg.respawn
          host.onHeliCrash(this)
        }
        return
      }
      case 'wreck':
        this.rotorSpeed = 0
        if (host.time >= this.phaseUntil) this.parkNow()
        return
    }
    if (target) {
      const dx = target.x - this.pos.x, dy = target.y - this.pos.y, dz = target.z - this.pos.z
      const d = Math.hypot(dx, dy, dz)
      const want = Math.min(speed, d * 1.2)
      const k = Math.min(1, dt * 1.6)
      if (d > 0.01) {
        this.vel.x += ((dx / d) * want - this.vel.x) * k
        this.vel.y += ((dy / d) * want - this.vel.y) * k
        this.vel.z += ((dz / d) * want - this.vel.z) * k
      }
      this.pos.addScaledVector(this.vel, dt)
      const hs = Math.hypot(this.vel.x, this.vel.z)
      if (hs > 1.5) {
        const wantYaw = Math.atan2(this.vel.x, this.vel.z)
        let dyaw = wantYaw - this.yaw
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw))
        this.yaw += dyaw * Math.min(1, dt * 1.8)
        this.bank += (-dyaw * 0.8 - this.bank) * Math.min(1, dt * 3)
      } else this.bank *= 0.95
      this.pitch += (Math.min(0.28, hs * 0.012) - this.pitch) * Math.min(1, dt * 2)
    }
  }

  private gunner(dt: number, host: HeliHost): void {
    this.gunCd -= dt
    if (this.gunCd > 0) return
    const cfg = CONFIG.heli
    const origin = this.center.clone()
    origin.y -= 0.8
    let best: Unit | null = null
    let bestD: number = cfg.range
    for (const u of host.units) {
      if (u.team === this.team || !u.alive || u.sheltered) continue
      const d = u.pos.distanceTo(origin)
      if (d < bestD && host.col.lineOfSight(origin, tmp.set(u.pos.x, u.pos.y + 1.1, u.pos.z))) {
        best = u
        bestD = d
      }
    }
    if (!best) {
      this.gunCd = 0.4
      return
    }
    this.gunCd = cfg.gunInterval
    const dir = new THREE.Vector3(best.pos.x, best.pos.y + 1.1, best.pos.z).sub(origin).normalize()
    const spread = 0.045
    dir.x += (Math.random() - 0.5) * spread * 2
    dir.y += (Math.random() - 0.5) * spread * 2
    dir.z += (Math.random() - 0.5) * spread * 2
    dir.normalize()
    host.fire({ team: this.team, name: this.name }, origin, dir, cfg.gunDamage, 0xfff09a)
  }

  render(alpha: number, dt: number): void {
    this.mesh.position.lerpVectors(this.prev, this.pos, alpha)
    let dy = this.yaw - this.prevYaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    this.mesh.rotation.y = this.prevYaw + dy * alpha
    this.body.rotation.x = this.phase === 'wreck' ? 0.3 : this.pitch
    this.body.rotation.z = this.phase === 'wreck' ? 0.5 : this.bank
    this.rotor.rotation.y += this.rotorSpeed * dt
    this.tailRotor.rotation.x += this.rotorSpeed * 1.6 * dt
    this.searchLight.visible = this.phase === 'orbit' || this.phase === 'hover'
  }
}
