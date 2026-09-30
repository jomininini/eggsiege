import { baseGround, inIsland, ISLAND, isWater, WATER_Y } from './map'

/**
 * Lightweight static collision: every solid is an axis-aligned box. Characters are vertical
 * cylinders that step up small ledges; bullets and line-of-sight are rays against the boxes plus
 * the ground/water plane. Brute force is fine at this map size (a few hundred boxes).
 */
export type Box = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; tag?: string }
export type RayHit = { t: number; nx: number; ny: number; nz: number; water: boolean }
export type Vec3 = { x: number; y: number; z: number }

const CELL = 10

export class Collision {
  readonly boxes: Box[] = []
  private cells = new Map<number, Box[]>()

  add(box: Box): Box {
    this.boxes.push(box)
    const x0 = Math.floor(box.minX / CELL), x1 = Math.floor(box.maxX / CELL)
    const z0 = Math.floor(box.minZ / CELL), z1 = Math.floor(box.maxZ / CELL)
    for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) {
      const k = key(x, z)
      let list = this.cells.get(k)
      if (!list) this.cells.set(k, (list = []))
      list.push(box)
    }
    return box
  }

  /** Boxes whose footprint may touch the square around (x, z). */
  near(x: number, z: number, r: number, out: Box[] = []): Box[] {
    out.length = 0
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL)
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL)
    for (let cx = x0; cx <= x1; cx += 1) for (let cz = z0; cz <= z1; cz += 1) {
      const list = this.cells.get(key(cx, cz))
      if (!list) continue
      for (const b of list) if (!out.includes(b)) out.push(b)
    }
    return out
  }

  /** Highest standable surface under a circle, no higher than `maxTop`. */
  groundAt(x: number, z: number, r: number, maxTop: number): number {
    let g = baseGround(x, z)
    const rr = r * 0.7
    for (const b of this.near(x, z, r, scratch)) {
      if (b.maxY > maxTop || b.maxY <= g) continue
      if (x + rr > b.minX && x - rr < b.maxX && z + rr > b.minZ && z - rr < b.maxZ) g = b.maxY
    }
    return g
  }

  /** Push a vertical cylinder out of boxes it overlaps between `feet + step` and `feet + height`. */
  pushOut(p: Vec3, r: number, height: number, step: number): boolean {
    let hit = false
    for (let iter = 0; iter < 2; iter += 1) {
      for (const b of this.near(p.x, p.z, r + 1, scratch)) {
        if (b.maxY <= p.y + step || b.minY >= p.y + height) continue
        const cx = Math.max(b.minX, Math.min(p.x, b.maxX))
        const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ))
        let dx = p.x - cx, dz = p.z - cz
        const d2 = dx * dx + dz * dz
        if (d2 >= r * r) continue
        hit = true
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2)
          p.x = cx + (dx / d) * r
          p.z = cz + (dz / d) * r
        } else {
          // Centre inside the box: leave through the nearest face.
          const exits = [p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z]
          const m = exits.indexOf(Math.min(...exits))
          if (m === 0) p.x = b.minX - r
          else if (m === 1) p.x = b.maxX + r
          else if (m === 2) p.z = b.minZ - r
          else p.z = b.maxZ + r
          dx = dz = 0
        }
      }
    }
    return hit
  }

  /** Lowest box underside above `fromY` over the circle (for head bumps). */
  ceilingAt(x: number, z: number, r: number, fromY: number): number {
    let c = Infinity
    const rr = r * 0.7
    for (const b of this.near(x, z, r, scratch)) {
      if (b.minY < fromY - 0.01 || b.minY >= c) continue
      if (x + rr > b.minX && x - rr < b.maxX && z + rr > b.minZ && z - rr < b.maxZ) c = b.minY
    }
    return c
  }

  /** Ray against boxes and the ground/water plane. `d` must be normalised. */
  raycast(o: Vec3, d: Vec3, maxDist: number): RayHit | null {
    let best: RayHit | null = null
    let tMax = maxDist
    for (const b of this.boxes) {
      const hit = rayBox(o, d, b, tMax)
      if (hit) {
        tMax = hit.t
        best = hit
      }
    }
    // Ground plane: y = 0 on land (island top slightly higher), water surface elsewhere.
    if (d.y < -1e-6) {
      const tLand = (0 - o.y) / d.y
      if (tLand > 0 && tLand < tMax) {
        const x = o.x + d.x * tLand, z = o.z + d.z * tLand
        if (!isWater(x, z)) {
          const tl = inIsland(x, z) ? (ISLAND.y - o.y) / d.y : tLand
          tMax = Math.max(0, tl)
          best = { t: tMax, nx: 0, ny: 1, nz: 0, water: false }
        }
      }
      const tWater = (WATER_Y - o.y) / d.y
      if (tWater > 0 && tWater < tMax) {
        const x = o.x + d.x * tWater, z = o.z + d.z * tWater
        if (isWater(x, z)) best = { t: tWater, nx: 0, ny: 1, nz: 0, water: true }
      }
    }
    return best
  }

  /** Clear straight line between two points? */
  lineOfSight(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-4) return true
    const d = { x: dx / len, y: dy / len, z: dz / len }
    for (const box of this.boxes) if (rayBox(a, d, box, len - 0.05)) return false
    return true
  }
}

const scratch: Box[] = []
const key = (x: number, z: number) => (x + 1000) * 4096 + (z + 1000)

export function rayBox(o: Vec3, d: Vec3, b: Box, tMax: number): RayHit | null {
  let t0 = 0, t1 = tMax
  let axis = -1, sign = 0
  const test = (oo: number, dd: number, mn: number, mx: number, ax: number): boolean => {
    if (Math.abs(dd) < 1e-9) return oo >= mn && oo <= mx
    let ta = (mn - oo) / dd, tb = (mx - oo) / dd
    let s = -1
    if (ta > tb) {
      const tmp = ta; ta = tb; tb = tmp
      s = 1
    }
    if (ta > t0) {
      t0 = ta
      axis = ax
      sign = s
    }
    if (tb < t1) t1 = tb
    return t0 <= t1
  }
  if (!test(o.x, d.x, b.minX, b.maxX, 0)) return null
  if (!test(o.y, d.y, b.minY, b.maxY, 1)) return null
  if (!test(o.z, d.z, b.minZ, b.maxZ, 2)) return null
  if (axis < 0) return null // origin inside the box
  return { t: t0, nx: axis === 0 ? sign : 0, ny: axis === 1 ? sign : 0, nz: axis === 2 ? sign : 0, water: false }
}

/** Ray vs sphere; returns distance or -1. `d` normalised. */
export function raySphere(o: Vec3, d: Vec3, cx: number, cy: number, cz: number, r: number): number {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz
  const b = ox * d.x + oy * d.y + oz * d.z
  const c = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - c
  if (disc < 0) return -1
  const t = -b - Math.sqrt(disc)
  return t >= 0 ? t : -1
}
