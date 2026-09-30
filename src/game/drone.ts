import * as THREE from 'three'
import { CONFIG } from './config'
import { DRONE_PADS, LAND, SEA } from './map'
import type { Unit } from './units'

function quadcopter(): THREE.Group {
  const g = new THREE.Group()
  const dark = new THREE.MeshStandardMaterial({ color: 0x20262c, roughness: 0.5, metalness: 0.4 })
  const glow = new THREE.MeshBasicMaterial({ color: 0x7ef9ff, toneMapped: false })
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
