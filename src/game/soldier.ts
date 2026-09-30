import * as THREE from 'three'
import { TEAM_COLORS } from './config'

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  head: new THREE.IcosahedronGeometry(0.2, 1),
}
const matCache = new Map<string, THREE.Material>()
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key)
  if (!m) matCache.set(key, (m = make()))
  return m
}

function part(geo: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m)
  mesh.scale.set(sx, sy, sz)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  return mesh
}

/** Procedural low-poly soldier: team-coloured armour, glowing visor, rifle. Faces +Z. */
export class SoldierMesh {
  readonly root = new THREE.Group()
  private readonly body = new THREE.Group()
  private readonly legL = new THREE.Group()
  private readonly legR = new THREE.Group()
  private readonly arms = new THREE.Group()
  private phase = Math.random() * 10
  private deathT = 0

  constructor(team: number) {
    this.root.rotation.order = 'YXZ'
    const color = TEAM_COLORS[team]
    const fabric = mat(`fab${team}`, () => new THREE.MeshStandardMaterial({ color: team === 0 ? 0x4a3a3a : 0x34404e, roughness: 0.9 }))
    const armor = mat(`arm${team}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, emissive: color, emissiveIntensity: 0.18 }))
    const dark = mat('dark', () => new THREE.MeshStandardMaterial({ color: 0x1d232a, roughness: 0.6, metalness: 0.4 }))
    const visor = mat(`vis${team}`, () => new THREE.MeshBasicMaterial({ color: team === 0 ? 0xffb35c : 0x7ef9ff, toneMapped: false }))
    const skin = mat('skin', () => new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6 }))
    for (const [leg, x] of [[this.legL, -0.14], [this.legR, 0.14]] as const) {
      leg.position.set(x, 0.9, 0)
      leg.add(part(G.box, fabric, 0.2, 0.5, 0.22, 0, -0.25, 0))
      leg.add(part(G.box, dark, 0.2, 0.42, 0.22, 0, -0.66, 0.02))
      leg.add(part(G.box, dark, 0.22, 0.1, 0.32, 0, -0.86, 0.06))
    }
    this.body.position.y = 0.9
    this.body.add(part(G.box, fabric, 0.46, 0.56, 0.28, 0, 0.3, 0))
    this.body.add(part(G.box, armor, 0.5, 0.36, 0.34, 0, 0.36, 0.02))
    this.body.add(part(G.box, dark, 0.34, 0.3, 0.14, 0, 0.36, -0.2))
    const head = part(G.head, skin, 1, 1.05, 1, 0, 0.78, 0)
    this.body.add(head)
    this.body.add(part(G.box, armor, 0.44, 0.16, 0.44, 0, 0.9, 0))
    this.body.add(part(G.box, visor, 0.3, 0.07, 0.05, 0, 0.8, 0.19))
    this.arms.position.set(0, 0.52, 0.05)
    this.arms.add(part(G.box, fabric, 0.14, 0.14, 0.5, -0.26, 0, 0.2))
    this.arms.add(part(G.box, fabric, 0.14, 0.14, 0.45, 0.22, -0.02, 0.24))
    this.arms.add(part(G.box, dark, 0.09, 0.14, 0.9, 0.05, 0.04, 0.46))
    this.arms.add(part(G.box, armor, 0.1, 0.05, 0.3, 0.05, 0.13, 0.4))
    this.body.add(this.arms)
    this.root.add(this.legL, this.legR, this.body)
  }

  /** speed in m/s; pitch = aim pitch; dead grows 0 → 1 while falling. */
  animate(dt: number, speed: number, pitch: number, dead: boolean, crouch = false): void {
    if (dead) {
      this.deathT = Math.min(1, this.deathT + dt * 2.5)
      const k = 1 - (1 - this.deathT) ** 2
      this.root.rotation.x = -k * 1.45
      this.root.position.y = -k * 0.2
      return
    }
    if (this.deathT) {
      this.deathT = 0
      this.root.rotation.x = 0
      this.root.position.y = 0
    }
    this.phase += dt * Math.min(speed, 10) * 1.6
    const swing = Math.min(speed / 5, 1) * 0.7
    this.legL.rotation.x = Math.sin(this.phase) * swing
    this.legR.rotation.x = -Math.sin(this.phase) * swing
    this.body.position.y = (crouch ? 0.55 : 0.9) + Math.abs(Math.cos(this.phase)) * 0.04 * swing
    this.legL.position.y = this.legR.position.y = crouch ? 0.6 : 0.9
    this.legL.scale.y = this.legR.scale.y = crouch ? 0.66 : 1
    this.arms.rotation.x = -pitch
  }
}
