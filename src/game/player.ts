import * as THREE from 'three'
import type { Input } from '../engine/input'
import type { Collision } from './collide'
import { CONFIG, PLAYER_TEAM } from './config'
import { L } from './i18n'
import { isWater, LAND, SEA, type SkillId } from './map'
import type { Unit } from './units'

export type PlayerMode = 'foot' | 'vehicle' | 'drone' | 'heli' | 'gunship' | 'aa' | 'arty' | 'dead'
export type WeaponSlot = 'rifle' | 'pistol' | 'launcher'
export const WEAPON_ORDER: WeaponSlot[] = ['rifle', 'pistol', 'launcher']

/** The local player: FPS movement, weapon state, buffs and stats. */
export class Player implements Unit {
  readonly id = 1
  readonly isPlayer = true
  get name(): string {
    return L('你', 'You')
  }
  readonly team = PLAYER_TEAM
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  yaw = 0
  pitch = 0
  kick = 0
  kickYaw = 0
  eyeY: number = CONFIG.player.eye
  onGround = true
  wading = false
  crouch = false
  sprinting = false
  hp: number = CONFIG.player.hp
  maxHp: number = CONFIG.player.hp
  shield = 0
  alive = true
  spottedUntil = 0
  sheltered = false
  spawnShieldUntil = 0
  kills = 0
  deaths = 0
  captures = 0
  lastHurt = -99
  lastAttacker: Unit | null = null
  respawnAt = 0
  mode: PlayerMode = 'foot'
  mag: number = CONFIG.weapon.mag
  reserve: number = CONFIG.weapon.reserve
  grenades: number = CONFIG.grenade.start
  reloadUntil = 0
  nextFire = 0
  bloom = 0
  shots = 0
  hits = 0
  headshots = 0
  damageDealt = 0
  buffs: Record<SkillId, number> = { scan: 0, shield: 0, steady: 0, rush: 0 }
  ads = 0
  /** Active weapon: KT-9 rifle or the Flyfish-2 guided missile launcher. */
  weapon: WeaponSlot = 'rifle'
  /** Sidearm magazine; its spare ammo is unlimited. */
  pmag: number = CONFIG.pistol.mag
  rocket = 1
  rocketReserve: number = CONFIG.launcher.reserve
  rocketReloadUntil = 0
  switchUntil = 0
  lockT = 0
  lockTarget: unknown = null
  private stepTimer = 0
  reset(x: number, z: number, yaw: number, time: number): void {
    this.pos.set(x, 0, z)
    this.prev.copy(this.pos)
    this.vel.set(0, 0, 0)
    this.yaw = yaw
    this.pitch = 0
    this.kick = this.kickYaw = 0
    this.hp = this.maxHp
    this.shield = 0
    this.alive = true
    this.sheltered = false
    this.mode = 'foot'
    this.mag = CONFIG.weapon.mag
    this.reserve = CONFIG.weapon.reserve
    this.pmag = CONFIG.pistol.mag
    this.grenades = Math.max(this.grenades, CONFIG.grenade.start)
    this.reloadUntil = 0
    // Time-based gates must be cleared: the match clock restarts at 0 on every new match.
    this.nextFire = 0
    this.spottedUntil = 0
    this.bloom = 0
    this.crouch = false
    this.weapon = 'rifle'
    this.rocket = 1
    this.rocketReserve = Math.max(this.rocketReserve, CONFIG.launcher.reserve)
    this.rocketReloadUntil = 0
    this.switchUntil = 0
    this.lockT = 0
    this.lockTarget = null
    this.spawnShieldUntil = time + CONFIG.player.spawnShield
    for (const k of Object.keys(this.buffs) as SkillId[]) this.buffs[k] = 0
  }

  resetStats(): void {
    this.kills = this.deaths = this.captures = this.shots = this.hits = this.headshots = this.damageDealt = 0
    this.grenades = CONFIG.grenade.start
    this.rocketReserve = CONFIG.launcher.reserve
  }
  /** Rifle completely dry (magazine and reserve). */
  get rifleDry(): boolean {
    return this.mag <= 0 && this.reserve < 1
  }
  get reloading(): boolean {
    return this.weapon === 'launcher' ? this.rocketReloadUntil > 0 : this.reloadUntil > 0
  }

  /** Swap between rifle and launcher (cancels a rifle reload). */
  switchWeapon(to: WeaponSlot, time: number): boolean {
    if (to === this.weapon) return false
    this.weapon = to
    this.reloadUntil = 0
    this.switchUntil = time + 0.45
    this.lockT = 0
    this.lockTarget = null
    if (to === 'launcher' && this.rocket === 0 && this.rocketReserve > 0 && this.rocketReloadUntil === 0) this.rocketReloadUntil = time + CONFIG.launcher.reload
    return true
  }

  startRocketReload(time: number): boolean {
    if (this.rocket > 0 || this.rocketReserve <= 0 || this.rocketReloadUntil > 0) return false
    this.rocketReloadUntil = time + CONFIG.launcher.reload
    return true
  }
  buff(id: SkillId, time: number): boolean {
    return this.buffs[id] > time
  }

  look(dx: number, dy: number): void {
    const fovScale = 1 - this.ads * 0.4
    this.yaw -= dx * fovScale
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * fovScale))
  }

  /** On-foot movement for one fixed step. Returns 'jump' | 'land' | 'splash' events for audio. */
  move(dt: number, input: Input, col: Collision, time: number): string | null {
    const cfg = CONFIG.player
    this.prev.copy(this.pos)
    let event: string | null = null
    const wantCrouch = input.held('crouch')
    if (wantCrouch !== this.crouch) {
      if (wantCrouch) this.crouch = true
      else if (col.ceilingAt(this.pos.x, this.pos.z, cfg.radius, this.pos.y + cfg.crouchHeight) > this.pos.y + cfg.height) this.crouch = false
    }
    const fwd = input.move.y, strafe = input.move.x
    this.sprinting = input.held('sprint') && fwd > 0 && !this.crouch && this.ads < 0.3 && !this.reloading && !this.wading
    let speed = this.wading ? cfg.swimSpeed : this.crouch ? cfg.crouchSpeed : this.sprinting ? cfg.sprint : cfg.walk
    if (this.buff('rush', time)) speed *= 1.35
    if (this.ads > 0.5) speed *= 0.7
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
    const wx = -sy * fwd + cy * strafe
    const wz = -cy * fwd - sy * strafe
    const accel = this.onGround || this.wading ? cfg.accel : cfg.airAccel
    const k = Math.min(1, (accel * dt) / Math.max(speed, 1))
    this.vel.x += (wx * speed - this.vel.x) * k
    this.vel.z += (wz * speed - this.vel.z) * k
    if (input.consume('jump') && (this.onGround || this.wading)) {
      this.vel.y = this.wading ? cfg.jump * 0.7 : cfg.jump
      this.onGround = false
      event = 'jump'
    }
    this.vel.y += cfg.gravity * dt
    const height = this.crouch ? cfg.crouchHeight : cfg.height
    const prevY = this.pos.y
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt
    col.pushOut(this.pos, cfg.radius, height, this.onGround ? cfg.step : 0.25)
    this.pos.x = Math.max(LAND.minX + 0.5, Math.min(LAND.maxX - 0.5, this.pos.x))
    this.pos.z = Math.max(SEA.minZ, Math.min(LAND.maxZ - 0.5, this.pos.z))
    this.pos.y += this.vel.y * dt
    if (this.vel.y > 0) {
      const c = col.ceilingAt(this.pos.x, this.pos.z, cfg.radius, prevY + height - 0.05)
      if (this.pos.y + height > c) {
        this.pos.y = c - height
        this.vel.y = 0
      }
    }
    const ground = col.groundAt(this.pos.x, this.pos.z, cfg.radius, Math.max(prevY, this.pos.y) + (this.onGround ? cfg.step : 0.3))
    const wasGround = this.onGround
    if (this.pos.y <= ground) {
      if (!wasGround && this.vel.y < -7) event = 'land'
      this.pos.y = ground
      this.vel.y = 0
      this.onGround = true
    } else if (this.onGround && this.pos.y - ground < cfg.step && this.vel.y <= 0) {
      this.pos.y = ground
      this.vel.y = 0
    } else this.onGround = false
    const wasWading = this.wading
    this.wading = isWater(this.pos.x, this.pos.z) && this.pos.y < -0.8
    if (this.wading && !wasWading) event = 'splash'
    const targetEye = this.crouch ? cfg.crouchEye : cfg.eye
    this.eyeY += (targetEye - this.eyeY) * Math.min(1, dt * 12)
    const hs = Math.hypot(this.vel.x, this.vel.z)
    this.stepTimer += hs * dt
    return event
  }

  /** Weapon timers and recoil recovery. */
  tickWeapon(dt: number, time: number): boolean {
    const w = CONFIG.weapon
    this.kick -= this.kick * Math.min(1, dt * w.recoilRecover)
    this.kickYaw -= this.kickYaw * Math.min(1, dt * w.recoilRecover)
    this.bloom = Math.max(0, this.bloom - dt * 0.12)
    if (this.rocketReloadUntil > 0 && time >= this.rocketReloadUntil) {
      this.rocketReloadUntil = 0
      if (this.rocketReserve > 0 && this.rocket === 0) {
        this.rocket = 1
        this.rocketReserve -= 1
        return true
      }
    }
    if (this.reloadUntil > 0 && time >= this.reloadUntil) {
      this.reloadUntil = 0
      if (this.weapon === 'pistol') {
        this.pmag = CONFIG.pistol.mag
        return true
      }
      const need = w.mag - this.mag
      const take = Math.max(0, Math.min(need, Math.floor(this.reserve)))
      this.mag += take
      this.reserve -= take
      return true
    }
    return false
  }

  startReload(time: number): boolean {
    if (this.weapon === 'launcher') return this.startRocketReload(time)
    if (this.reloading) return false
    if (this.weapon === 'pistol') {
      if (this.pmag >= CONFIG.pistol.mag) return false
      this.reloadUntil = time + CONFIG.pistol.reload
      return true
    }
    if (this.mag >= CONFIG.weapon.mag || this.reserve < 1) return false
    this.reloadUntil = time + CONFIG.weapon.reload
    return true
  }

  /** Current spread radius (radians). */
  spread(time: number): number {
    const w = CONFIG.weapon
    const hs = Math.hypot(this.vel.x, this.vel.z)
    let s = (this.weapon === 'pistol' ? CONFIG.pistol.spread : w.spread) + this.bloom
    if (this.mode === 'foot') {
      s += Math.min(1, hs / CONFIG.player.walk) * w.moveSpread * (this.crouch ? 0.5 : 1)
      if (!this.onGround && !this.wading) s += w.airSpread
    }
    s *= 1 - this.ads * 0.6
    if (this.crouch) s *= 0.75
    if (this.buff('steady', time)) s *= 0.4
    return s
  }

  applyRecoil(time: number): void {
    const w = CONFIG.weapon
    const r = this.weapon === 'pistol' ? CONFIG.pistol : w
    const m = this.buff('steady', time) ? 0.35 : 1
    const k = (1 - this.ads * 0.3) * m
    this.kick += r.recoilPitch * k
    this.kickYaw += (Math.random() - 0.5) * r.recoilYaw * 2 * k
    this.pitch = Math.min(1.5, this.pitch + r.recoilPitch * 0.35 * k)
    this.bloom = Math.min(w.bloomMax, this.bloom + r.bloomPerShot * m)
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z)
  }
  get bobPhase(): number {
    return this.stepTimer
  }
}

/** First-person rifle model, scaled down and kept close to the camera so it never clips walls. */
export class ViewModel {
  readonly group = new THREE.Group()
  private readonly gun = new THREE.Group()
  private readonly tube = new THREE.Group()
  private readonly pistol = new THREE.Group()
  private readonly pistolFlash: THREE.Sprite
  private readonly slide: THREE.Mesh
  private readonly lockLamp: THREE.MeshBasicMaterial
  private swapT = 0
  private shown: WeaponSlot = 'rifle'
  private readonly flash: THREE.Sprite
  private readonly mag: THREE.Mesh
  private flashT = 0
  private kickT = 0
  private swayX = 0
  private swayY = 0

  constructor() {
    const m = (c: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.55, ...o })
    const dark = m(0x23292f)
    const mid = m(0x46505a)
    const glow = new THREE.MeshBasicMaterial({ color: 0x3ff5d8, toneMapped: false })
    const glove = m(0x2d2a28, { metalness: 0.05, roughness: 0.9 })
    const sleeve = m(0x4a3a3a, { metalness: 0, roughness: 0.95 })
    const box = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      mesh.position.set(x, y, z)
      this.gun.add(mesh)
      return mesh
    }
    box(dark, 0.09, 0.12, 0.5, 0, 0, -0.05)
    box(mid, 0.08, 0.09, 0.34, 0, 0.005, -0.45)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.28, 8), dark)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.015, -0.74)
    this.gun.add(barrel)
    box(glow, 0.092, 0.012, 0.3, 0, 0.035, -0.42)
    this.mag = box(mid, 0.06, 0.18, 0.09, 0, -0.13, -0.08)
    this.mag.rotation.x = 0.18
    box(dark, 0.06, 0.13, 0.07, 0, -0.1, 0.12).rotation.x = -0.3
    box(dark, 0.07, 0.09, 0.22, 0, -0.01, 0.3)
    box(dark, 0.05, 0.05, 0.12, 0, 0.09, -0.08)
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3355, toneMapped: false }))
    dot.position.set(0, 0.1, -0.13)
    this.gun.add(dot)
    box(glove, 0.07, 0.07, 0.12, 0.0, -0.06, -0.42)
    box(sleeve, 0.09, 0.09, 0.35, 0.05, -0.1, -0.2).rotation.y = -0.4
    box(glove, 0.07, 0.08, 0.1, 0.01, -0.09, 0.1)
    box(sleeve, 0.1, 0.1, 0.3, 0.06, -0.14, 0.28)
    const tex = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const g = c.getContext('2d')!
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      grad.addColorStop(0, 'rgba(255,250,220,1)')
      grad.addColorStop(0.3, 'rgba(255,190,90,0.9)')
      grad.addColorStop(1, 'rgba(255,120,30,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 64)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })()
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
    this.flash.scale.setScalar(0.28)
    this.flash.position.set(0, 0.015, -0.92)
    this.flash.visible = false
    this.gun.add(this.flash)
    this.gun.traverse(o => {
      o.frustumCulled = false
    })
    this.group.add(this.gun)
    // Flyfish-2 shoulder launcher.
    const olive = m(0x56624a, { metalness: 0.2, roughness: 0.7 })
    const tubeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.05, 12), olive)
    tubeMesh.rotation.x = Math.PI / 2
    tubeMesh.position.set(0, 0.02, -0.2)
    this.tube.add(tubeMesh)
    for (const z of [-0.72, 0.33]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12), dark)
      ring.rotation.x = Math.PI / 2
      ring.position.set(0, 0.02, z)
      this.tube.add(ring)
    }
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.16), dark)
    sight.position.set(-0.1, 0.07, -0.25)
    this.tube.add(sight)
    this.lockLamp = new THREE.MeshBasicMaterial({ color: 0x3ff5d8, toneMapped: false })
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.05), this.lockLamp)
    lamp.position.set(-0.1, 0.115, -0.25)
    this.tube.add(lamp)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), dark)
    grip.position.set(0, -0.08, -0.35)
    this.tube.add(grip)
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.1), glove)
    hand.position.set(0, -0.12, -0.35)
    this.tube.add(hand)
    this.tube.traverse(o => {
      o.frustumCulled = false
    })
    this.tube.visible = false
    this.group.add(this.tube)
    // P-7 sidearm.
    const pbox = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      mesh.position.set(x, y, z)
      this.pistol.add(mesh)
      return mesh
    }
    this.slide = pbox(mid, 0.06, 0.06, 0.3, 0, 0.03, -0.26)
    pbox(dark, 0.055, 0.04, 0.26, 0, -0.015, -0.25)
    pbox(glow, 0.062, 0.01, 0.2, 0, 0.062, -0.26)
    pbox(dark, 0.05, 0.13, 0.065, 0, -0.08, -0.16).rotation.x = -0.25
    pbox(glove, 0.075, 0.09, 0.1, 0, -0.1, -0.15)
    pbox(sleeve, 0.09, 0.09, 0.26, 0.02, -0.13, -0.0).rotation.x = 0.25
    this.pistolFlash = new THREE.Sprite(this.flash.material)
    this.pistolFlash.scale.setScalar(0.2)
    this.pistolFlash.position.set(0, 0.03, -0.47)
    this.pistolFlash.visible = false
    this.pistol.add(this.pistolFlash)
    this.pistol.traverse(o => {
      o.frustumCulled = false
    })
    this.pistol.visible = false
    this.pistol.scale.setScalar(0.62)
    this.pistol.position.set(0.01, 0.02, -0.02)
    this.group.add(this.pistol)
    this.group.scale.setScalar(0.34)
  }

  /** Tint the launcher sight lamp: 0 = searching, 0..1 locking, 1 = locked. */
  setLock(k: number): void {
    this.lockLamp.color.setHex(k >= 1 ? 0xff3355 : k > 0 ? 0xffd35c : 0x3ff5d8)
  }
  fire(): void {
    this.flashT = 0.045
    this.kickT = 1
    this.flash.material.rotation = Math.random() * Math.PI
  }

  /** Muzzle position in world space (for tracers). */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    return (this.pistol.visible ? this.pistolFlash : this.flash).getWorldPosition(out)
  }

  update(dt: number, p: Player, lookDx: number, lookDy: number, time: number, visible: boolean): void {
    this.group.visible = visible
    if (!visible) return
    if (this.shown !== p.weapon) {
      this.shown = p.weapon
      this.swapT = 1
      this.gun.visible = p.weapon === 'rifle'
      this.tube.visible = p.weapon === 'launcher'
      this.pistol.visible = p.weapon === 'pistol'
    }
    this.swapT = Math.max(0, this.swapT - dt * 3)
    const ads = p.ads
    const speed = Math.min(1, p.speed / CONFIG.player.sprint)
    const bob = p.bobPhase * 1.6
    this.swayX += (-lookDx * 0.6 - this.swayX) * Math.min(1, dt * 10)
    this.swayY += (lookDy * 0.6 - this.swayY) * Math.min(1, dt * 10)
    const hip = new THREE.Vector3(0.1, -0.095, -0.2)
    const aim = new THREE.Vector3(0, -0.0335, -0.16)
    const pos = hip.lerp(aim, ads)
    const bobAmt = (p.onGround ? speed : 0) * (1 - ads * 0.85)
    pos.x += Math.sin(bob) * 0.008 * bobAmt + this.swayX * 0.02 * (1 - ads)
    pos.y += -Math.abs(Math.cos(bob)) * 0.008 * bobAmt + this.swayY * 0.02 * (1 - ads)
    this.kickT = Math.max(0, this.kickT - dt * 14)
    pos.z += this.kickT * 0.018
    let rx = this.kickT * 0.06
    let rz = 0
    if (p.sprinting) {
      pos.x += 0.02
      pos.y -= 0.02
      rx -= 0.25
      rz = 0.35
    }
    if (p.reloading && p.weapon !== 'launcher') {
      const k = 1 - Math.max(0, (p.reloadUntil - time) / (p.weapon === 'pistol' ? CONFIG.pistol.reload : CONFIG.weapon.reload))
      const dip = Math.sin(Math.min(1, k) * Math.PI)
      pos.y -= dip * 0.04
      rx -= dip * 0.5
      rz += dip * 0.5
      this.mag.position.y = -0.13 - (k > 0.2 && k < 0.6 ? 0.25 : 0)
    } else this.mag.position.y = -0.13
    if (p.weapon === 'launcher') {
      pos.set(0.12 - ads * 0.08, -0.06 + ads * 0.025, -0.16)
      if (p.rocketReloadUntil > 0) {
        const k = 1 - Math.max(0, (p.rocketReloadUntil - time) / CONFIG.launcher.reload)
        pos.y -= Math.sin(Math.min(1, k) * Math.PI) * 0.06
      }
    }
    if (p.weapon === 'pistol') {
      pos.x -= 0.02 * (1 - ads)
      pos.z += 0.03
      this.slide.position.z = -0.26 + this.kickT * 0.05
    }
    pos.y -= this.swapT * 0.08
    this.tube.rotation.x = this.gun.rotation.x * 0.5
    this.pistol.rotation.copy(this.gun.rotation)
    this.group.position.lerp(pos, Math.min(1, dt * 18))
    this.gun.rotation.x += (rx - this.gun.rotation.x) * Math.min(1, dt * 14)
    this.gun.rotation.z += (rz - this.gun.rotation.z) * Math.min(1, dt * 10)
    this.flashT -= dt
    this.flash.visible = this.flashT > 0 && this.gun.visible
    this.pistolFlash.visible = this.flashT > 0 && this.pistol.visible
  }
}
