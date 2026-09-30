import * as THREE from 'three'
import { CONFIG, TEAM_COLORS } from './config'
import { BASES, DRONE_PADS, LAND, SEA } from './map'
import type { Unit } from './units'

export function quadcopter(led = 0x7ef9ff): THREE.Group {
  const g = new THREE.Group()
  const dark = new THREE.MeshStandardMaterial({ color: 0x20262c, roughness: 0.5, metalness: 0.4 })
  const glow = new THREE.MeshBasicMaterial({ color: led, toneMapped: false })
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.6), dark)
  g.add(body)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glow)
  eye.position.set(0, -0.08, 0.3)
  g.add(eye)
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]] as const) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.7), dark)
    arm.position.set(x / 2, 0, z / 2)
    arm.rotation.y = Math.atan2(x, z)
    g.add(arm)
    const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 12), new THREE.MeshBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.45 }))
    prop.position.set(x, 0.08, z)
    prop.name = 'prop'
    g.add(prop)
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), glow)
    led.position.set(x, -0.04, z)
    g.add(led)
  }
  g.traverse(o => ((o as THREE.Mesh).castShadow = true))
  g.scale.setScalar(1.3)
  return g
}

/** Rooftop reconnaissance drone. Parked models sit on each pad; the active one flies high above the map. */
export class Drone {
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  active = false
  pad = 0
  endsAt = 0
  readyAt = 0
  yaw = 0
  marked = 0
  hp: number = CONFIG.drone.hp
  readonly team = 0
  private nextScan = 0
  private readonly parked: THREE.Group[] = []
  private readonly flyer: THREE.Group

  constructor(scene: THREE.Scene) {
    for (const p of DRONE_PADS) {
      const q = quadcopter()
      q.position.set(p.x, p.y + 0.25, p.z)
      scene.add(q)
      this.parked.push(q)
    }
    this.flyer = quadcopter()
    this.flyer.visible = false
    scene.add(this.flyer)
  }

  launch(pad: number, time: number, yaw: number): void {
    const p = DRONE_PADS[pad]
    this.pad = pad
    this.active = true
    this.endsAt = time + CONFIG.drone.duration
    this.pos.set(p.x, p.y + 0.3, p.z)
    this.prev.copy(this.pos)
    this.yaw = yaw
    this.marked = 0
    this.hp = CONFIG.drone.hp
    this.parked[pad].visible = false
    this.flyer.visible = true
  }

  land(time: number): void {
    this.active = false
    this.readyAt = time + CONFIG.drone.cooldown
    for (const q of this.parked) q.visible = true
    this.flyer.visible = false
  }

  /** move: x = right, y = forward relative to the drone camera yaw. */
  step(dt: number, move: { x: number; y: number }, boost: boolean, time: number, enemies: Unit[]): void {
    this.prev.copy(this.pos)
    const cfg = CONFIG.drone
    const targetY = cfg.height
    this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 1.5)
    const sp = cfg.speed * (boost ? 1.6 : 1)
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw)
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw)
    this.pos.x += (fx * move.y + rx * move.x) * sp * dt
    this.pos.z += (fz * move.y + rz * move.x) * sp * dt
    this.pos.x = Math.max(LAND.minX - 10, Math.min(LAND.maxX + 10, this.pos.x))
    this.pos.z = Math.max(SEA.minZ + 30, Math.min(LAND.maxZ + 5, this.pos.z))
    if (time >= this.nextScan) {
      this.nextScan = time + 0.25
      for (const u of enemies) {
        if (!u.alive) continue
        if (Math.hypot(u.pos.x - this.pos.x, u.pos.z - this.pos.z) < cfg.markRadius) {
          if (u.spottedUntil < time + 1) this.marked += 1
          u.spottedUntil = Math.max(u.spottedUntil, time + cfg.markTime)
        }
      }
    }
  }

  render(alpha: number, dt: number, t: number): void {
    for (const q of [...this.parked, this.flyer]) {
      q.children.forEach(c => {
        if (c.name === 'prop') c.rotation.y += dt * (q === this.flyer ? 60 : 0)
      })
    }
    if (this.active) {
      this.flyer.position.lerpVectors(this.prev, this.pos, alpha)
      this.flyer.position.y += Math.sin(t * 3) * 0.1
      this.flyer.rotation.y = this.yaw
    }
  }
}

/**
 * AI reconnaissance drone: each team periodically launches one from its base; it orbits a contested
 * point at altitude and marks enemies. It can be shot down by rifles, missiles and the island AA.
 */
export class ScoutDrone {
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  active = false
  hp = 0
  nextAt: number = CONFIG.scout.first
  until = 0
  cx = 0
  cz = 0
  private ang = Math.random() * 6
  private arrived = false
  private nextScan = 0
  readonly mesh: THREE.Group
  constructor(readonly team: number, scene: THREE.Scene) {
    this.mesh = quadcopter(TEAM_COLORS[team])
    this.mesh.scale.setScalar(1.8)
    this.mesh.visible = false
    scene.add(this.mesh)
  }
  get center(): THREE.Vector3 {
    return this.pos
  }
  reset(): void {
    this.active = false
    this.mesh.visible = false
    this.nextAt = CONFIG.scout.first + this.team * 12
  }
  launch(t: number, x: number, z: number): void {
    const b = BASES[this.team]
    this.active = true
    this.arrived = false
    this.hp = CONFIG.scout.hp
    this.until = t + CONFIG.scout.duration + 8
    this.cx = x
    this.cz = z
    this.pos.set(b.x, 6, b.z)
    this.prev.copy(this.pos)
    this.mesh.visible = true
  }
  down(t: number): void {
    this.active = false
    this.mesh.visible = false
    this.nextAt = t + CONFIG.scout.interval
  }
  /** Returns true once when it arrives over its target. */
  step(dt: number, t: number, enemies: { pos: THREE.Vector3; alive: boolean; spottedUntil: number }[], mark: boolean): boolean {
    this.prev.copy(this.pos)
    if (!this.active) return false
    if (t >= this.until) {
      this.down(t)
      return false
    }
    const cfg = CONFIG.scout
    let arrivedNow = false
    let tx: number, tz: number
    if (!this.arrived) {
      tx = this.cx
      tz = this.cz
      if (Math.hypot(this.pos.x - tx, this.pos.z - tz) < cfg.radius + 2) {
        this.arrived = true
        arrivedNow = true
      }
    } else {
      this.ang += dt * 0.35
      tx = this.cx + Math.cos(this.ang) * cfg.radius
      tz = this.cz + Math.sin(this.ang) * cfg.radius
    }
    const dx = tx - this.pos.x, dz = tz - this.pos.z
    const d = Math.hypot(dx, dz) || 1
    const sp = Math.min(22, d * 3)
    this.pos.x += (dx / d) * sp * dt
    this.pos.z += (dz / d) * sp * dt
    this.pos.y += (cfg.height - this.pos.y) * Math.min(1, dt * 0.8)
    if (mark && this.arrived && t >= this.nextScan) {
      this.nextScan = t + 0.5
      for (const u of enemies) {
        if (!u.alive) continue
        if (Math.hypot(u.pos.x - this.pos.x, u.pos.z - this.pos.z) < cfg.markRadius) u.spottedUntil = Math.max(u.spottedUntil, t + 4)
      }
    }
    return arrivedNow
  }
  render(alpha: number, dt: number, t: number): void {
    if (!this.active) return
    this.mesh.position.lerpVectors(this.prev, this.pos, alpha)
    this.mesh.position.y += Math.sin(t * 2.4 + this.team) * 0.2
    this.mesh.rotation.y = this.ang + Math.PI / 2
    this.mesh.children.forEach(c => {
      if (c.name === 'prop') c.rotation.y += dt * 60
    })
  }
}
