import type { Box } from './collide'
import { LAND } from './map'

/** Ground-level navigation grid for bots: A* over 1.5 m cells, blocked by building footprints. */
export type P2 = { x: number; z: number }

export class NavGrid {
  readonly cell = 1.5
  readonly minX = LAND.minX + 1
  readonly minZ = LAND.minZ + 1
  readonly w: number
  readonly h: number
  readonly blocked: Uint8Array
  private g: Float32Array
  private f: Float32Array
  private from: Int32Array
  private stamp: Uint32Array
  private closed: Uint32Array
  private run = 1

  constructor(boxes: Box[], inflate = 0.75) {
    this.w = Math.floor((LAND.maxX - 1 - this.minX) / this.cell)
    this.h = Math.floor((LAND.maxZ - 1 - this.minZ) / this.cell)
    const n = this.w * this.h
    this.blocked = new Uint8Array(n)
    this.g = new Float32Array(n)
    this.f = new Float32Array(n)
    this.from = new Int32Array(n)
    this.stamp = new Uint32Array(n)
    this.closed = new Uint32Array(n)
    for (const b of boxes) {
      if (b.minY > 1.7 || b.maxY < 0.45) continue
      const x0 = Math.max(0, Math.floor((b.minX - inflate - this.minX) / this.cell))
      const x1 = Math.min(this.w - 1, Math.floor((b.maxX + inflate - this.minX) / this.cell))
      const z0 = Math.max(0, Math.floor((b.minZ - inflate - this.minZ) / this.cell))
      const z1 = Math.min(this.h - 1, Math.floor((b.maxZ + inflate - this.minZ) / this.cell))
      for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) {
        const cx = this.minX + (x + 0.5) * this.cell, cz = this.minZ + (z + 0.5) * this.cell
        if (cx > b.minX - inflate && cx < b.maxX + inflate && cz > b.minZ - inflate && cz < b.maxZ + inflate) this.blocked[z * this.w + x] = 1
      }
    }
  }

  toCell(x: number, z: number): number {
    const cx = Math.max(0, Math.min(this.w - 1, Math.floor((x - this.minX) / this.cell)))
    const cz = Math.max(0, Math.min(this.h - 1, Math.floor((z - this.minZ) / this.cell)))
    return cz * this.w + cx
  }
  center(i: number): P2 {
    return { x: this.minX + ((i % this.w) + 0.5) * this.cell, z: this.minZ + (Math.floor(i / this.w) + 0.5) * this.cell }
  }
  isFree(x: number, z: number): boolean {
    return this.blocked[this.toCell(x, z)] === 0
  }

  /** Nearest free cell by expanding rings. */
  nearestFree(i: number): number {
    if (!this.blocked[i]) return i
    const cx = i % this.w, cz = Math.floor(i / this.w)
    for (let r = 1; r < 12; r += 1) {
      for (let dz = -r; dz <= r; dz += 1) for (let dx = -r; dx <= r; dx += 1) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue
        const x = cx + dx, z = cz + dz
        if (x < 0 || z < 0 || x >= this.w || z >= this.h) continue
        const j = z * this.w + x
        if (!this.blocked[j]) return j
      }
    }
    return i
  }

  /** Straight walkable line between two world points (grid sampled). */
  clear(a: P2, b: P2): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.ceil(d / (this.cell * 0.5))
    for (let i = 1; i < n; i += 1) {
      const t = i / n
      if (this.blocked[this.toCell(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)]) return false
    }
    return true
  }

  findPath(sx: number, sz: number, tx: number, tz: number): P2[] {
    const start = this.nearestFree(this.toCell(sx, sz))
    const goal = this.nearestFree(this.toCell(tx, tz))
    const end = this.center(goal)
    if (this.clear({ x: sx, z: sz }, end)) return [end]
    const run = (this.run += 1)
    const heap = new Heap(this.f)
    const gx = goal % this.w, gz = Math.floor(goal / this.w)
    const h = (i: number) => {
      const dx = Math.abs((i % this.w) - gx), dz = Math.abs(Math.floor(i / this.w) - gz)
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)) * 1.02
    }
    this.stamp[start] = run
    this.g[start] = 0
    this.f[start] = h(start)
    this.from[start] = -1
    heap.push(start)
    let found = false
    let iterations = 0
    while (heap.size && iterations < 20000) {
      iterations += 1
      const cur = heap.pop()
      if (cur === goal) {
        found = true
        break
      }
      if (this.closed[cur] === run) continue
      this.closed[cur] = run
      const cx = cur % this.w, cz = Math.floor(cur / this.w)
      for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dz) continue
        const x = cx + dx, z = cz + dz
        if (x < 0 || z < 0 || x >= this.w || z >= this.h) continue
        const j = z * this.w + x
        if (this.blocked[j] || this.closed[j] === run) continue
        if (dx && dz && (this.blocked[cz * this.w + x] || this.blocked[z * this.w + cx])) continue
        const ng = this.g[cur] + (dx && dz ? Math.SQRT2 : 1)
        if (this.stamp[j] !== run || ng < this.g[j]) {
          this.stamp[j] = run
          this.g[j] = ng
          this.f[j] = ng + h(j)
          this.from[j] = cur
          heap.push(j)
        }
      }
    }
    if (!found) return [end]
    const cells: number[] = []
    for (let c = goal; c !== -1; c = this.from[c]) cells.push(c)
    cells.reverse()
    // String-pull: keep only corners needed to stay walkable.
    const pts = cells.map(c => this.center(c))
    const out: P2[] = []
    let anchor: P2 = { x: sx, z: sz }
    let i = 0
    while (i < pts.length - 1) {
      let j = pts.length - 1
      while (j > i + 1 && !this.clear(anchor, pts[j])) j -= 1
      out.push(pts[j])
      anchor = pts[j]
      i = j
    }
    if (!out.length) out.push(end)
    return out
  }
}

class Heap {
  private items: number[] = []
  constructor(private readonly score: Float32Array) {}
  get size(): number {
    return this.items.length
  }
  push(v: number): void {
    const a = this.items
    a.push(v)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.score[a[p]] <= this.score[a[i]]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): number {
    const a = this.items
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1, r = l + 1
        let m = i
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}
