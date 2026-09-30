import * as THREE from 'three'
import { CONFIG, NEUTRAL_COLOR, TEAM_COLORS } from './config'
import { L } from './i18n'
import { ISLAND, type EmplacementKind } from './map'
import type { Unit } from './units'

type Def = { id: string; kind: EmplacementKind; x: number; z: number; yaw: number }

/**
 * Fixed weapons on 出海岛. They belong to whichever team holds the island.
 *  - 海盾防空炮 (AA): 'aim' mode fires proximity-fused flak; 'lock' mode tracks an aircraft and
 *    fires a guided SAM once the lock completes.
 *  - 潮汐远程火箭炮 (artillery): designates a far target and fires a 10-rocket saturation salvo.
 */
export class Emplacement {
  readonly pos: THREE.Vector3
  readonly center: THREE.Vector3
  readonly group = new THREE.Group()
  readonly turret = new THREE.Group()
  readonly pivot = new THREE.Group()
  yaw: number
  pitch = 0.35
  hp: number
  readonly maxHp: number
  alive = true
  respawnAt = 0
  team = -1
  enabled = false
  operator: Unit | null = null
  // AA state.
  lockMode = false
  lockTarget: unknown = null
  lockT = 0
  flakCd = 0
  samReadyAt = 0
  autoSamAt = 0
  flakSide = 0
  // Artillery state.
  readyAt = 0
  salvoLeft = 0
  salvoAt = 0
  readonly salvoTarget = new THREE.Vector3()
  salvoOwner = -1
  aiAt = 0
  private lights: THREE.MeshBasicMaterial[] = []
  private mats: THREE.Material[] = []
  private meshes: THREE.Mesh[] = []
  private readonly wreck = new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 1 })
  private dish: THREE.Object3D | null = null

  sign!: THREE.Sprite
  constructor(readonly def: Def, scene: THREE.Scene, label: (zh: string, en: string, h: number, opts: object) => THREE.Sprite) {
    this.pos = new THREE.Vector3(def.x, ISLAND.y, def.z)
    this.center = new THREE.Vector3(def.x, ISLAND.y + 1.6, def.z)
    this.yaw = def.yaw
    const cfg = def.kind === 'aa' ? CONFIG.aa : CONFIG.artillery
    this.maxHp = this.hp = cfg.hp
    this.group.position.copy(this.pos)
    if (def.kind === 'aa') this.buildAA()
    else this.buildArty()
    this.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
        this.meshes.push(m)
        this.mats.push(m.material as THREE.Material)
      }
    })
    const sign = (this.sign = def.kind === 'aa'
      ? label('海盾防空炮', 'Sea Shield AA', 0.9, { color: '#bff8ff', bg: 'rgba(5,25,40,0.85)', size: 44, pad: 10 })
      : label('潮汐远程火箭炮', 'Tide Rocket Battery', 0.9, { color: '#ffe0b0', bg: 'rgba(40,20,5,0.85)', size: 44, pad: 10 }))
    sign.position.set(def.x, ISLAND.y + (def.kind === 'aa' ? 5 : 5.4), def.z)
    scene.add(sign, this.group)
  }

  get kind(): EmplacementKind {
    return this.def.kind
  }

  get name(): string {
    return this.def.kind === 'aa' ? L('海盾防空炮', 'Sea Shield AA gun') : L('潮汐远程火箭炮', 'Tide rocket battery')
  }

  private m(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.45, ...opts })
  }

  private light(): THREE.MeshBasicMaterial {
    const l = new THREE.MeshBasicMaterial({ color: NEUTRAL_COLOR, toneMapped: false })
    this.lights.push(l)
    return l
  }

  private buildAA(): void {
    const olive = this.m(0x55624e)
    const dark = this.m(0x262c31)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 0.7, 16), this.m(0x8b8f8a, { metalness: 0.1, roughness: 0.9 }))
    base.position.y = 0.35
    this.group.add(base)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.07, 6, 32), this.light())
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.72
    this.group.add(ring)
    this.turret.position.y = 0.7
    this.group.add(this.turret)
    const housing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 2.4), olive)
    housing.position.y = 0.65
    this.turret.add(housing)
    const shield = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 0.15), olive)
    shield.position.set(0, 1.5, -1.0)
    shield.rotation.x = -0.25
    this.turret.add(shield)
    this.pivot.position.set(0, 1.55, -0.3)
    this.turret.add(this.pivot)
    const barrelGeo = new THREE.CylinderGeometry(0.09, 0.11, 3.4, 8).rotateX(Math.PI / 2)
    for (const x of [-0.35, 0.35]) {
      const b = new THREE.Mesh(barrelGeo, dark)
      b.position.set(x, 0.1, -1.8)
      this.pivot.add(b)
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.35, 8).rotateX(Math.PI / 2), dark)
      brake.position.set(x, 0.1, -3.5)
      this.pivot.add(brake)
    }
    const breech = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 1.2), dark)
    breech.position.set(0, 0.1, -0.1)
    this.pivot.add(breech)
    // SAM pods on both sides (4 tubes each, red caps).
    const cap = this.m(0xd8413a, { emissive: 0x551010, emissiveIntensity: 0.6 })
    for (const sx of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 1.6), olive)
      pod.position.set(sx * 1.45, 0.2, -0.6)
      this.pivot.add(pod)
      for (const [tx, ty] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]] as const) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 8).rotateX(Math.PI / 2), cap)
        c.position.set(sx * 1.45 + tx, 0.2 + ty, -1.42)
        this.pivot.add(c)
      }
    }
    // Rotating radar.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), dark)
    mast.position.set(0.8, 1.8, 0.9)
    this.turret.add(mast)
    const dish = new THREE.Group()
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.06), this.m(0xd9dee2))
    dish.add(plate)
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), this.light())
    led.position.set(0, 0.3, 0)
    dish.add(led)
    dish.position.set(0.8, 2.45, 0.9)
    this.turret.add(dish)
    this.dish = dish
  }

  private buildArty(): void {
    const camo = this.m(0x6b6a4a)
    const dark = this.m(0x262c31)
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.0, 6.4), camo)
    chassis.position.y = 1.0
    this.group.add(chassis)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 1.8), camo)
    cab.position.set(0, 2.0, 2.4)
    this.group.add(cab)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.6, 0.06), this.m(0x9fd6ea, { roughness: 0.05, transparent: true, opacity: 0.7 }))
    glass.position.set(0, 2.2, 3.31)
    this.group.add(glass)
    const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12).rotateZ(Math.PI / 2)
    for (const z of [-2.2, -0.6, 2.2]) for (const x of [-1.35, 1.35]) {
      const w = new THREE.Mesh(wheel, this.m(0x15191c, { roughness: 0.9, metalness: 0 }))
      w.position.set(x, 0.55, z)
      this.group.add(w)
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.12, 6.44), this.light())
    strip.position.y = 1.3
    this.group.add(strip)
    this.turret.position.set(0, 1.5, -1.0)
    this.group.add(this.turret)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.3, 12), dark)
    this.turret.add(ring)
    this.pivot.position.set(0, 0.5, 0)
    this.turret.add(this.pivot)
    const pod = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.4, 3.6), camo)
    pod.position.set(0, 0.7, -0.6)
    this.pivot.add(pod)
    const tube = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 8).rotateX(Math.PI / 2)
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) {
      const t = new THREE.Mesh(tube, dark)
      t.position.set(-0.8 + c * 0.53, 0.25 + r * 0.45, -2.42)
      this.pivot.add(t)
    }
    this.pitch = 0.55
    this.yaw = this.def.yaw
  }

  setTeam(team: number): void {
    if (team === this.team) return
    this.team = team
    const c = team >= 0 ? TEAM_COLORS[team] : NEUTRAL_COLOR
    for (const l of this.lights) l.color.setHex(c)
  }

  /** Where an operator's eye sits (first-person for AA, cab for artillery). */
  seat(out: THREE.Vector3): THREE.Vector3 {
    if (this.kind === 'aa') {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw)
      return out.set(this.pos.x - fx * 0.9, this.pos.y + 3.0, this.pos.z - fz * 0.9)
    }
    return out.set(this.pos.x, this.pos.y + 2.6, this.pos.z + 2.4)
  }

  /** Muzzle position for flak (alternating barrels) or the rocket pod. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true)
    if (this.kind === 'aa') {
      this.flakSide = 1 - this.flakSide
      return this.pivot.localToWorld(out.set(this.flakSide ? 0.35 : -0.35, 0.1, -3.6))
    }
    return this.pivot.localToWorld(out.set((Math.random() - 0.5) * 1.6, 0.25 + Math.random() * 0.9, -2.6))
  }

  podMuzzle(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true)
    return this.pivot.localToWorld(out.set(Math.random() < 0.5 ? -1.45 : 1.45, 0.2, -1.5))
  }

  aimDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch)
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
  }

  /** Smoothly turn toward a world direction (used by the automatic mode). */
  track(dx: number, dy: number, dz: number, dt: number, rate = 2.2): boolean {
    const yaw = Math.atan2(-dx, -dz)
    const pitch = Math.atan2(dy, Math.hypot(dx, dz))
    let dyaw = yaw - this.yaw
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw))
    const step = rate * dt
    this.yaw += Math.max(-step, Math.min(step, dyaw))
    this.pitch += Math.max(-step, Math.min(step, pitch - this.pitch))
    this.pitch = Math.max(-0.1, Math.min(1.45, this.pitch))
    return Math.abs(dyaw) < 0.08 && Math.abs(pitch - this.pitch) < 0.08
  }

  rayHit(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    if (!this.alive || !this.enabled) return -1
    const r = this.kind === 'aa' ? 2.3 : 3.0
    const ox = o.x - this.center.x, oy = o.y - this.center.y, oz = o.z - this.center.z
    const b = ox * d.x + oy * d.y + oz * d.z
    const c = ox * ox + oy * oy + oz * oz - r * r
    const disc = b * b - c
    if (disc < 0) return -1
    const t = -b - Math.sqrt(disc)
    return t >= 0 && t <= maxT ? t : -1
  }

  destroy(time: number): void {
    this.alive = false
    this.operator = null
    this.lockTarget = null
    this.lockT = 0
    this.salvoLeft = 0
    this.respawnAt = time + (this.kind === 'aa' ? CONFIG.aa.respawn : CONFIG.artillery.respawn)
    for (const m of this.meshes) m.material = this.wreck
    this.pitch = -0.1
  }

  repair(): void {
    this.alive = true
    this.hp = this.maxHp
    this.meshes.forEach((m, i) => (m.material = this.mats[i]))
    this.pitch = this.kind === 'aa' ? 0.35 : 0.55
  }

  reset(): void {
    this.repair()
    this.operator = null
    this.lockMode = false
    this.lockTarget = null
    this.lockT = 0
    this.flakCd = 0
    this.samReadyAt = 0
    this.autoSamAt = 20
    this.readyAt = 0
    this.salvoLeft = 0
    this.aiAt = 0
    this.yaw = this.def.yaw
    this.setTeam(-1)
  }

  setEnabled(on: boolean): void {
    this.enabled = on
  }

  render(dt: number): void {
    this.turret.rotation.y = this.yaw - (this.kind === 'arty' ? 0 : 0)
    this.pivot.rotation.x = this.pitch
    if (this.dish && this.alive) this.dish.rotation.y += dt * 2.5
  }
}
