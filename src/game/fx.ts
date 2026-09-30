import * as THREE from 'three'

type Tracer = { mesh: THREE.Mesh; life: number }
type Spark = { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; color: THREE.Color; size: number; gravity: number }
type Puff = { sprite: THREE.Sprite; v: THREE.Vector3; life: number; max: number; grow: number }
type Blast = { mesh: THREE.Mesh; life: number; max: number; size: number }

const MAX_SPARKS = 500
const up = new THREE.Vector3(0, 1, 0)

function smokeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Pooled, purely visual effects. Update from render(). */
export class Fx {
  private tracers: Tracer[] = []
  private sparks: Spark[] = []
  private sparkMesh: THREE.InstancedMesh
  private puffs: Puff[] = []
  private blasts: Blast[] = []
  private smokeTex = smokeTexture()
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private s = new THREE.Vector3()
  shake = 0

  constructor(private readonly scene: THREE.Scene) {
    const tracerGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 4, 1, true)
    tracerGeo.translate(0, 0.5, 0)
    for (let i = 0; i < 90; i += 1) {
      const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
      mesh.visible = false
      mesh.frustumCulled = false
      scene.add(mesh)
      this.tracers.push({ mesh, life: 0 })
    }
    this.sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX_SPARKS)
    this.sparkMesh.count = 0
    this.sparkMesh.frustumCulled = false
    this.sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3)
    scene.add(this.sparkMesh)
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe2a0): void {
    const t = this.tracers.find(tr => tr.life <= 0) ?? this.tracers[0]
    const d = to.clone().sub(from)
    const len = d.length()
    if (len < 0.5) return
    t.mesh.position.copy(from)
    t.mesh.quaternion.setFromUnitVectors(up, d.divideScalar(len))
    t.mesh.scale.set(1, len, 1)
    ;(t.mesh.material as THREE.MeshBasicMaterial).color.setHex(color)
    t.mesh.visible = true
    t.life = 0.07
  }

  burst(at: THREE.Vector3, count: number, color: number, speed = 4, size = 0.06, life = 0.35, gravity = -12, normal?: THREE.Vector3): void {
    const col = new THREE.Color(color)
    for (let i = 0; i < count; i += 1) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift()
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8))
      if (normal) v.addScaledVector(normal, speed * 0.6)
      const max = life * (0.6 + Math.random() * 0.6)
      this.sparks.push({ p: at.clone(), v, life: max, max, color: col, size: size * (0.6 + Math.random() * 0.8), gravity })
    }
  }

  impact(at: THREE.Vector3, normal: THREE.Vector3, water: boolean): void {
    if (water) {
      this.burst(at, 8, 0xdff6ff, 3.5, 0.08, 0.5, -10, up)
      return
    }
    this.burst(at, 6, 0xffd08a, 5, 0.04, 0.22, -14, normal)
    this.puff(at, 0.35, 0.5, 0x9a9a92, 0.6)
  }

  blood(at: THREE.Vector3): void {
    this.burst(at, 7, 0xd83a3a, 3, 0.07, 0.4, -9)
  }

  puff(at: THREE.Vector3, size: number, life: number, color: number, grow = 1.2, rise = 0.6): void {
    let p = this.puffs.find(pp => pp.life <= 0)
    if (!p) {
      if (this.puffs.length >= 90) return
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false }))
      this.scene.add(sprite)
      p = { sprite, v: new THREE.Vector3(), life: 0, max: 1, grow: 1 }
      this.puffs.push(p)
    }
    p.sprite.position.copy(at)
    p.sprite.scale.setScalar(size)
    ;(p.sprite.material as THREE.SpriteMaterial).color.setHex(color)
    p.sprite.visible = true
    p.v.set((Math.random() - 0.5) * 0.6, rise, (Math.random() - 0.5) * 0.6)
    p.life = p.max = life
    p.grow = grow
  }

  explosion(at: THREE.Vector3, size = 1): void {
    let b = this.blasts.find(bb => bb.life <= 0)
    if (!b) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
      this.scene.add(mesh)
      b = { mesh, life: 0, max: 1, size: 1 }
      this.blasts.push(b)
    }
    b.mesh.position.copy(at)
    b.mesh.visible = true
    b.life = b.max = 0.45
    b.size = 5 * size
    this.burst(at, 40, 0xffc060, 14 * size, 0.12, 0.8, -12)
    this.burst(at, 20, 0x3a3a3a, 8 * size, 0.2, 1.2, -6)
    for (let i = 0; i < 6; i += 1) this.puff(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), 3 * size, 2.2, 0x55524d, 2.2, 1.6)
    this.shake = Math.max(this.shake, 0.6 * size)
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (t.life <= 0) continue
      t.life -= dt
      ;(t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.07) * 0.9
      if (t.life <= 0) t.mesh.visible = false
    }
    let n = 0
    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const s = this.sparks[i]
      s.life -= dt
      if (s.life <= 0) {
        this.sparks.splice(i, 1)
        continue
      }
      s.v.y += s.gravity * dt
      s.p.addScaledVector(s.v, dt)
      const k = s.life / s.max
      this.s.setScalar(s.size * (0.4 + k * 0.6))
      this.m.compose(s.p, this.q, this.s)
      this.sparkMesh.setMatrixAt(n, this.m)
      this.sparkMesh.setColorAt(n, s.color)
      n += 1
    }
    this.sparkMesh.count = n
    this.sparkMesh.instanceMatrix.needsUpdate = true
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true
    for (const p of this.puffs) {
      if (p.life <= 0) continue
      p.life -= dt
      p.sprite.position.addScaledVector(p.v, dt)
      p.sprite.scale.multiplyScalar(1 + dt * p.grow * 0.6)
      ;(p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, p.life / p.max) * 0.7
      if (p.life <= 0) p.sprite.visible = false
    }
    for (const b of this.blasts) {
      if (b.life <= 0) continue
      b.life -= dt
      const k = 1 - b.life / b.max
      b.mesh.scale.setScalar(0.5 + k * b.size)
      ;(b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k) * 0.9
      if (b.life <= 0) b.mesh.visible = false
    }
    this.shake = Math.max(0, this.shake - dt * 1.8)
  }
}
