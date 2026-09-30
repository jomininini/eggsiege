import * as THREE from 'three'
import type { Fx } from './fx'
import type { Shooter } from './units'

export type OrdKind = 'missile' | 'sam' | 'rocket'

/** Something a guided round can chase: returns its aim point, or null once it is gone. */
export type Seeker = { point(): THREE.Vector3 | null; ref: unknown }

export type Projectile = {
  kind: OrdKind
  mesh: THREE.Group
  pos: THREE.Vector3
  vel: THREE.Vector3
  speed: number
  turn: number
  owner: Shooter
  seeker: Seeker | null
  age: number
  life: number
  /** Splash radius / damage and the extra damage on a direct hit against hardware. */
  radius: number
  damage: number
  direct: number
  weapon: string
  gravity: number
  trailAt: number
  done: boolean
}

export type LaunchOpts = Omit<Projectile, 'mesh' | 'pos' | 'vel' | 'age' | 'trailAt' | 'done'> & { from: THREE.Vector3; dir: THREE.Vector3 }

/** Anything the flight code needs from the game: swept hit test and detonation. */
export interface OrdnanceHost {
  /** Nearest hit along the segment, or null. `direct` identifies hit hardware/units. */
  sweep(p: Projectile, from: THREE.Vector3, dir: THREE.Vector3, len: number): { t: number; direct: unknown; water: boolean } | null
  detonate(p: Projectile, at: THREE.Vector3, direct: unknown, water: boolean): void
}

const UP = new THREE.Vector3(0, 1, 0)
const tmpDir = new THREE.Vector3()
const tmpDes = new THREE.Vector3()

function buildMesh(kind: OrdKind): THREE.Group {
  const g = new THREE.Group()
  const len = kind === 'rocket' ? 1.5 : kind === 'sam' ? 1.3 : 0.95
  const r = kind === 'rocket' ? 0.13 : kind === 'sam' ? 0.11 : 0.085
  const bodyMat = new THREE.MeshStandardMaterial({ color: kind === 'rocket' ? 0x5b6650 : 0xe8ecef, roughness: 0.5, metalness: 0.4 })
  const tipMat = new THREE.MeshStandardMaterial({ color: kind === 'sam' ? 0x3fa9ff : 0xd8413a, roughness: 0.5 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), bodyMat)
  g.add(body)
  const tip = new THREE.Mesh(new THREE.ConeGeometry(r, r * 3, 8), tipMat)
  tip.position.y = len / 2 + r * 1.5
  g.add(tip)
  for (let i = 0; i < 4; i += 1) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, r * 3, r * 2.4), bodyMat)
    fin.position.y = -len / 2 + r
    fin.rotation.y = (i * Math.PI) / 2
    fin.translateZ(r)
    g.add(fin)
  }
  const flame = new THREE.Mesh(new THREE.SphereGeometry(r * 1.8, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb35c).multiplyScalar(2.5), toneMapped: false }))
  flame.position.y = -len / 2 - r
  flame.scale.set(1, 2.2, 1)
  g.add(flame)
  return g
}

/** Guided missiles, SAMs and artillery rockets in flight. */
export class Ordnance {
  readonly list: Projectile[] = []

  constructor(private readonly scene: THREE.Scene, private readonly fx: Fx) {}

  launch(o: LaunchOpts): Projectile {
    const mesh = buildMesh(o.kind)
    const pos = o.from.clone()
    mesh.position.copy(pos)
    this.scene.add(mesh)
    const vel = o.dir.clone().normalize().multiplyScalar(o.speed)
    const p: Projectile = { ...o, mesh, pos, vel, age: 0, trailAt: 0, done: false }
    this.orient(p)
    this.list.push(p)
    return p
  }

  clear(): void {
    for (const p of this.list) this.scene.remove(p.mesh)
    this.list.length = 0
  }

  private orient(p: Projectile): void {
    tmpDir.copy(p.vel).normalize()
    p.mesh.quaternion.setFromUnitVectors(UP, tmpDir)
  }

  step(dt: number, host: OrdnanceHost): void {
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const p = this.list[i]
      p.age += dt
      if (p.seeker && p.age > 0.12) {
        const tp = p.seeker.point()
        if (!tp) p.seeker = null
        else {
          tmpDes.copy(tp).sub(p.pos)
          const dist = tmpDes.length()
          tmpDes.normalize()
          tmpDir.copy(p.vel).normalize()
          const ang = tmpDir.angleTo(tmpDes)
          const maxA = p.turn * dt
          if (ang > 1e-4) tmpDir.lerp(tmpDes, Math.min(1, maxA / ang)).normalize()
          p.vel.copy(tmpDir).multiplyScalar(p.speed)
          // Proximity fuse.
          if (dist < 2.6) {
            this.explode(i, host, p.pos.clone(), p.seeker.ref, false)
            continue
          }
        }
      }
      if (p.gravity) p.vel.y += p.gravity * dt
      const len = p.vel.length() * dt
      tmpDir.copy(p.vel).normalize()
      const hit = host.sweep(p, p.pos, tmpDir, len)
      if (hit) {
        const at = p.pos.clone().addScaledVector(tmpDir, hit.t)
        this.explode(i, host, at, hit.direct, hit.water)
        continue
      }
      p.pos.addScaledVector(p.vel, dt)
      p.mesh.position.copy(p.pos)
      this.orient(p)
      if (p.age >= p.trailAt) {
        p.trailAt = p.age + (p.kind === 'rocket' ? 0.03 : 0.025)
        this.fx.puff(p.pos.clone().addScaledVector(tmpDir, -0.8), p.kind === 'rocket' ? 0.55 : 0.4, 1.1, 0xd9dcdf, 1.8, 0.3)
      }
      if (p.age >= p.life) this.explode(i, host, p.pos.clone(), null, false)
    }
  }

  private explode(i: number, host: OrdnanceHost, at: THREE.Vector3, direct: unknown, water: boolean): void {
    const p = this.list[i]
    this.list.splice(i, 1)
    this.scene.remove(p.mesh)
    p.done = true
    host.detonate(p, at, direct, water)
  }
}
