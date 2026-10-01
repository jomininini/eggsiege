import * as THREE from 'three'
import type { Collision, Vec3 } from './collide'
import { CONFIG, NEUTRAL_COLOR, TEAM_COLORS } from './config'
import { L } from './i18n'
import { isWater, LAND, SEA, SHORE_Z, WATER_Y } from './map'
import type { Unit } from './units'

export type VehicleKind = 'car' | 'boat' | 'lander'
const cfgOf = (k: VehicleKind) => (k === 'car' ? CONFIG.car : k === 'boat' ? CONFIG.boat : CONFIG.lander)
type Spawn = { team: number; x: number; z: number; yaw: number }

const tmp = new THREE.Vector3()

/** Drivable light combat vehicle (roads) or assault boat (sea). Forward = (sin yaw, 0, cos yaw). */
export class Vehicle {
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  readonly center = new THREE.Vector3()
  yaw = 0
  prevYaw = 0
  speed = 0
  hp: number
  readonly maxHp: number
  alive = true
  driver: Unit | null = null
  respawnAt = 0
  gunCd = 0
  readonly mesh = new THREE.Group()
  readonly turret = new THREE.Group()
  private wheels: THREE.Mesh[] = []
  private bob = Math.random() * 6
  readonly half: { x: number; y: number; z: number }
  readonly radius: number
  private wreck: THREE.Material
  private stripe: THREE.MeshStandardMaterial | null = null
  /** False when the mode does not use this vehicle (hidden and inert). */
  enabled = true
  /** 出海岛 patrol boat: owned by whoever holds the island. */
  readonly island: boolean
  /** Infantry riding on deck (landing craft only). */
  passengers: Unit[] = []
  readonly seats: number
  /** Landing craft waits at the pier for troops until this time (AI driver). */
  boardingUntil = 0
  constructor(readonly kind: VehicleKind, public team: number, readonly spawn: Spawn, scene: THREE.Scene, island = false) {
    this.island = island
    const cfg = cfgOf(kind)
    this.maxHp = this.hp = cfg.hp
    this.radius = cfg.radius
    this.seats = kind === 'lander' ? CONFIG.lander.seats : 0
    this.half = kind === 'car' ? { x: 1.25, y: 1.0, z: 2.4 } : kind === 'boat' ? { x: 1.5, y: 0.9, z: 3.3 } : { x: 1.9, y: 1.0, z: 4.6 }
    this.wreck = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1 })
    if (kind === 'car') this.buildCar()
    else if (kind === 'boat') this.buildBoat()
    else this.buildLander()
    this.mesh.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    scene.add(this.mesh)
    this.reset()
  }

  /** Boats and landing craft float; cars drive. */
  get naval(): boolean {
    return this.kind !== 'car'
  }
  get cfg() {
    return cfgOf(this.kind)
  }
  get freeSeats(): number {
    return this.seats - this.passengers.length
  }
  /** Deck position of passenger seat i (world). */
  seatPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    const lx = (i % 2 === 0 ? -0.9 : 0.9), lz = 1.9 - Math.floor(i / 2) * 1.5
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw)
    return out.set(this.pos.x + lx * c + lz * s, this.pos.y + 1.15, this.pos.z - lx * s + lz * c)
  }
  get label(): string {
    if (this.kind === 'car') return L('轻型战车', 'light combat vehicle')
    if (this.kind === 'lander') return L('飞鱼高速登陆艇', 'Flying Fish landing craft')
    return this.island ? L('出海岛巡逻艇', 'island patrol boat') : L('登陆快艇', 'assault boat')
  }

  /** Re-colour the team stripe (island boats change hands with the island). */
  setTeam(team: number): void {
    if (team === this.team) return
    this.team = team
    const c = team >= 0 ? TEAM_COLORS[team] : NEUTRAL_COLOR
    if (this.stripe) {
      this.stripe.color.setHex(c)
      this.stripe.emissive.setHex(c)
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    this.mesh.visible = on && this.alive
    if (!on) this.driver = null
  }

  private mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.3, ...opts })
  }

  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.set(x, y, z)
    mesh.scale.set(sx, sy, sz)
    parent.add(mesh)
    return mesh
  }

  private buildCar(): void {
    const box = new THREE.BoxGeometry(1, 1, 1)
    const team = TEAM_COLORS[this.team]
    const body = this.mat(0x3b4650)
    const accent = this.mat(team, { emissive: team, emissiveIntensity: 0.25 })
    const glass = this.mat(0x9fd6ea, { roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.6 })
    this.add(this.mesh, box, body, 0, 0.95, 0, 2.3, 0.8, 4.4)
    this.add(this.mesh, box, body, 0, 1.6, -0.35, 2.0, 0.65, 2.3)
    this.add(this.mesh, box, glass, 0, 1.62, 0.82, 1.9, 0.5, 0.08)
    this.add(this.mesh, box, accent, 0, 1.0, 0, 2.34, 0.14, 4.42)
    this.add(this.mesh, box, this.mat(0x222a31), 0, 0.72, 2.2, 2.2, 0.35, 0.3)
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff4d0, toneMapped: false })
    this.add(this.mesh, box, lamp, -0.75, 1.05, 2.21, 0.35, 0.16, 0.05)
    this.add(this.mesh, box, lamp, 0.75, 1.05, 2.21, 0.35, 0.16, 0.05)
    this.add(this.mesh, box, new THREE.MeshBasicMaterial({ color: team, toneMapped: false }), 0, 1.97, -0.3, 1.1, 0.1, 0.25)
    const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.4, 12)
    wheelGeo.rotateZ(Math.PI / 2)
    const tire = this.mat(0x15191c, { roughness: 0.9, metalness: 0 })
    for (const [x, z] of [[-1.15, 1.4], [1.15, 1.4], [-1.15, -1.4], [1.15, -1.4]] as const) this.wheels.push(this.add(this.mesh, wheelGeo, tire, x, 0.48, z))
    this.turret.position.set(0, 2.0, -0.6)
    this.add(this.turret, box, this.mat(0x2a3138), 0, 0.2, 0, 0.7, 0.4, 0.7)
    this.add(this.turret, new THREE.CylinderGeometry(0.07, 0.07, 1.6, 8).rotateX(Math.PI / 2), this.mat(0x1d2227), 0, 0.25, 0.9)
    this.add(this.turret, box, accent, 0, 0.45, -0.1, 0.72, 0.08, 0.5)
    this.mesh.add(this.turret)
  }

  private buildBoat(): void {
    const team = this.team >= 0 ? TEAM_COLORS[this.team] : NEUTRAL_COLOR
    const hullMat = this.mat(0xe9ecef, { roughness: 0.4 })
    const stripe = this.mat(team, { emissive: team, emissiveIntensity: this.island ? 0.6 : 0.25 })
    this.stripe = stripe
    const shape = new THREE.Shape()
    shape.moveTo(-1.5, -3.2)
    shape.lineTo(1.5, -3.2)
    shape.lineTo(1.5, 1.6)
    shape.quadraticCurveTo(1.2, 3.1, 0, 3.6)
    shape.quadraticCurveTo(-1.2, 3.1, -1.5, 1.6)
    shape.closePath()
    const hull = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false })
    hull.rotateX(Math.PI / 2)
    hull.translate(0, 0.9, 0)
    this.add(this.mesh, hull, hullMat, 0, 0, 0)
    const box = new THREE.BoxGeometry(1, 1, 1)
    this.add(this.mesh, box, stripe, 0, 0.55, -0.1, 3.05, 0.14, 6.1)
    this.add(this.mesh, box, this.mat(0x2d3640), 0, 1.3, -0.6, 1.8, 0.8, 1.6)
    this.add(this.mesh, box, this.mat(0x9fd6ea, { roughness: 0.05, transparent: true, opacity: 0.6 }), 0, 1.5, 0.25, 1.7, 0.5, 0.08)
    this.add(this.mesh, box, this.mat(0x1a1f24), 0, 0.95, -2.9, 0.6, 0.7, 0.5)
    this.turret.position.set(0, 1.3, 1.9)
    this.add(this.turret, box, this.mat(0x2a3138), 0, 0.15, 0, 0.5, 0.3, 0.5)
    this.add(this.turret, new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8).rotateX(Math.PI / 2), this.mat(0x1d2227), 0, 0.2, 0.75)
    this.mesh.add(this.turret)
  }

  /** Bow ramp, deck rails, armoured wheelhouse at the stern and a bow gun. */
  private buildLander(): void {
    const team = TEAM_COLORS[this.team]
    const hullMat = this.mat(0x56616b, { roughness: 0.5 })
    const deck = this.mat(0x3a4249, { roughness: 0.8 })
    const stripe = this.mat(team, { emissive: team, emissiveIntensity: 0.35 })
    this.stripe = stripe
    const box = new THREE.BoxGeometry(1, 1, 1)
    this.add(this.mesh, box, hullMat, 0, 0.55, 0, 3.8, 1.1, 9.2)
    this.add(this.mesh, box, deck, 0, 1.12, 0, 3.4, 0.06, 8.6)
    this.add(this.mesh, box, stripe, 0, 0.9, 0, 3.86, 0.16, 9.26)
    const ramp = this.add(this.mesh, box, hullMat, 0, 1.25, 4.55, 3.5, 1.2, 0.14)
    ramp.rotation.x = -0.25
    for (const x of [-1.85, 1.85]) this.add(this.mesh, box, this.mat(0x2a3138), x, 1.55, 0.4, 0.12, 0.8, 7.4)
    this.add(this.mesh, box, this.mat(0x2d3640), 0, 1.75, -3.5, 2.6, 1.3, 1.8)
    this.add(this.mesh, box, this.mat(0x9fd6ea, { roughness: 0.05, transparent: true, opacity: 0.6 }), 0, 2.05, -2.58, 2.4, 0.5, 0.06)
    this.add(this.mesh, box, new THREE.MeshBasicMaterial({ color: team, toneMapped: false }), 0, 2.48, -3.5, 1.2, 0.1, 0.3)
    this.add(this.mesh, box, this.mat(0x1a1f24), 0, 0.9, -4.8, 2.2, 0.8, 0.5)
    this.turret.position.set(0, 1.7, 3.6)
    this.add(this.turret, box, this.mat(0x2a3138), 0, 0.15, 0, 0.6, 0.35, 0.6)
    this.add(this.turret, new THREE.CylinderGeometry(0.07, 0.07, 1.6, 8).rotateX(Math.PI / 2), this.mat(0x1d2227), 0, 0.22, 0.85)
    this.mesh.add(this.turret)
  }
  reset(): void {
    this.passengers = []
    this.boardingUntil = 0
    this.pos.set(this.spawn.x, this.kind === 'car' ? 0 : WATER_Y, this.spawn.z)
    this.prev.copy(this.pos)
    this.yaw = this.prevYaw = this.spawn.yaw
    this.speed = 0
    this.hp = this.maxHp
    this.alive = true
    this.driver = null
    this.mesh.visible = this.enabled
    this.mesh.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.userData.mat) m.material = m.userData.mat
    })
    this.mesh.rotation.set(0, this.yaw, 0)
  }

  destroy(): void {
    this.alive = false
    this.speed = 0
    this.respawnAt = 0
    this.mesh.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        if (!m.userData.mat) m.userData.mat = m.material
        m.material = this.wreck
      }
    })
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
  }

  /** Advance one physics step. throttle/steer in [-1, 1]. Returns impact speed if it hit something. */
  drive(dt: number, throttle: number, steer: number, col: Collision): number {
    this.prev.copy(this.pos)
    this.prevYaw = this.yaw
    if (!this.alive) return 0
    const cfg = this.cfg
    if (throttle > 0) this.speed += (this.speed < 0 ? cfg.brake : cfg.accel) * throttle * dt
    else if (throttle < 0) this.speed -= (this.speed > 0 ? cfg.brake : cfg.accel * 0.6) * -throttle * dt
    else this.speed *= 1 - dt * (this.kind === 'car' ? 0.9 : 0.55)
    this.speed = Math.max(-cfg.reverse, Math.min(cfg.maxSpeed, this.speed))
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0
    const grip = Math.min(1, Math.abs(this.speed) / 6)
    this.yaw -= steer * cfg.turn * grip * Math.sign(this.speed || 1) * dt
    const f = this.forward(tmp)
    this.pos.x += f.x * this.speed * dt
    this.pos.z += f.z * this.speed * dt
    let impact = 0
    if (this.kind === 'car') {
      const before = { x: this.pos.x, z: this.pos.z }
      const hit = col.pushOut(this.pos, this.radius, 2.2, 0.45)
      if (this.pos.z < SHORE_Z + this.radius + 0.5) this.pos.z = SHORE_Z + this.radius + 0.5
      this.pos.x = Math.max(LAND.minX + 2, Math.min(LAND.maxX - 2, this.pos.x))
      this.pos.z = Math.min(LAND.maxZ - 2, this.pos.z)
      if (hit || Math.hypot(before.x - this.pos.x, before.z - this.pos.z) > 0.01) {
        impact = Math.abs(this.speed)
        this.speed *= 0.45
      }
      const g = col.groundAt(this.pos.x, this.pos.z, 1.0, this.pos.y + 0.45)
      if (g < -0.5) {
        // Never drive into the canal or the lake: bounce back onto the bank.
        this.pos.x = this.prev.x
        this.pos.z = this.prev.z
        impact = Math.abs(this.speed)
        this.speed *= -0.3
        this.pos.y = col.groundAt(this.pos.x, this.pos.z, 1.0, this.pos.y + 0.45)
      } else this.pos.y = g
    } else {
      const p: Vec3 = { x: this.pos.x, y: -1.4, z: this.pos.z }
      const hit = col.pushOut(p, this.radius, 2, 0.2)
      p.x = Math.max(SEA.minX, Math.min(SEA.maxX, p.x))
      p.z = Math.max(SEA.minZ, p.z)
      // Keep the hull on open water: sea, canal and the egg lake (the island and banks are solid).
      let blocked = false
      if (!waterOK(p.x, p.z, this.radius)) {
        blocked = true
        if (waterOK(p.x, this.prev.z, this.radius)) p.z = this.prev.z
        else if (waterOK(this.prev.x, p.z, this.radius)) p.x = this.prev.x
        else {
          p.x = this.prev.x
          p.z = this.prev.z
        }
      }
      this.pos.x = p.x
      this.pos.z = p.z
      if (hit || blocked) {
        impact = Math.abs(this.speed)
        this.speed *= blocked ? 0.35 : 0.5
      }
      this.bob += dt * 2
      this.pos.y = WATER_Y - 0.25 + Math.sin(this.bob) * 0.08
    }
    this.center.set(this.pos.x, this.pos.y + this.half.y, this.pos.z)
    return impact
  }

  /** Oriented-box ray test in local space. Returns hit distance or -1. */
  rayHit(o: Vec3, d: Vec3, maxT: number): number {
    if (!this.alive) return -1
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw)
    const ox = o.x - this.pos.x, oz = o.z - this.pos.z, oy = o.y - (this.pos.y + this.half.y)
    const lx = ox * c + oz * s, lz = -ox * s + oz * c
    const dx = d.x * c + d.z * s, dz = -d.x * s + d.z * c
    let t0 = 0, t1 = maxT
    const slab = (o1: number, d1: number, h: number) => {
      if (Math.abs(d1) < 1e-9) return Math.abs(o1) <= h
      let a = (-h - o1) / d1, b = (h - o1) / d1
      if (a > b) [a, b] = [b, a]
      t0 = Math.max(t0, a)
      t1 = Math.min(t1, b)
      return t0 <= t1
    }
    if (!slab(lx, dx, this.half.x) || !slab(oy, d.y, this.half.y) || !slab(lz, dz, this.half.z)) return -1
    return t0
  }

  render(alpha: number, dt: number, aimYaw?: number): void {
    this.mesh.position.lerpVectors(this.prev, this.pos, alpha)
    let dy = this.yaw - this.prevYaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    this.mesh.rotation.y = this.prevYaw + dy * alpha
    if (this.naval) {
      this.mesh.rotation.x = -Math.min(0.12, Math.abs(this.speed) * 0.004)
      this.mesh.rotation.z = Math.sin(this.bob * 0.7) * 0.03
    }
    for (const w of this.wheels) w.rotation.x += this.speed * dt / 0.48
    if (aimYaw !== undefined) this.turret.rotation.y = aimYaw - this.mesh.rotation.y
  }
}

/** Is the whole hull footprint over water? */
export function waterOK(x: number, z: number, r: number): boolean {
  const k = r * 0.8
  return isWater(x, z) && isWater(x + k, z) && isWater(x - k, z) && isWater(x, z + k) && isWater(x, z - k)
}
