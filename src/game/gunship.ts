import * as THREE from 'three'
import { CONFIG, TEAM_COLORS } from './config'
import { Heli, type HeliHost } from './heli'
import { L } from './i18n'
import { GUNSHIP_PADS, ISLAND_HELIPAD, LAND, SEA, WATER_Y, isWater } from './map'
import type { Unit } from './units'

/** Where an AI gunship should fight; `land` = touch down there afterwards (the held 出海岛 pad). */
export type GunshipObjective = { x: number; z: number; name: string; land: boolean }
export interface GunshipHost extends HeliHost {
  /** Hardware targets (vehicles / emplacements / boats) of the other team near a point. */
  gunshipHardTarget(team: number, near: THREE.Vector3, range: number): THREE.Vector3 | null
  gunshipObjective(team: number): GunshipObjective
  gunshipRocket(g: Gunship, from: THREE.Vector3, dir: THREE.Vector3): void
  islandOwner(): number
}
/** Pilot controls written by the game each step while the player flies. */
export type GunshipControls = { fwd: number; strafe: number; up: number; yaw: number; boost: boolean }

const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * 雷鸣 attack helicopter (sea mode). The player can fly it from its pad (E), otherwise the AI
 * sorties periodically: climb, fly to an objective, orbit and strafe with the chin cannon and
 * rocket pods, then return — or land on the 出海岛 helipad when its team holds the isle.
 */
export class Gunship extends Heli {
  pilot: Unit | null = null
  readonly ctl: GunshipControls = { fwd: 0, strafe: 0, up: 0, yaw: 0, boost: false }
  rockets: number = CONFIG.gunship.rockets
  cannonCd = 0
  rocketCd = 0
  private sortieAt = 0
  private sortieUntil = 0
  private objective: GunshipObjective | null = null
  private landUntil = 0
  private idleSince = 0
  private podSide = 1
  /** Landed on a pad that rearms this team (own gunship pad, or the isle pad while holding the isle). */
  onRearmPad = false
  /** Just touched the isle helipad (for a one-off toast). */
  landedIsleAt = -99
  private landSpot: THREE.Vector3 | null = null

  constructor(team: number, scene: THREE.Scene) {
    super(team, scene)
    this.pad = GUNSHIP_PADS[team]
    this.maxHp = CONFIG.gunship.hp
    this.parkNow()
  }
  override get name(): string {
    return this.team === 0 ? L('红方武装直升机 “雷鸣”', 'Red gunship “Thunder”') : L('蓝方武装直升机 “怒涛”', 'Blue gunship “Surge”')
  }
  override get airborne(): boolean {
    return this.enabled && this.phase !== 'parked' && this.phase !== 'landed' && this.phase !== 'wreck'
  }
  override get busy(): boolean {
    return this.phase !== 'parked' && this.phase !== 'landed'
  }
  get grounded(): boolean {
    return this.phase === 'parked' || this.phase === 'landed'
  }
  override get center(): THREE.Vector3 {
    return tmp2.set(this.pos.x, this.pos.y + 1.7, this.pos.z)
  }
  setEnabled(on: boolean): void {
    this.enabled = on
    this.mesh.visible = on
    if (!on) this.pilot = null
  }
  override parkNow(): void {
    super.parkNow()
    this.rockets = CONFIG.gunship.rockets
    this.pilot = null
    this.objective = null
    this.landSpot = null
    this.mesh.visible = this.enabled
  }
  reset(time: number): void {
    this.parkNow()
    this.sortieAt = time + CONFIG.gunship.sortieEvery * (this.team === 0 ? 0.9 : 0.6)
  }
  override damage(amount: number, host: HeliHost): void {
    if (!this.enabled || !this.alive) return
    this.hp -= amount
    if (this.hp <= 0) {
      this.hp = 0
      this.phase = 'down'
      this.phaseUntil = host.time + 6
      this.spin = 0
      this.vel.y = Math.min(this.vel.y, 0)
      this.pilot = null
    }
  }
  override rayHit(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    if (!this.enabled) return -1
    return super.rayHit(o, d, maxT)
  }
  /** Chin cannon muzzle (world). */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw)
    return out.set(this.pos.x + s * 3.2, this.pos.y + 0.75, this.pos.z + c * 3.2)
  }
  /** Alternate rocket pod (world). */
  pod(out: THREE.Vector3): THREE.Vector3 {
    this.podSide = -this.podSide
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw)
    const lx = 2.0 * this.podSide, lz = 0.6
    return out.set(this.pos.x + lx * c + lz * s, this.pos.y + 1.25, this.pos.z - lx * s + lz * c)
  }
  /** Pilot seat / camera anchor. */
  override seat(out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw)
    return out.set(this.pos.x + s * 1.6, this.pos.y + 2.1, this.pos.z + c * 1.6)
  }
  /** The player takes the controls (only while grounded). */
  board(u: Unit): boolean {
    if (!this.enabled || !this.alive || this.pilot || !this.grounded) return false
    this.pilot = u
    this.ctl.fwd = this.ctl.strafe = this.ctl.up = 0
    this.ctl.yaw = this.yaw
    this.phase = 'landed'
    this.objective = null
    return true
  }
  leave(time: number): void {
    this.pilot = null
    this.idleSince = time
    if (this.phase === 'piloted') this.phase = 'down' // abandoned in the air: it falls
  }

  override step(dt: number, host: HeliHost): void {
    const h = host as GunshipHost
    this.prev.copy(this.pos)
    this.prevYaw = this.yaw
    if (!this.enabled) return
    const G = CONFIG.gunship
    this.cannonCd -= dt
    this.rocketCd -= dt
    if (this.phase === 'down' || this.phase === 'wreck') {
      this.crashStep(dt, host, G.respawn)
      if ((this.phase as string) === 'parked') this.sortieAt = host.time + G.sortieEvery
      return
    }
    if (this.grounded) this.rearm(dt, h)
    if (this.pilot) {
      this.pilotStep(dt, h)
      return
    }
    this.rotorSpeed = this.grounded ? Math.max(0, this.rotorSpeed - dt * 6) : Math.min(42, this.rotorSpeed + dt * 30)
    const t = host.time
    switch (this.phase) {
      case 'parked':
        if (t >= this.sortieAt) {
          this.objective = h.gunshipObjective(this.team)
          this.phase = 'takeoff'
          this.sortieUntil = t + G.sortieTime
        }
        return
      case 'landed':
        // Left somewhere by the player (or an AI isle stop): fly home after a while.
        if ((this.landSpot && t >= this.landUntil) || (!this.landSpot && t - this.idleSince > 25)) {
          this.landSpot = null
          this.phase = 'takeoff'
          this.objective = null
        }
        return
      case 'takeoff':
        this.rotorSpeed = Math.min(42, this.rotorSpeed + dt * 30)
        this.fly(tmp.set(this.pos.x, G.height, this.pos.z), 10, dt)
        if (this.pos.y > G.height - 5) this.phase = this.objective ? 'transit' : 'return'
        break
      case 'transit': {
        const o = this.objective!
        this.fly(tmp.set(o.x, G.height, o.z), G.speed, dt)
        this.attack(dt, h, 0.55)
        if (Math.hypot(this.pos.x - o.x, this.pos.z - o.z) < 14) this.phase = 'orbit'
        if (this.hp < this.maxHp * 0.35) this.phase = 'return'
        break
      }
      case 'orbit': {
        const o = this.objective!
        this.orbitA += dt * 0.5
        this.fly(tmp.set(o.x + Math.cos(this.orbitA) * 30, 28, o.z + Math.sin(this.orbitA) * 30), 18, dt)
        this.attack(dt, h, 1)
        if (t >= this.sortieUntil || this.hp < this.maxHp * 0.35) {
          if (o.land && h.islandOwner() === this.team) {
            this.landSpot = new THREE.Vector3(ISLAND_HELIPAD.x, ISLAND_HELIPAD.y, ISLAND_HELIPAD.z)
            this.phase = 'landing'
          } else this.phase = 'return'
        }
        break
      }
      case 'return':
        this.fly(tmp.set(this.pad.x, G.height, this.pad.z), G.speed, dt)
        this.attack(dt, h, 0.4)
        if (Math.hypot(this.pos.x - this.pad.x, this.pos.z - this.pad.z) < 4) this.phase = 'landing'
        break
      case 'landing': {
        const s = this.landSpot ?? tmp2.set(this.pad.x, 0, this.pad.z)
        const sx = s.x, sy = s.y, sz = s.z
        this.fly(tmp.set(sx, sy, sz), Math.hypot(this.pos.x - sx, this.pos.z - sz) > 6 ? 16 : 6, dt)
        if (this.pos.y < sy + 0.2 && Math.hypot(this.pos.x - sx, this.pos.z - sz) < 1.5) {
          this.pos.y = sy
          this.vel.set(0, 0, 0)
          if (this.landSpot) {
            this.phase = 'landed'
            this.landUntil = t + 10
            this.landedIsleAt = t
          } else {
            this.phase = 'parked'
            this.sortieAt = t + G.sortieEvery
          }
          this.objective = null
        }
        break
      }
      default:
        this.phase = 'return'
    }
  }
  /** Repairs and reloads rockets while sitting on a pad of its own side. */
  private rearm(dt: number, h: GunshipHost): void {
    const onOwn = Math.hypot(this.pos.x - this.pad.x, this.pos.z - this.pad.z) < GUNSHIP_PADS[this.team].r + 1
    const onIsle = Math.hypot(this.pos.x - ISLAND_HELIPAD.x, this.pos.z - ISLAND_HELIPAD.z) < ISLAND_HELIPAD.r + 1.5 && h.islandOwner() === this.team
    this.onRearmPad = onOwn || onIsle
    if (!this.onRearmPad) return
    const G = CONFIG.gunship
    this.hp = Math.min(this.maxHp, this.hp + (this.maxHp / G.rearmTime) * dt)
    if (this.rockets < G.rockets && Math.random() < dt * (G.rockets / G.rearmTime)) this.rockets += 1
  }
  private pilotStep(dt: number, h: GunshipHost): void {
    const G = CONFIG.gunship
    const c = this.ctl
    this.rotorSpeed = Math.min(42, this.rotorSpeed + dt * 30)
    if (this.grounded && c.up > 0 && this.rotorSpeed > 18) this.phase = 'piloted'
    if (this.grounded) {
      this.vel.set(0, 0, 0)
      this.yaw += wrap(c.yaw - this.yaw) * Math.min(1, dt * 2)
      return
    }
    this.yaw += wrap(c.yaw - this.yaw) * Math.min(1, dt * 3.2)
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw)
    // Pilot's right for forward (sin, cos) is (-cos, sin) (yaw 0 faces +z, right is -x).
    const rx = -fz, rz = fx
    const sp = G.speed * (c.boost ? 1.3 : 1)
    const wantX = (fx * c.fwd + rx * c.strafe) * sp
    const wantZ = (fz * c.fwd + rz * c.strafe) * sp
    const k = Math.min(1, dt * 1.4)
    this.vel.x += (wantX - this.vel.x) * k
    this.vel.z += (wantZ - this.vel.z) * k
    this.vel.y += (c.up * G.climb - this.vel.y) * Math.min(1, dt * 3)
    this.pos.addScaledVector(this.vel, dt)
    this.pos.x = Math.max(SEA.minX, Math.min(SEA.maxX, this.pos.x))
    this.pos.z = Math.max(SEA.minZ, Math.min(LAND.maxZ + 20, this.pos.z))
    this.pos.y = Math.min(110, this.pos.y)
    // Buildings: push out sideways, settle on roofs / ground.
    const before = { x: this.pos.x, z: this.pos.z }
    const p = { x: this.pos.x, y: this.pos.y, z: this.pos.z }
    h.col.pushOut(p, 2.8, 3.2, 0.8)
    this.pos.x = p.x
    this.pos.z = p.z
    const moved = Math.hypot(before.x - p.x, before.z - p.z)
    if (moved > 0.05) {
      const hs = Math.hypot(this.vel.x, this.vel.z)
      if (hs > 16) this.damage((hs - 16) * 6, h)
      this.vel.x *= 0.3
      this.vel.z *= 0.3
    }
    const water = isWater(this.pos.x, this.pos.z)
    const g = water ? WATER_Y + 1.2 : h.col.groundAt(this.pos.x, this.pos.z, 2.2, this.pos.y + 1.5)
    if (this.pos.y <= g) {
      if (this.vel.y < -9) this.damage((-this.vel.y - 9) * 25, h)
      this.pos.y = g
      this.vel.y = Math.max(0, this.vel.y)
      const hs = Math.hypot(this.vel.x, this.vel.z)
      if (!water && hs < 4 && c.up <= 0) {
        this.phase = 'landed'
        this.vel.set(0, 0, 0)
        if (Math.hypot(this.pos.x - ISLAND_HELIPAD.x, this.pos.z - ISLAND_HELIPAD.z) < ISLAND_HELIPAD.r + 2) this.landedIsleAt = h.time
      }
    }
    const hs = Math.hypot(this.vel.x, this.vel.z)
    this.pitch += (Math.max(-0.2, Math.min(0.3, c.fwd * hs * 0.012)) - this.pitch) * Math.min(1, dt * 2.5)
    this.bank += (c.strafe * Math.min(1, hs / 20) * 0.3 - this.bank) * Math.min(1, dt * 3)
  }
  /** AI weapons: cannon on infantry in range, rockets on hardware. */
  private attack(_dt: number, h: GunshipHost, aggression: number): void {
    const G = CONFIG.gunship
    const origin = this.muzzle(new THREE.Vector3())
    if (this.rocketCd <= 0 && this.rockets > 0) {
      const hard = h.gunshipHardTarget(this.team, this.pos, G.aiRange)
      if (hard) {
        this.rocketCd = G.rocketInterval * 4 / aggression
        this.rockets -= 1
        const from = this.pod(new THREE.Vector3())
        const dir = hard.clone().sub(from).normalize()
        dir.x += (Math.random() - 0.5) * 0.04
        dir.z += (Math.random() - 0.5) * 0.04
        h.gunshipRocket(this, from, dir.normalize())
        return
      }
    }
    if (this.cannonCd > 0) return
    let best: Unit | null = null
    let bestD: number = G.aiRange * 0.8
    for (const u of h.units) {
      if (u.team === this.team || !u.alive) continue
      const d = u.pos.distanceTo(origin)
      if (d < bestD && h.col.lineOfSight(origin, tmp.set(u.pos.x, u.pos.y + 1.1, u.pos.z))) {
        best = u
        bestD = d
      }
    }
    if (!best) {
      this.cannonCd = 0.35
      return
    }
    this.cannonCd = G.cannonInterval * 1.6 / aggression
    const dir = new THREE.Vector3(best.pos.x, best.pos.y + 1.0, best.pos.z).sub(origin).normalize()
    const spread = 0.04
    dir.x += (Math.random() - 0.5) * spread * 2
    dir.y += (Math.random() - 0.5) * spread * 2
    dir.z += (Math.random() - 0.5) * spread * 2
    h.fire({ team: this.team, name: this.name }, origin, dir.normalize(), G.cannonDamage * 0.7, 0xffc46a)
  }

  protected override buildModel(color: number): void {
    const m = (c: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.45, ...o })
    const hull = m(0x3a4148)
    const dark = m(0x1b2025)
    const accent = m(color, { emissive: color, emissiveIntensity: 0.4 })
    const glass = m(0x7fc4e0, { roughness: 0.05, transparent: true, opacity: 0.75 })
    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(g, mat)
      mesh.position.set(x, y, z)
      mesh.scale.set(sx, sy, sz)
      mesh.castShadow = true
      parent.add(mesh)
      return mesh
    }
    const box = new THREE.BoxGeometry(1, 1, 1)
    const sphere = new THREE.SphereGeometry(1, 14, 10)
    // Slim tandem-seat fuselage.
    add(this.body, sphere, hull, 0, 1.7, 0.2, 0.95, 1.05, 3.0)
    add(this.body, sphere, glass, 0, 2.15, 1.5, 0.7, 0.6, 1.25)
    add(this.body, sphere, glass, 0, 2.35, 0.2, 0.62, 0.55, 0.9)
    add(this.body, box, hull, 0, 1.95, -3.9, 0.4, 0.45, 5.2)
    add(this.body, box, accent, 0, 2.75, -6.3, 0.12, 1.5, 1.0)
    add(this.body, box, hull, 0, 2.0, -6.0, 2.0, 0.08, 0.7)
    add(this.body, box, accent, 0, 1.25, 0.2, 1.95, 0.14, 3.6)
    add(this.body, box, dark, 0, 2.85, 0.1, 0.7, 0.4, 1.4)
    // Stub wings with rocket pods and missiles.
    add(this.body, box, hull, 0, 1.45, 0.4, 4.4, 0.14, 0.9)
    for (const x of [-2.0, 2.0]) {
      add(this.body, new THREE.CylinderGeometry(0.28, 0.28, 1.5, 10).rotateX(Math.PI / 2), dark, x, 1.15, 0.6)
      add(this.body, new THREE.CylinderGeometry(0.26, 0.26, 0.05, 10).rotateX(Math.PI / 2), accent, x, 1.15, 1.36)
      add(this.body, new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6).rotateX(Math.PI / 2), m(0xe8ecef), x * 0.62, 1.12, 0.6)
    }
    // Chin cannon.
    add(this.body, sphere, dark, 0, 0.85, 2.5, 0.32, 0.3, 0.32)
    add(this.body, new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8).rotateX(Math.PI / 2), dark, 0, 0.8, 3.3)
    // Skids.
    for (const x of [-0.95, 0.95]) {
      add(this.body, box, dark, x, 0.1, 0.2, 0.12, 0.12, 3.6)
      add(this.body, box, dark, x, 0.55, 1.0, 0.1, 0.85, 0.1)
      add(this.body, box, dark, x, 0.55, -0.6, 0.1, 0.85, 0.1)
    }
    const bladeMat = m(0x20262b)
    for (let i = 0; i < 4; i += 1) {
      const blade = add(this.rotor, box, bladeMat, 0, 0, 0, 0.35, 0.05, 11.5)
      blade.rotation.y = (i / 4) * Math.PI
    }
    this.rotor.position.set(0, 3.15, 0.1)
    this.body.add(this.rotor)
    for (let i = 0; i < 2; i += 1) {
      const b = add(this.tailRotor, box, bladeMat, 0, 0, 0, 0.05, 0.2, 2)
      b.rotation.x = i * Math.PI / 2
    }
    this.tailRotor.position.set(0.3, 2.7, -6.4)
    this.body.add(this.tailRotor)
    const beacon = new THREE.MeshBasicMaterial({ color, toneMapped: false })
    add(this.body, new THREE.SphereGeometry(0.12, 8, 6), beacon, 0, 3.55, -6.3)
    add(this.body, new THREE.SphereGeometry(0.1, 8, 6), beacon, -2.2, 1.45, 0.4)
    add(this.body, new THREE.SphereGeometry(0.1, 8, 6), beacon, 2.2, 1.45, 0.4)
    this.searchLight = add(this.body, new THREE.ConeGeometry(4, 16, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }), 0, -6.5, 3)
    this.searchLight.castShadow = false
    this.searchLight.visible = false
    void TEAM_COLORS
  }
}
