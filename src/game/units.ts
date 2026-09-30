import * as THREE from 'three'
import { raySphere, type Vec3 } from './collide'

/** Anything that can be shot and belongs to a team. The player and bots implement it. */
export interface Unit {
  id: number
  team: number
  name: string
  isPlayer: boolean
  /** Feet position. */
  pos: THREE.Vector3
  hp: number
  maxHp: number
  shield: number
  alive: boolean
  crouch: boolean
  /** Time until which enemies see this unit through walls (drone/scan marks). */
  spottedUntil: number
  /** Not directly shootable (inside a vehicle/helicopter: hits go to the vehicle instead). */
  sheltered: boolean
  spawnShieldUntil: number
  kills: number
  deaths: number
  captures: number
  lastHurt: number
  lastAttacker: Unit | null
}

export type Shooter = { team: number; name: string; unit?: Unit }

export function unitHeight(u: Unit): number {
  return u.crouch ? 1.2 : 1.75
}

/** Returns hit distance and whether it was the head, or null. */
export function rayUnit(o: Vec3, d: Vec3, u: Unit, maxT: number): { t: number; head: boolean } | null {
  if (!u.alive || u.sheltered) return null
  const h = unitHeight(u)
  // Broad phase.
  const bt = raySphere(o, d, u.pos.x, u.pos.y + h * 0.5, u.pos.z, h * 0.62)
  if (bt < 0 || bt > maxT) return null
  const head = raySphere(o, d, u.pos.x, u.pos.y + h - 0.2, u.pos.z, 0.23)
  const chest = raySphere(o, d, u.pos.x, u.pos.y + h * 0.68, u.pos.z, 0.36)
  const hips = raySphere(o, d, u.pos.x, u.pos.y + h * 0.4, u.pos.z, 0.34)
  const legs = raySphere(o, d, u.pos.x, u.pos.y + h * 0.16, u.pos.z, 0.3)
  let best = -1
  let isHead = false
  for (const [t, hd] of [[head, true], [chest, false], [hips, false], [legs, false]] as const) {
    if (t >= 0 && t <= maxT && (best < 0 || t < best)) {
      best = t
      isHead = hd
    }
  }
  return best < 0 ? null : { t: best, head: isHead }
}

export function chest(u: Unit, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(u.pos.x, u.pos.y + unitHeight(u) * 0.66, u.pos.z)
}
