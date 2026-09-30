import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Collision } from './collide'
import { TEAM_CSS, TEAM_COLORS } from './config'
import { L } from './i18n'
import {
  BASES, BOAT_SPAWNS, BRIDGES, BUILDINGS, CANAL, DRONE_PADS, EGG, HELIPADS, ISLAND, ISLAND_JETTIES, LAKE, LAND, PIERS, POINTS, ROADS,
  SHORE_Z, SKILLS, STATIONS, WATER_Y, isInlandWater, pointShort, type BuildingDef, type StationDef,
} from './map'
import { badgeTexture, eggTexture, facadeTextures, groundTexture, helipadTexture, signMesh, skyTexture, textTexture } from './textures'

const UNIT = new THREE.BoxGeometry(1, 1, 1)
const NEUTRAL = 0xe8edf2

export type PointVisual = { ring: THREE.Mesh; disk: THREE.Mesh; beam: THREE.Mesh; badge: THREE.Sprite; badgeTex: THREE.Texture[] }
export type StationVisual = { def: StationDef; ring: THREE.Mesh; icon: THREE.Sprite; baseY: number }
type TextOpts = Parameters<typeof textTexture>[1]
type LabelEntry = { obj: THREE.Sprite | THREE.Mesh; zh: string; en: string; h: number; opts: TextOpts }
type BadgeEntry = { sprite: THREE.Sprite; zh: string; en: string; color: string }

/** Builds the Science Park battlefield: meshes into the scene, solids into the collision world. */
export class World {
  readonly col = new Collision()
  readonly sun: THREE.DirectionalLight
  readonly points: PointVisual[] = []
  readonly stations: StationVisual[] = []
  readonly padIcons: THREE.Sprite[] = []
  private sea!: THREE.Mesh
  private seaBase!: Float32Array
  private readonly mats: Record<string, THREE.Material>
  private facadeCache = new Map<number, [THREE.CanvasTexture, THREE.CanvasTexture]>()
  private labels: LabelEntry[] = []
  private badges: BadgeEntry[] = []
  private pointOwners: number[] = POINTS.map(() => -1)
  /** Allow solid boxes over the lake/canal (bridges, piers). */
  private allowWater = false
  /** Meshes hidden outside 出海模式. */
  readonly seaOnly: THREE.Object3D[] = []

  constructor(readonly scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.55
    scene.fog = new THREE.Fog(0xaec3cf, 190, 900)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }))
    scene.add(sky)
    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x5b5146, 0.95))
    this.sun = new THREE.DirectionalLight(0xffe0b8, 2.25)
    this.sun.castShadow = true
    const cam = this.sun.shadow.camera
    cam.left = cam.bottom = -75
    cam.right = cam.top = 75
    cam.near = 10
    cam.far = 400
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.03
    scene.add(this.sun, this.sun.target)
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: 0xffe6b8, fog: false, toneMapped: false }))
    sunDisc.position.set(-620, 190, -380)
    sunDisc.lookAt(0, 0, 0)
    scene.add(sunDisc)

    this.mats = {
      concrete: new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.92 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf0f2f4, roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2c3540, roughness: 0.7, metalness: 0.3 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x8b98a5, roughness: 0.35, metalness: 0.7 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fd6ea, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.38 }),
      led: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ff5d8).multiplyScalar(2.2), toneMapped: false }),
      ledWarm: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc36b).multiplyScalar(1.8), toneMapped: false }),
      wood: new THREE.MeshStandardMaterial({ color: 0xa8774b, roughness: 0.85 }),
      grass: new THREE.MeshStandardMaterial({ color: 0x6f9a54, roughness: 1 }),
      crate: new THREE.MeshStandardMaterial({ color: 0x55616b, roughness: 0.7, metalness: 0.2 }),
      crateTeal: new THREE.MeshStandardMaterial({ color: 0x2c8c86, roughness: 0.6 }),
      barrier: new THREE.MeshStandardMaterial({ color: 0xc9c9c2, roughness: 0.9 }),
      pool: new THREE.MeshStandardMaterial({ color: 0x3fb6d6, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.85 }),
    }
    this.ground()
    this.seaAndShore()
    this.lakeAndCanal()
    this.island()
    this.backdrop()
    for (const b of BUILDINGS) this.building(b)
    this.egg()
    this.bases()
    this.trees()
    this.boundary()
    this.pointVisuals()
    this.stationVisuals()
    this.batchStatic()
  }

  /** Merge every static mesh that shares a material into one draw call (≈1100 meshes → ≈150). */
  private batchStatic(): void {
    const dynamic = new Set<THREE.Object3D>([this.sea])
    for (const p of this.points) dynamic.add(p.ring).add(p.disk).add(p.beam)
    for (const s of this.stations) dynamic.add(s.ring)
    for (const l of this.labels) dynamic.add(l.obj)
    for (const o of this.seaOnly) dynamic.add(o)
    const groups = new Map<string, { mat: THREE.Material; cast: boolean; meshes: THREE.Mesh[] }>()
    for (const o of [...this.scene.children]) {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.visible || dynamic.has(m) || m.children.length || Array.isArray(m.material) || m.userData.keep) continue
      const mat = m.material as THREE.Material
      const key = `${mat.uuid}|${m.castShadow ? 1 : 0}`
      let g = groups.get(key)
      if (!g) groups.set(key, (g = { mat, cast: m.castShadow, meshes: [] }))
      g.meshes.push(m)
    }
    for (const g of groups.values()) {
      if (g.meshes.length < 2) continue
      const geos: THREE.BufferGeometry[] = []
      for (const m of g.meshes) {
        m.updateMatrixWorld(true)
        let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
        for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name)
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2))
        if (!geo.attributes.normal) geo.computeVertexNormals()
        geo.applyMatrix4(m.matrixWorld)
        geos.push(geo)
      }
      const merged = mergeGeometries(geos, false)
      if (!merged) continue
      for (const m of g.meshes) this.scene.remove(m)
      const mesh = new THREE.Mesh(merged, g.mat)
      mesh.castShadow = g.cast
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      this.scene.add(mesh)
      for (const geo of geos) geo.dispose()
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────────
  box(x: number, y0: number, z: number, w: number, h: number, d: number, mat: THREE.Material, collide = true, shadow = true, tag?: string): THREE.Mesh {
    const m = new THREE.Mesh(UNIT, mat)
    m.position.set(x, y0 + h / 2, z)
    m.scale.set(w, h, d)
    m.castShadow = shadow
    m.receiveShadow = true
    // Ground clutter never lands in the lake or canal (keeps the waterway navigable).
    if (!this.allowWater && y0 < 1 && y0 > -0.5 && this.overInlandWater(x, z, w, d)) return m
    this.scene.add(m)
    if (collide) this.col.add({ minX: x - w / 2, maxX: x + w / 2, minY: y0, maxY: y0 + h, minZ: z - d / 2, maxZ: z + d / 2, tag })
    return m
  }

  private overInlandWater(x: number, z: number, w: number, d: number): boolean {
    for (const fx of [-0.5, 0, 0.5]) for (const fz of [-0.5, 0, 0.5]) if (isInlandWater(x + fx * w, z + fz * d)) return true
    return false
  }

  /** Camera-facing bilingual label; refreshed by relabel() when the language changes. */
  label(zh: string, en: string, height: number, opts: TextOpts = {}, depthTest = true): THREE.Sprite {
    const { texture, aspect } = textTexture(L(zh, en), opts)
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest, transparent: true, toneMapped: false }))
    s.scale.set(height * aspect, height, 1)
    this.labels.push({ obj: s, zh, en, h: height, opts })
    return s
  }

  /** Flat bilingual sign mesh. */
  signText(zh: string, en: string, height: number, opts: TextOpts = {}): THREE.Mesh {
    const m = signMesh(L(zh, en), height, opts)
    this.labels.push({ obj: m, zh, en, h: height, opts })
    return m
  }

  badge(zh: string, en: string, color: string, scale: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(L(zh, en), color), toneMapped: false, transparent: true }))
    s.scale.setScalar(scale)
    this.badges.push({ sprite: s, zh, en, color })
    return s
  }

  /** Redraw every in-world text for the current language. */
  relabel(): void {
    for (const l of this.labels) {
      const { texture, aspect } = textTexture(L(l.zh, l.en), l.opts)
      const mat = (l.obj as THREE.Mesh).material as THREE.SpriteMaterial | THREE.MeshBasicMaterial
      mat.map?.dispose()
      mat.map = texture
      mat.needsUpdate = true
      if ((l.obj as THREE.Sprite).isSprite) l.obj.scale.set(l.h * aspect, l.h, 1)
      else {
        const m = l.obj as THREE.Mesh
        m.geometry.dispose()
        m.geometry = new THREE.PlaneGeometry(l.h * aspect, l.h)
      }
    }
    for (const b of this.badges) {
      const mat = b.sprite.material
      mat.map?.dispose()
      mat.map = badgeTexture(L(b.zh, b.en), b.color)
      mat.needsUpdate = true
    }
    POINTS.forEach((p, i) => {
      const v = this.points[i]
      for (const t of v.badgeTex) t.dispose()
      v.badgeTex = [badgeTexture(pointShort(p), '#e8edf2'), badgeTexture(pointShort(p), TEAM_CSS[0]), badgeTexture(pointShort(p), TEAM_CSS[1])]
      const sm = v.badge.material as THREE.SpriteMaterial
      sm.map = v.badgeTex[this.pointOwners[i] + 1]
      sm.needsUpdate = true
    })
  }

  /** Show or hide 出海模式-only objects (island capture ring). */
  setSeaMode(sea: boolean): void {
    for (const o of this.seaOnly) o.visible = sea
  }

  private facade(tint: number, w: number, h: number, rows = 3.6): THREE.MeshStandardMaterial {
    let pair = this.facadeCache.get(tint)
    if (!pair) {
      pair = facadeTextures(new THREE.Color(tint))
      this.facadeCache.set(tint, pair)
    }
    const [map, emi] = pair.map(t => {
      const c = t.clone()
      c.repeat.set(Math.max(0.5, w / 24), Math.max(0.25, h / (rows * 12)))
      c.needsUpdate = true
      return c
    })
    return new THREE.MeshStandardMaterial({ map, emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.22, metalness: 0.35, envMapIntensity: 1 })
  }

  private flatPlane(x: number, z: number, w: number, d: number, mat: THREE.Material, y = 0.01, rotY = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat)
    m.rotation.x = -Math.PI / 2
    m.rotation.z = rotY
    m.position.set(x, y, z)
    m.receiveShadow = true
    this.scene.add(m)
    return m
  }

  // ─── ground, sea, backdrop ──────────────────────────────────────────────
  private ground(): void {
    const paving = groundTexture('#cdc8bc', 'rgba(120,110,95,0.28)', 256, 32)
    paving.repeat.set(0.1, 0.1)
    // Land outline in shape space (x, -z) with the canal notch and the egg lake carved out.
    const shape = new THREE.Shape()
    const hw = CANAL.halfW
    const a0 = Math.asin(hw / LAKE.r)
    shape.moveTo(-450, -SHORE_Z)
    shape.lineTo(-hw, -SHORE_Z)
    shape.lineTo(-hw, -(-Math.cos(a0) * LAKE.r))
    // Around the lake (through its south side) back to the east canal bank.
    const steps = 48
    const start = Math.PI / 2 + a0, end = Math.PI * 2 + Math.PI / 2 - a0
    for (let i = 0; i <= steps; i += 1) {
      const a = start + ((end - start) * i) / steps
      // Lake point at angle a measured from +x in shape space (y = -z).
      shape.lineTo(LAKE.x + Math.cos(a) * LAKE.r, -LAKE.z + Math.sin(a) * LAKE.r)
    }
    shape.lineTo(hw, -SHORE_Z)
    shape.lineTo(450, -SHORE_Z)
    shape.lineTo(450, -420)
    shape.lineTo(-450, -420)
    shape.closePath()
    const landGeo = new THREE.ShapeGeometry(shape, 8)
    landGeo.rotateX(-Math.PI / 2)
    const land = new THREE.Mesh(landGeo, new THREE.MeshStandardMaterial({ map: paving, roughness: 0.95 }))
    land.receiveShadow = true
    this.scene.add(land)
    const asphaltTex = groundTexture('#3c4148', 'rgba(255,255,255,0.0)', 64, 64)
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.9, color: 0xffffff })
    const dash = new THREE.MeshBasicMaterial({ color: 0xf2f2e6 })
    const segments: typeof ROADS = []
    for (const r of ROADS) {
      // East-west roads crossing the canal are split; the bridge deck carries them over.
      if (r.z0 === r.z1 && r.x0 < 0 && r.x1 > 0 && r.z0 > SHORE_Z && r.z0 < CANAL.z1) {
        segments.push({ ...r, x1: -5.2 }, { ...r, x0: 5.2 })
      } else segments.push(r)
    }
    for (const r of segments) {
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0)
      const ang = Math.atan2(r.x1 - r.x0, r.z1 - r.z0)
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2
      const m = this.flatPlane(cx, cz, r.w, len, asphalt, 0.015, ang)
      m.receiveShadow = true
      for (let s = -len / 2 + 3; s < len / 2 - 2; s += 7) {
        const px = cx + Math.sin(ang) * s, pz = cz + Math.cos(ang) * s
        this.flatPlane(px, pz, 0.25, 3, dash, 0.025, ang)
      }
    }
    // Lawns around the park.
    const lawns: [number, number, number, number][] = [
      [-62, 12, 34, 20], [62, 12, 34, 20], [-100, -12, 16, 40], [100, -12, 16, 40], [-40, 60, 20, 14], [40, 60, 20, 14],
      [-62, 72, 30, 12], [62, 72, 30, 12], [-13, -62, 14, 8], [13, -62, 14, 8],
    ]
    for (const [x, z, w, d] of lawns) this.flatPlane(x, z, w, d, this.mats.grass, 0.02)
    // Egg plaza disc and reflecting pools.
    const plaza = new THREE.Mesh(new THREE.RingGeometry(LAKE.r + 0.6, 21, 64), new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.8 }))
    plaza.rotation.x = -Math.PI / 2
    plaza.position.set(EGG.x, 0.03, EGG.z)
    plaza.receiveShadow = true
    this.scene.add(plaza)
    this.flatPlane(0, 23, 18, 3, this.mats.pool, 0.04)
  }

  private seaAndShore(): void {
    const geo = new THREE.PlaneGeometry(1500, 800, 90, 40)
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, WATER_Y, SHORE_Z - 400)
    this.seaBase = new Float32Array(geo.attributes.position.array as ArrayLike<number>)
    this.sea = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1e5f7c, roughness: 0.18, metalness: 0.25, flatShading: true, transparent: true, opacity: 0.94 }))
    this.sea.receiveShadow = true
    this.scene.add(this.sea)
    const bed = this.flatPlane(0, SHORE_Z - 200, 1500, 400, new THREE.MeshStandardMaterial({ color: 0x1b3f4f }), -3.2)
    bed.receiveShadow = false
    // Seawall and promenade boardwalk.
    const hw = CANAL.halfW
    for (const sx of [-1, 1]) {
      this.box(sx * (225 + hw / 2), -3.2, SHORE_Z - 0.5, 450 - hw, 3.2, 1, this.mats.concrete, false, false)
      const deck = groundTexture('#b98a5b', 'rgba(80,50,20,0.35)', 128, 16)
      deck.repeat.set(80, 2)
      this.flatPlane(sx * (225 + hw / 2), SHORE_Z + 5, 450 - hw, 10, new THREE.MeshStandardMaterial({ map: deck, roughness: 0.9 }), 0.02)
    }
    for (let x = -126; x <= 126; x += 14) {
      if (Math.abs(x) < 7) continue
      this.box(x, 0, SHORE_Z + 1.2, 0.18, 4.2, 0.18, this.mats.dark, false, false)
      this.box(x, 4.2, SHORE_Z + 1.2, 0.5, 0.18, 0.5, this.mats.ledWarm, false, false)
    }
    // Piers with lit edges.
    for (const p of PIERS) {
      this.box(p.x, -2.4, SHORE_Z - p.len / 2, p.w, 2.4, p.len, this.mats.wood, true, true, 'deck')
      for (let z = SHORE_Z - 2; z > SHORE_Z - p.len; z -= 4) {
        this.box(p.x - p.w / 2 + 0.3, 0, z, 0.2, 1, 0.2, this.mats.dark, false, false)
        this.box(p.x + p.w / 2 - 0.3, 0, z, 0.2, 1, 0.2, this.mats.dark, false, false)
      }
      this.box(p.x, 0, SHORE_Z - p.len + 0.3, p.w, 0.12, 0.3, new THREE.MeshBasicMaterial({ color: TEAM_COLORS[p.team], toneMapped: false }), false, false)
      const sign = p.team === 0 ? this.label('红方码头', 'Red Pier', 1.4, { color: '#fff', bg: TEAM_CSS[p.team], size: 44, pad: 12 }) : this.label('蓝方码头', 'Blue Pier', 1.4, { color: '#fff', bg: TEAM_CSS[p.team], size: 44, pad: 12 })
      sign.position.set(p.x, 3.2, SHORE_Z - 1)
      this.scene.add(sign)
    }
    for (const b of BOAT_SPAWNS) {
      if (b.sea) continue
      const buoy = this.box(b.x + 6, WATER_Y - 0.4, b.z - 6, 0.8, 1.4, 0.8, new THREE.MeshStandardMaterial({ color: TEAM_COLORS[b.team] }), false, false)
      buoy.rotation.y = 0.6
    }
  }

  // ─── lake, canal and bridges ────────────────────────────────────────────
  private lakeAndCanal(): void {
    const hw = CANAL.halfW
    const len = CANAL.z1 - SHORE_Z + 1
    const water = new THREE.MeshStandardMaterial({ color: 0x2a8fae, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.88, emissive: 0x0b3b4a, emissiveIntensity: 0.4 })
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x3d5a60, roughness: 1 })
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xbfc4c2, roughness: 0.9 })
    const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r, 64), water)
    lake.rotation.x = -Math.PI / 2
    lake.position.set(LAKE.x, WATER_Y + 0.02, LAKE.z)
    this.scene.add(lake)
    this.flatPlane(0, SHORE_Z + len / 2, hw * 2, len, water, WATER_Y + 0.02)
    this.flatPlane(0, SHORE_Z + len / 2, hw * 2, len, bedMat, -1.85)
    const bed = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r, 48), bedMat)
    bed.rotation.x = -Math.PI / 2
    bed.position.set(LAKE.x, -1.85, LAKE.z)
    this.scene.add(bed)
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(LAKE.r, LAKE.r, 1.9, 64, 1, true), wallMat)
    ;(wall.material as THREE.Material).side = THREE.DoubleSide
    wall.position.set(LAKE.x, -0.93, LAKE.z)
    this.scene.add(wall)
    this.allowWater = true
    for (const sx of [-1, 1]) {
      this.box(sx * (hw + 0.2), -1.9, SHORE_Z + len / 2 - 0.6, 0.4, 1.9, len - 1.2, wallMat, false, false)
      // Glowing canal kerb.
      this.box(sx * (hw + 0.25), 0, SHORE_Z + len / 2, 0.5, 0.12, len, this.mats.led, false, false)
    }
    // Lake kerb ring with LED.
    const kerb = new THREE.Mesh(new THREE.TorusGeometry(LAKE.r + 0.3, 0.08, 6, 96), this.mats.led)
    kerb.rotation.x = Math.PI / 2
    kerb.position.set(LAKE.x, 0.1, LAKE.z)
    this.scene.add(kerb)
    this.bridges()
    // Submerged steps so swimmers and landing parties can climb out of the lake.
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.9 })
    for (const deg of [35, 90, 145, 215, 325]) {
      const a = (deg * Math.PI) / 180
      for (let i = 0; i < 3; i += 1) {
        const r = LAKE.r - 0.5 - i * 1.0
        const top = -0.38 - i * 0.4
        const m = this.box(LAKE.x + Math.cos(a) * r, -1.9, LAKE.z + Math.sin(a) * r, 1.0, top + 1.9, 3, stepMat, false, false)
        m.rotation.y = -a
        const cx = LAKE.x + Math.cos(a) * r, cz = LAKE.z + Math.sin(a) * r
        this.col.add({ minX: cx - 0.9, maxX: cx + 0.9, minY: -1.9, maxY: top, minZ: cz - 0.9, maxZ: cz + 0.9, tag: 'deck' })
      }
    }
    this.allowWater = false
    const sign = this.label('金蛋湖 · 水道通往海港', 'Egg Lake · canal to the harbour', 0.9, { color: '#bff8ff', bg: 'rgba(5,30,40,0.8)', size: 44, pad: 10 })
    sign.position.set(7.5, 2.4, -20)
    this.scene.add(sign)
  }

  private bridges(): void {
    const half = CANAL.halfW + 0.7
    const steel = this.mats.steel
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x40464e, roughness: 0.9 })
    const plank = new THREE.MeshStandardMaterial({ color: 0xb98a5b, roughness: 0.9 })
    for (const br of BRIDGES) {
      const deckMat = br.road ? asphalt : plank
      this.box(0, br.top - 0.35, br.z, half * 2, 0.35, br.w, deckMat, true, true, 'deck')
      this.box(0, br.top - 0.75, br.z, half * 2, 0.4, br.w - 0.6, steel, false, true)
      const steps = 6, run = 1.35
      for (const side of [-1, 1]) {
        for (let i = 0; i < steps; i += 1) {
          const top = ((i + 1) * br.top) / steps
          this.box(side * (half + (steps - 1 - i + 0.5) * run), 0, br.z, run, top, br.w, deckMat, true, i % 2 === 0, 'deck')
        }
        // Piers on the canal banks.
        this.box(side * (CANAL.halfW + 0.35), -1.9, br.z, 0.7, br.top - 0.75 + 1.9, br.w - 1, this.mats.concrete, false, true)
      }
      for (const sz of [-1, 1]) {
        this.box(0, br.top, br.z + sz * (br.w / 2 - 0.1), half * 2, 0.95, 0.12, this.mats.glass, true, false)
        this.box(0, br.top - 0.8, br.z + sz * (br.w / 2 + 0.02), half * 2, 0.08, 0.06, this.mats.led, false, false)
      }
    }
  }

  // ─── 出海岛 (Offshore Isle) ─────────────────────────────────────────────
  private island(): void {
    const I = ISLAND
    const sand = new THREE.MeshStandardMaterial({ color: 0xe0c98f, roughness: 1, flatShading: true })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.3, 1, 48, 1), sand)
    body.scale.set(I.rx, I.y + 3.2, I.rz)
    body.position.set(I.x, (I.y - 3.2) / 2, I.z)
    body.receiveShadow = true
    this.scene.add(body)
    const grassGeo = new THREE.CircleGeometry(1, 40)
    const grass = new THREE.Mesh(grassGeo, new THREE.MeshStandardMaterial({ color: 0x79a45a, roughness: 1 }))
    grass.rotation.x = -Math.PI / 2
    grass.scale.set(I.rx - 6, I.rz - 4.5, 1)
    grass.position.set(I.x, I.y + 0.02, I.z)
    grass.receiveShadow = true
    this.scene.add(grass)
    // Concrete apron around the objective and the battery.
    this.flatPlane(I.x, I.z + 1, 22, 12, new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.9 }), I.y + 0.03)
    this.flatPlane(I.x, I.z - 11, 12, 7, new THREE.MeshStandardMaterial({ color: 0x9da3a6, roughness: 0.9 }), I.y + 0.035)
    // Sandbag ring with gaps facing the four approaches.
    const bag = new THREE.MeshStandardMaterial({ color: 0xb3a078, roughness: 1, flatShading: true })
    for (let i = 0; i < 12; i += 1) {
      if (i % 3 === 0) continue
      const a = (i / 12) * Math.PI * 2 + 0.26
      const x = I.x + Math.cos(a) * 10.5, z = I.z + 1 + Math.sin(a) * 7.2
      const m = this.box(x, I.y, z, 3.2, 1.05, 0.9, bag)
      m.rotation.y = -a + Math.PI / 2
    }
    // Command bunker and supply crates.
    this.box(I.x - 9, I.y, I.z - 9, 5, 2.8, 3.6, this.mats.concrete)
    this.box(I.x - 9, I.y + 2.8, I.z - 9, 5.6, 0.3, 4.2, this.mats.dark, false)
    this.box(I.x + 8, I.y, I.z + 8, 1.4, 1.4, 1.4, this.mats.crate)
    this.box(I.x + 9.6, I.y, I.z + 8.3, 1.4, 1.4, 1.4, this.mats.crateTeal)
    this.box(I.x - 6, I.y, I.z + 9, 3, 1.1, 0.7, this.mats.barrier)
    // Lighthouse on the north-east tip.
    const lx = I.x + 22, lz = I.z - 8
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 })
    const red = new THREE.MeshStandardMaterial({ color: 0xd8413a, roughness: 0.6 })
    for (let i = 0; i < 4; i += 1) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.35 - i * 0.12, 1.5 - i * 0.12, 3, 16), i % 2 ? red : white)
      seg.position.set(lx, I.y + 1.5 + i * 3, lz)
      seg.castShadow = true
      this.scene.add(seg)
    }
    this.col.add({ minX: lx - 1.3, maxX: lx + 1.3, minY: I.y, maxY: I.y + 12, minZ: lz - 1.3, maxZ: lz + 1.3 })
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0b0).multiplyScalar(2), toneMapped: false }))
    lamp.position.set(lx, I.y + 12.6, lz)
    lamp.userData.keep = true
    this.scene.add(lamp)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.2, 12), red)
    cap.position.set(lx, I.y + 13.8, lz)
    this.scene.add(cap)
    // Palms and rocks.
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 })
    const frond = new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 0.9, flatShading: true, side: THREE.DoubleSide })
    const palms: [number, number][] = [[-22, -6], [-24, 4], [-4, 12], [12, 11], [24, 3], [-12, -12], [6, -13]]
    palms.forEach(([dx, dz], i) => {
      const x = I.x + dx, z = I.z + dz
      const lean = 0.18 + (i % 3) * 0.06
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 6, 6), trunkMat)
      trunk.position.set(x, I.y + 3, z)
      trunk.rotation.z = lean * (i % 2 ? 1 : -1)
      trunk.castShadow = true
      this.scene.add(trunk)
      const topX = x - Math.sin(trunk.rotation.z) * 3, topY = I.y + 3 + Math.cos(trunk.rotation.z) * 3
      for (let k = 0; k < 6; k += 1) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.2, 4), frond)
        f.position.set(topX, topY, z)
        f.rotation.set(Math.PI / 2 - 0.5, (k / 6) * Math.PI * 2 + i, 0, 'YXZ')
        f.translateY(1.4)
        f.castShadow = true
        this.scene.add(f)
      }
      this.col.add({ minX: x - 0.3, maxX: x + 0.3, minY: I.y, maxY: I.y + 5, minZ: z - 0.3, maxZ: z + 0.3 })
    })
    const rock = new THREE.MeshStandardMaterial({ color: 0x7d807c, roughness: 1, flatShading: true })
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2 + 0.4
      if (Math.abs(Math.sin(a)) > 0.9 && Math.cos(a) * 0 === 0 && Math.sin(a) > 0) continue // keep the jetty side open
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + (i % 3) * 0.6, 0), rock)
      r.position.set(I.x + Math.cos(a) * (I.rx + 2), -1 + (i % 2) * 0.3, I.z + Math.sin(a) * (I.rz + 1.6))
      r.rotation.set(i, i * 2, 0)
      r.castShadow = true
      this.scene.add(r)
    }
    // Jetties for the patrol boats (south side, facing the park).
    this.allowWater = true
    for (const j of ISLAND_JETTIES) {
      this.box(j.x, -2.4, (j.z0 + j.z1) / 2, j.w, 2.4 + I.y, j.z1 - j.z0, this.mats.wood, true, true, 'deck')
      this.box(j.x, I.y, j.z1 - 0.2, j.w, 0.12, 0.3, new THREE.MeshBasicMaterial({ color: 0xffd35c, toneMapped: false }), false, false)
    }
    this.allowWater = false
    const title = this.label('出海岛 · 海上前哨', 'Offshore Isle · sea outpost', 1.8, { color: '#fff4c2', bg: 'rgba(40,30,5,0.78)', size: 56, pad: 14 })
    title.position.set(I.x, I.y + 7.5, I.z - 2)
    this.scene.add(title)
    const jettySign = this.label('巡逻艇码头 · 可经水道直达金蛋湖', 'Patrol jetty · canal to the Egg Lake', 0.8, { color: '#fff', bg: 'rgba(120,90,10,0.85)', size: 40, pad: 10 })
    jettySign.position.set(I.x, I.y + 3, I.z + 15)
    this.scene.add(jettySign)
  }

  private backdrop(): void {
    // Layered mountain ridges across the harbour (Ma On Shan / Pat Sin Leng inspired) and behind the park.
    const ridge = (cx: number, cz: number, w: number, d: number, peak: number, seed: number, color: number) => {
      const geo = new THREE.PlaneGeometry(w, d, 64, 10)
      geo.rotateX(-Math.PI / 2)
      const pos = geo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i) / w + 0.5, z = pos.getZ(i) / d + 0.5
        const profile = Math.sin(x * Math.PI) ** 0.8
        const n = Math.sin(x * 9.1 + seed) * 0.22 + Math.sin(x * 23.7 + seed * 2.3) * 0.1 + Math.sin(x * 4.3 + seed * 0.7) * 0.3
        const along = Math.sin(z * Math.PI) ** 1.3
        pos.setY(i, Math.max(0, peak * profile * along * (0.7 + n)) - 3)
      }
      geo.computeVertexNormals()
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }))
      m.position.set(cx, 0, cz)
      this.scene.add(m)
    }
    ridge(-150, -560, 700, 170, 190, 1.3, 0x5d7a6c)
    ridge(330, -600, 620, 190, 240, 4.1, 0x66827a)
    ridge(-520, -470, 420, 160, 150, 2.2, 0x6a847c)
    ridge(40, -360, 260, 60, 40, 7.7, 0x4f6f55)
    ridge(-120, 330, 620, 160, 130, 5.5, 0x55735a)
    ridge(380, 300, 420, 150, 110, 3.3, 0x5a785f)
    // Distant skyline beyond the park fences (Pak Shek Kok / Sha Tin inspired).
    const city = new THREE.MeshStandardMaterial({ color: 0x8aa1b4, roughness: 0.6, metalness: 0.2 })
    for (let i = 0; i < 42; i += 1) {
      const side = i % 3
      const x = side === 0 ? -200 - (i * 37) % 160 : side === 1 ? 200 + (i * 53) % 160 : -180 + (i * 71) % 360
      const z = side === 2 ? 170 + (i * 29) % 80 : -40 + (i * 43) % 220
      const h = 20 + ((i * 97) % 70)
      this.box(x, 0, z, 14 + (i % 4) * 4, h, 14 + (i % 3) * 5, city, false, false)
    }
  }

  // ─── buildings ──────────────────────────────────────────────────────────
  private building(b: BuildingDef): void {
    switch (b.style) {
      case 'glass': this.glassTower(b); break
      case 'pilotis': this.pilotis(b); break
      case 'hall': this.hall(b); break
      case 'lab': this.lab(b); break
      case 'pavilion': this.pavilion(b); break
      case 'club': this.club(b); break
      case 'rooftop': this.rooftop(b); break
    }
  }

  private sign(b: BuildingDef, text: string, y: number, face: 'n' | 's' | 'e' | 'w', height = 1.8, color = '#eafffb'): void {
    const m = this.signText(text, b.labelEn ?? text, height, { color, size: 72, pad: 10, stroke: 'rgba(0,0,0,0.35)' })
    const off = 0.08
    if (face === 'n') m.position.set(b.x, y, b.z - b.d / 2 - off), m.rotation.y = Math.PI
    if (face === 's') m.position.set(b.x, y, b.z + b.d / 2 + off)
    if (face === 'e') m.position.set(b.x + b.w / 2 + off, y, b.z), m.rotation.y = Math.PI / 2
    if (face === 'w') m.position.set(b.x - b.w / 2 - off, y, b.z), m.rotation.y = -Math.PI / 2
    this.scene.add(m)
  }

  private ledCrown(b: BuildingDef, y: number): void {
    this.box(b.x, y, b.z - b.d / 2 - 0.05, b.w + 0.1, 0.25, 0.1, this.mats.led, false, false)
    this.box(b.x, y, b.z + b.d / 2 + 0.05, b.w + 0.1, 0.25, 0.1, this.mats.led, false, false)
    this.box(b.x - b.w / 2 - 0.05, y, b.z, 0.1, 0.25, b.d + 0.1, this.mats.led, false, false)
    this.box(b.x + b.w / 2 + 0.05, y, b.z, 0.1, 0.25, b.d + 0.1, this.mats.led, false, false)
  }

  private glassTower(b: BuildingDef): void {
    this.box(b.x, 0, b.z, b.w, b.h, b.d, this.facade(b.tint, b.w, b.h))
    this.box(b.x, b.h, b.z, b.w - 1.2, 1.2, b.d - 1.2, this.mats.white, false)
    this.ledCrown(b, b.h - 0.6)
    if (b.label) {
      this.sign(b, b.label, b.h - 2.4, b.z > 0 ? 'n' : 's', 2.2)
      this.sign(b, b.label, b.h - 2.4, b.x > 0 ? 'w' : 'e', 2.2)
    }
  }

  private pilotis(b: BuildingDef): void {
    const floor = 5.2
    const upper = this.box(b.x, floor, b.z, b.w, b.h - floor, b.d, this.facade(b.tint, b.w, b.h - floor))
    upper.castShadow = true
    this.box(b.x, floor - 0.35, b.z, b.w - 0.4, 0.35, b.d - 0.4, this.mats.white, false, false)
    // Glowing soffit panels over the open ground floor.
    for (let i = -1; i <= 1; i += 1) this.box(b.x + i * (b.w / 3.2), floor - 0.38, b.z, 1.2, 0.05, b.d * 0.7, this.mats.led, false, false)
    const xs = [-b.w / 2 + 0.7, -b.w / 6, b.w / 6, b.w / 2 - 0.7]
    for (const cx of xs) for (const cz of [-b.d / 2 + 0.7, b.d / 2 - 0.7]) this.box(b.x + cx, 0, b.z + cz, 1.1, floor - 0.35, 1.1, this.mats.white)
    for (const cx of [-b.w / 2 + 0.7, b.w / 2 - 0.7]) this.box(b.x + cx, 0, b.z, 1.1, floor - 0.35, 1.1, this.mats.white)
    // Glass lobby core in one corner and some cover inside.
    const core = this.box(b.x - b.w / 2 + 4.2, 0, b.z + (b.z < 0 ? -1 : 1) * (b.d / 2 - 3.4), 5, floor - 0.4, 3.6, this.mats.glass)
    core.castShadow = false
    this.cover(b.x, b.z, [[3.5, -2.5, 0], [-3, 3, 1], [4.5, 3.5, 2], [-5.5, -3.5, 1]])
    this.ledCrown(b, b.h - 0.6)
    this.box(b.x, b.h, b.z, b.w - 2, 1.4, b.d - 2, this.mats.white, false)
    if (b.label) {
      this.sign(b, b.label, b.h - 3, b.x < 0 ? 'e' : 'w', 3.4)
      this.sign(b, b.label, b.h - 3, b.z < 0 ? 's' : 'n', 3.4)
    }
  }

  private hall(b: BuildingDef): void {
    const t = 0.6, door = 5.5
    const wallMat = this.facade(b.tint, b.w, b.h, 2)
    const { x, z, w, d, h } = b
    // North/south walls (along X) and east/west walls (along Z), each with a centred door.
    for (const sz of [-1, 1]) {
      const zz = z + sz * (d / 2 - t / 2)
      const seg = (w - door) / 2
      this.box(x - door / 2 - seg / 2, 0, zz, seg, h, t, wallMat)
      this.box(x + door / 2 + seg / 2, 0, zz, seg, h, t, wallMat)
      this.box(x, 4.2, zz, door, h - 4.2, t, wallMat)
      this.box(x, 4.0, zz + sz * 0.35, door + 0.6, 0.2, 0.1, this.mats.led, false, false)
    }
    for (const sx of [-1, 1]) {
      const xx = x + sx * (w / 2 - t / 2)
      const seg = (d - t * 2 - door) / 2
      this.box(xx, 0, z - door / 2 - seg / 2, t, h, seg, wallMat)
      this.box(xx, 0, z + door / 2 + seg / 2, t, h, seg, wallMat)
      this.box(xx, 4.2, z, t, h - 4.2, door, wallMat)
      this.box(xx + sx * 0.35, 4.0, z, 0.1, 0.2, door + 0.6, this.mats.led, false, false)
    }
    this.box(x, h, z, w, 0.6, d, this.mats.white)
    this.box(x, h + 0.6, z, w * 0.6, 0.9, d * 0.5, this.mats.steel, false)
    // Interior lighting.
    for (let i = -1; i <= 1; i += 2) this.box(x + i * w / 4, h - 0.1, z, w / 3, 0.08, d * 0.6, this.mats.ledWarm, false, false)
    const lamp = new THREE.PointLight(0xffe2b0, 60, 34, 1.4)
    lamp.position.set(x, h - 1.5, z)
    this.scene.add(lamp)
    this.flatPlane(x, z, w - 1.2, d - 1.2, new THREE.MeshStandardMaterial({ color: 0x9aa6ad, roughness: 0.5, metalness: 0.2 }), 0.03)
    if (b.id === 'rcc') {
      // Robot cells: industrial arms on plinths, used as cover.
      for (const [ax, az] of [[-7, -5], [7, 5], [-7, 5], [7, -5]] as const) this.robotArm(x + ax, z + az)
      this.cover(x, z, [[0, -6.5, 0], [0, 6.5, 0], [-11, 0, 1], [11, 0, 1]])
    } else {
      // Exhibition booths.
      const booth = [new THREE.MeshStandardMaterial({ color: 0x3fa9ff }), new THREE.MeshStandardMaterial({ color: 0xff9a52 }), new THREE.MeshStandardMaterial({ color: 0x5cff9d })]
      ;[[-8, -5], [8, -5], [-8, 5], [8, 5], [0, 0]].forEach(([bx, bz], i) => {
        this.box(x + bx, 0, z + bz, 4, 1.3, 2.2, this.mats.white)
        this.box(x + bx, 1.3, z + bz - 0.9, 4, 2.2, 0.2, booth[i % 3], true, false)
      })
    }
    if (b.label) {
      this.sign(b, b.label, h - 1.6, 'n', 2.2)
      this.sign(b, b.label, h - 1.6, 's', 2.2)
      this.sign(b, b.label, h - 1.6, b.x < 0 ? 'e' : 'w', 2.2)
    }
  }

  private robotArm(x: number, z: number): void {
    this.box(x, 0, z, 2, 1.1, 2, this.mats.dark)
    const orange = new THREE.MeshStandardMaterial({ color: 0xff8a2a, roughness: 0.5, metalness: 0.3 })
    const a = this.box(x, 1.1, z, 0.7, 2.6, 0.7, orange, true)
    a.rotation.z = 0.25
    const f = this.box(x + 0.9, 3.4, z, 2.2, 0.5, 0.5, orange, false)
    f.rotation.z = -0.4
  }

  /** Crates and jersey barriers around a point: [dx, dz, variant]. */
  cover(x: number, z: number, spots: [number, number, number][]): void {
    for (const [dx, dz, v] of spots) {
      if (v === 0) this.box(x + dx, 0, z + dz, 3, 1.1, 0.7, this.mats.barrier)
      else if (v === 1) {
        this.box(x + dx, 0, z + dz, 1.4, 1.4, 1.4, this.mats.crate)
        this.box(x + dx + 1.5, 0, z + dz + 0.2, 1.4, 1.4, 1.4, this.mats.crateTeal)
      } else this.box(x + dx, 0, z + dz, 1.4, 2.8, 1.4, this.mats.crate)
    }
  }

  private frontSign(b: BuildingDef): number {
    const st = STATIONS.find(s => Math.abs(s.x - b.x) < 1 && Math.abs(s.z - b.z) < b.d + 6)
    return st && st.z < b.z ? -1 : 1
  }

  private lab(b: BuildingDef): void {
    const front = this.frontSign(b)
    this.box(b.x, 0, b.z, b.w, b.h, b.d, this.facade(b.tint, b.w, b.h, 2))
    const accent = new THREE.MeshBasicMaterial({ color: b.tint, toneMapped: false })
    this.box(b.x, b.h - 1.2, b.z + front * (b.d / 2 + 0.06), b.w + 0.2, 0.3, 0.1, accent, false, false)
    this.box(b.x, 3.2, b.z + front * (b.d / 2 + 1.4), 7, 0.25, 2.8, this.mats.white, false)
    this.box(b.x - 3.3, 0, b.z + front * (b.d / 2 + 2.6), 0.25, 3.2, 0.25, this.mats.steel, false)
    this.box(b.x + 3.3, 0, b.z + front * (b.d / 2 + 2.6), 0.25, 3.2, 0.25, this.mats.steel, false)
    this.box(b.x, b.h, b.z, b.w - 1.5, 0.8, b.d - 1.5, this.mats.white, false)
    if (b.label) {
      const m = this.signText(b.label, b.labelEn ?? b.label, 1.7, { color: '#ffffff', size: 72, pad: 10, stroke: 'rgba(0,0,0,0.4)' })
      m.position.set(b.x, b.h - 2.6, b.z + front * (b.d / 2 + 0.1))
      if (front < 0) m.rotation.y = Math.PI
      this.scene.add(m)
    }
  }

  private pavilion(b: BuildingDef): void {
    const front = this.frontSign(b)
    const walls = new THREE.MeshStandardMaterial({ color: 0xf3e2c8, roughness: 0.8 })
    this.box(b.x, 0, b.z, b.w, b.h, b.d, walls)
    this.box(b.x, b.h, b.z, b.w + 0.6, 0.35, b.d + 0.6, this.mats.wood, false)
    const awning = new THREE.MeshStandardMaterial({ color: b.tint, roughness: 0.7 })
    const aw = this.box(b.x, b.h - 1.4, b.z + front * (b.d / 2 + 1.4), b.w, 0.2, 2.8, awning, false)
    aw.rotation.x = front * 0.18
    this.box(b.x, 1.0, b.z + front * (b.d / 2 + 0.05), b.w * 0.7, 1.6, 0.1, this.mats.ledWarm, false, false)
    for (let i = -1; i <= 1; i += 2) {
      const tx = b.x + i * 4.2, tz = b.z + front * (b.d / 2 + 4.5)
      this.box(tx, 0, tz, 1.1, 0.8, 1.1, this.mats.wood)
      this.box(tx, 0.8, tz, 0.1, 1.6, 0.1, this.mats.dark, false, false)
      const umb = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.6, 8), awning)
      umb.position.set(tx, 2.6, tz)
      umb.castShadow = true
      this.scene.add(umb)
    }
    if (b.label) {
      const m = this.signText(b.label, b.labelEn ?? b.label, 1.1, { color: '#fff5e6', bg: 'rgba(120,50,10,0.85)', size: 60, pad: 12 })
      m.position.set(b.x, b.h - 0.6, b.z + front * (b.d / 2 + 0.12))
      if (front < 0) m.rotation.y = Math.PI
      this.scene.add(m)
    }
  }

  private club(b: BuildingDef): void {
    const walls = new THREE.MeshStandardMaterial({ color: b.tint, roughness: 0.75 })
    this.box(b.x, 0, b.z, b.w, b.h, b.d, walls)
    this.box(b.x, b.h, b.z, b.w + 1, 0.4, b.d + 1, this.mats.wood, false)
    this.box(b.x, 0.5, b.z - b.d / 2 - 0.06, b.w * 0.8, 3, 0.1, this.mats.glass, false, false)
    const st = STATIONS.find(s => s.id === 'club')!
    // Outdoor pool terrace (the heal zone).
    this.flatPlane(st.x, st.z, 14, 6, this.mats.pool, 0.05)
    this.box(st.x, 0, st.z - 3.3, 14.6, 0.3, 0.6, this.mats.white, true, false)
    this.box(st.x, 0, st.z + 3.3, 14.6, 0.3, 0.6, this.mats.white, true, false)
    for (let i = -2; i <= 2; i += 1) this.box(st.x + i * 3, 0, st.z + 5.2, 0.9, 0.45, 2, this.mats.white, false)
    const m = this.signText('科学园会所 · 回血', 'Clubhouse · Heal', 1.5, { color: '#ffffff', bg: 'rgba(20,120,80,0.9)', size: 64, pad: 12 })
    m.position.set(b.x, b.h - 1.4, b.z - b.d / 2 - 0.1)
    m.rotation.y = Math.PI
    this.scene.add(m)
  }

  /** Mid-rise with an external stair, rooftop drone pad and a sky-bridge overlook toward the egg. */
  private rooftop(b: BuildingDef): void {
    const side = b.x < 0 ? -1 : 1
    const { x, z, w, d, h } = b
    this.box(x, 0, z, w, h, d, this.facade(b.tint, w, h))
    this.ledCrown(b, h - 0.5)
    // Stairs up the outer side, rising from the south end to the north end.
    const steps = Math.round(h / 0.5), run = d / steps
    const sx = x + side * (w / 2 + 1.6)
    const stairMat = new THREE.MeshStandardMaterial({ color: 0xb9bfc4, roughness: 0.8 })
    for (let i = 0; i < steps; i += 1) {
      const top = (i + 1) * 0.5
      this.box(sx, 0, z + d / 2 - (i + 0.5) * run, 3, top, run, stairMat, true, i % 4 === 0)
    }
    this.box(sx + side * 1.6, 0, z, 0.15, h + 1.1, d, this.mats.glass, true, false)
    // Parapets (open toward the stair and the bridge).
    this.box(x, h, z - d / 2 + 0.15, w, 0.9, 0.3, this.mats.white)
    this.box(x - side * (w / 2 - 0.15), h, z, 0.3, 0.9, d, this.mats.white)
    const gap = 3.4
    this.box(x - (w / 4 + gap / 4), h, z + d / 2 - 0.15, w / 2 - gap / 2, 0.9, 0.3, this.mats.white)
    this.box(x + (w / 4 + gap / 4), h, z + d / 2 - 0.15, w / 2 - gap / 2, 0.9, 0.3, this.mats.white)
    // Sky bridge south to an overlook platform facing the Golden Egg.
    const z0 = z + d / 2, z1 = z0 + 12, pz = z1 + 3
    this.box(x, h - 0.4, (z0 + z1) / 2, 3.2, 0.4, z1 - z0, this.mats.steel)
    this.box(x - 1.6, h, (z0 + z1) / 2, 0.12, 1.05, z1 - z0, this.mats.glass, true, false)
    this.box(x + 1.6, h, (z0 + z1) / 2, 0.12, 1.05, z1 - z0, this.mats.glass, true, false)
    this.box(x, h - 0.4, pz, 9, 0.4, 6, this.mats.steel)
    this.box(x, h, pz + 3, 9, 1.05, 0.12, this.mats.glass, true, false)
    this.box(x - 4.5, h, pz, 0.12, 1.05, 6, this.mats.glass, true, false)
    this.box(x + 4.5, h, pz, 0.12, 1.05, 6, this.mats.glass, true, false)
    this.box(x - 2.8, h - 0.4, pz - 3, 3.4, 1.0, 0.12, this.mats.glass, true, false)
    this.box(x + 2.8, h - 0.4, pz - 3, 3.4, 1.0, 0.12, this.mats.glass, true, false)
    this.box(x, h - 0.45, (z0 + z1) / 2, 3.3, 0.08, z1 - z0, this.mats.led, false, false)
    for (const [cx, cz] of [[x - 3.8, pz + 2], [x + 3.8, pz + 2], [x, (z0 + z1) / 2]] as const) this.box(cx, 0, cz, 0.6, h - 0.4, 0.6, this.mats.white)
    this.box(x - 3.5, h, pz - 1, 1.2, 1.1, 0.6, this.mats.crate)
    this.box(x + 3.5, h, pz - 1, 1.2, 1.1, 0.6, this.mats.crate)
    if (b.label) this.sign(b, b.label, h - 2, side < 0 ? 'e' : 'w', 2)
    const bridgeSign = this.signText('连桥 · 金蛋观测台', 'Sky bridge · Egg overlook', 0.8, { color: '#eafffb', bg: 'rgba(10,40,50,0.85)', size: 48, pad: 10 })
    bridgeSign.position.set(x, h + 1.7, z0 + 0.4)
    this.scene.add(bridgeSign)
    // Drone pad.
    const pad = DRONE_PADS.find(p => Math.abs(p.x - x) < 1)!
    const disc = new THREE.Mesh(new THREE.CircleGeometry(pad.r + 0.4, 32), new THREE.MeshBasicMaterial({ map: helipadTexture('#7ef9ff', 'UAV'), toneMapped: false }))
    disc.rotation.x = -Math.PI / 2
    disc.position.set(pad.x, pad.y + 0.03, pad.z)
    this.scene.add(disc)
    const icon = this.badge('无人机', 'UAV', '#7ef9ff', 1.6)
    icon.position.set(pad.x, pad.y + 3.4, pad.z)
    this.scene.add(icon)
    this.padIcons.push(icon)
    const stairSign = this.label('↑ 屋顶无人机坪', '↑ Rooftop drone pad', 0.7, { color: '#7ef9ff', bg: 'rgba(5,20,30,0.85)', size: 44, pad: 10 })
    stairSign.position.set(sx, 2.4, z + d / 2 + 1)
    this.scene.add(stairSign)
  }

  // ─── the Golden Egg ─────────────────────────────────────────────────────
  private egg(): void {
    const gold = new THREE.MeshStandardMaterial({ map: eggTexture(), metalness: 0.85, roughness: 0.28, envMapIntensity: 1.5, emissive: 0x3a2400, emissiveIntensity: 0.25 })
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 28), gold)
    shell.scale.set(EGG.rx, EGG.ry, EGG.rz)
    shell.position.set(EGG.x, EGG.cy, EGG.z)
    shell.castShadow = true
    this.scene.add(shell)
    this.col.add({ minX: EGG.x - EGG.rx * 0.92, maxX: EGG.x + EGG.rx * 0.92, minY: EGG.cy - EGG.ry * 0.85, maxY: EGG.cy + EGG.ry * 0.9, minZ: EGG.z - EGG.rz * 0.8, maxZ: EGG.z + EGG.rz * 0.8 })
    const legMat = new THREE.MeshStandardMaterial({ color: 0xf4f5f6, roughness: 0.4, metalness: 0.2 })
    const legGeo = new THREE.CylinderGeometry(0.55, 0.65, EGG.cy - 3, 12)
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2 + 0.3
      const lx = EGG.x + Math.cos(a) * EGG.rx * 0.52, lz = EGG.z + Math.sin(a) * EGG.rz * 0.5
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(lx, (EGG.cy - 3) / 2, lz)
      leg.castShadow = true
      leg.receiveShadow = true
      this.scene.add(leg)
      this.col.add({ minX: lx - 0.6, maxX: lx + 0.6, minY: 0, maxY: EGG.cy - 3, minZ: lz - 0.6, maxZ: lz + 0.6 })
    }
    // Glowing ring under the shell and the entrance stair tower on its north side.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 64), new THREE.MeshBasicMaterial({ color: 0xffd35c, toneMapped: false }))
    ring.scale.set(EGG.rx * 0.93, EGG.rz * 0.93, 30)
    ring.rotation.x = Math.PI / 2
    ring.position.set(EGG.x, EGG.cy - EGG.ry * 0.38, EGG.z)
    this.scene.add(ring)
    const rim: [number, number, number][] = [0, 50, 130, 180, 230, 310].map((deg, i) => {
      const a = (deg * Math.PI) / 180
      return [Math.cos(a) * 15.2, Math.sin(a) * 15.2, i % 3] as [number, number, number]
    })
    this.cover(EGG.x, EGG.z, rim)
    const title = this.label('金蛋 · 高锟会议中心', 'Golden Egg · Charles Kao Auditorium', 2.2, { color: '#ffe7a3', stroke: 'rgba(40,20,0,0.8)', size: 64, pad: 12 })
    title.position.set(EGG.x, EGG.cy + EGG.ry + 3.2, EGG.z)
    this.scene.add(title)
  }

  // ─── team bases ─────────────────────────────────────────────────────────
  private bases(): void {
    for (const base of BASES) {
      const s = base.team === 0 ? -1 : 1
      const color = TEAM_COLORS[base.team]
      const teamMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.15 })
      const glow = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.5 })
      const disc = new THREE.Mesh(new THREE.CircleGeometry(base.r, 40), glow)
      disc.rotation.x = -Math.PI / 2
      disc.position.set(base.x, 0.04, base.z)
      this.scene.add(disc)
      ;(disc.material as THREE.MeshBasicMaterial).opacity = 0.22
      // Defensive walls with a gap toward the park.
      this.box(base.x + s * 8, 0, base.z - 9, 10, 2.4, 0.8, this.mats.barrier)
      this.box(base.x + s * 8, 0, base.z + 9, 10, 2.4, 0.8, this.mats.barrier)
      this.box(base.x - s * 4, 0, base.z - 12, 0.8, 2.4, 6, this.mats.barrier)
      this.box(base.x - s * 4, 0, base.z + 12, 0.8, 2.4, 6, this.mats.barrier)
      this.box(base.x + s * 6, 0, base.z, 1.4, 1.4, 4, this.mats.crate)
      for (const dz of [-9, 9]) {
        this.box(base.x + s * 13, 0, base.z + dz, 0.2, 7, 0.2, this.mats.dark, false)
        this.box(base.x + s * 13 - s * 1.1, 4.4, base.z + dz, 2.2, 2.4, 0.08, teamMat, false)
      }
      const label = this.label(base.team === 0 ? '红方部署区' : '蓝方部署区', base.team === 0 ? 'Red deployment' : 'Blue deployment', 1.6, { color: '#fff', bg: TEAM_CSS[base.team], size: 48, pad: 14 })
      label.position.set(base.x, 5, base.z)
      this.scene.add(label)
      // Helipad.
      const hp = HELIPADS[base.team]
      const pad = new THREE.Mesh(new THREE.CircleGeometry(hp.r + 1.5, 40), new THREE.MeshStandardMaterial({ map: helipadTexture(TEAM_CSS[base.team], 'H'), roughness: 0.7 }))
      pad.rotation.x = -Math.PI / 2
      pad.position.set(hp.x, 0.05, hp.z)
      pad.receiveShadow = true
      this.scene.add(pad)
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2
        this.box(hp.x + Math.cos(a) * (hp.r + 1.9), 0, hp.z + Math.sin(a) * (hp.r + 1.9), 0.3, 0.25, 0.3, this.mats.ledWarm, false, false)
      }
      const icon = this.badge('直升机', 'HELI', TEAM_CSS[base.team], 1.8)
      icon.position.set(hp.x - s * (hp.r + 3), 3, hp.z)
      this.scene.add(icon)
      this.padIcons.push(icon)
    }
  }

  // ─── vegetation and bounds ──────────────────────────────────────────────
  private trees(): void {
    const spots: [number, number][] = []
    const blocked = (x: number, z: number) =>
      BUILDINGS.some(b => Math.abs(x - b.x) < b.w / 2 + 3 && Math.abs(z - b.z) < b.d / 2 + 5) ||
      POINTS.some(p => Math.hypot(x - p.x, z - p.z) < p.r + 3) ||
      STATIONS.some(s => Math.hypot(x - s.x, z - s.z) < s.r + 3) ||
      BASES.some(b => Math.hypot(x - b.x, z - b.z) < 16) ||
      HELIPADS.some(h => Math.hypot(x - h.x, z - h.z) < 11) ||
      Math.hypot(x, z) < 24 ||
      (Math.abs(x) < 9 && z < -6)
    for (const r of ROADS) {
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0)
      const ux = (r.x1 - r.x0) / len, uz = (r.z1 - r.z0) / len
      for (let s = 4; s < len - 4; s += 11) for (const side of [-1, 1]) {
        const x = r.x0 + ux * s - uz * side * (r.w / 2 + 1.8)
        const z = r.z0 + uz * s + ux * side * (r.w / 2 + 1.8)
        if (x < LAND.minX + 3 || x > LAND.maxX - 3 || z < SHORE_Z + 11 || z > LAND.maxZ - 2) continue
        if (!blocked(x, z) && !ROADS.some(o => o !== r && onRoad(o, x, z))) spots.push([x, z])
      }
    }
    for (let x = -120; x <= 120; x += 12) if (!blocked(x, SHORE_Z + 12)) spots.push([x, SHORE_Z + 12])
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.26, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a32 }), spots.length)
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), spots.length)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color()
    spots.forEach(([x, z], i) => {
      const s = 0.85 + ((i * 37) % 10) / 20
      m.compose(new THREE.Vector3(x, 1.3, z), q, new THREE.Vector3(1, 1, 1))
      trunk.setMatrixAt(i, m)
      m.compose(new THREE.Vector3(x, 3.4 * s, z), q.setFromEuler(new THREE.Euler(0, i, 0)), new THREE.Vector3(s, s * 1.1, s))
      crown.setMatrixAt(i, m)
      crown.setColorAt(i, c.setHSL(0.26 + ((i * 13) % 10) / 120, 0.45, 0.32 + ((i * 7) % 10) / 80))
      this.col.add({ minX: x - 0.3, maxX: x + 0.3, minY: 0, maxY: 2.6, minZ: z - 0.3, maxZ: z + 0.3 })
    })
    q.identity()
    trunk.castShadow = crown.castShadow = true
    crown.receiveShadow = true
    this.scene.add(trunk, crown)
  }

  private boundary(): void {
    const fence = new THREE.MeshStandardMaterial({ color: 0x3a444e, roughness: 0.6, metalness: 0.4 })
    const hedge = new THREE.MeshStandardMaterial({ color: 0x4f7a43, roughness: 1 })
    this.box(LAND.minX - 0.5, 0, (SHORE_Z + LAND.maxZ) / 2, 1, 40, LAND.maxZ - SHORE_Z, fence, true, false).visible = false
    this.box(LAND.maxX + 0.5, 0, (SHORE_Z + LAND.maxZ) / 2, 1, 40, LAND.maxZ - SHORE_Z, fence, true, false).visible = false
    this.box(0, 0, LAND.maxZ + 0.5, LAND.maxX * 2 + 2, 40, 1, fence, true, false).visible = false
    this.box(LAND.minX - 1, 0, (SHORE_Z + LAND.maxZ) / 2, 1.6, 1.4, LAND.maxZ - SHORE_Z, hedge, false, false)
    this.box(LAND.maxX + 1, 0, (SHORE_Z + LAND.maxZ) / 2, 1.6, 1.4, LAND.maxZ - SHORE_Z, hedge, false, false)
    this.box(0, 0, LAND.maxZ + 1, LAND.maxX * 2 + 4, 1.4, 1.6, hedge, false, false)
  }

  // ─── dynamic markers ────────────────────────────────────────────────────
  private pointVisuals(): void {
    for (const p of POINTS) {
      const gy = p.kind === 'island' ? ISLAND.y : 0
      const ring = new THREE.Mesh(new THREE.RingGeometry(p.r - 0.35, p.r, 64), new THREE.MeshBasicMaterial({ color: NEUTRAL, toneMapped: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide }))
      ring.rotation.x = -Math.PI / 2
      ring.position.set(p.x, gy + 0.06, p.z)
      const disk = new THREE.Mesh(new THREE.CircleGeometry(p.r - 0.35, 64), new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.08, depthWrite: false }))
      disk.rotation.x = -Math.PI / 2
      disk.position.set(p.x, gy + 0.05, p.z)
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 2.4, 48, 1, true), new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }))
      beam.position.set(p.x, gy + 1.2, p.z)
      const badgeTex = [badgeTexture(pointShort(p), '#e8edf2'), badgeTexture(pointShort(p), TEAM_CSS[0]), badgeTexture(pointShort(p), TEAM_CSS[1])]
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTex[0], toneMapped: false }))
      const b = BUILDINGS.find(bb => bb.id === p.id)
      const y = p.kind === 'egg' ? EGG.cy + EGG.ry + 6.5 : b && b.style === 'hall' ? b.h + 3.5 : p.kind === 'island' ? gy + 11 : gy + 3.6
      badge.position.set(p.x, y, p.z)
      badge.scale.setScalar(p.kind === 'egg' ? 3.6 : 2.2)
      this.scene.add(ring, disk, beam, badge)
      if (p.kind === 'island') this.seaOnly.push(ring, disk, beam, badge)
      this.points.push({ ring, disk, beam, badge, badgeTex })
    }
  }

  private stationVisuals(): void {
    for (const s of STATIONS) {
      const color = s.kind === 'supply' ? '#ffa94d' : s.kind === 'heal' ? '#5cff9d' : SKILLS[s.skill!].color
      const glyph = s.kind === 'supply' ? ['补给', 'AMMO'] : s.kind === 'heal' ? ['回血', 'HEAL'] : ['技能', 'SKILL']
      const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.25, s.r, 48), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide }))
      ring.rotation.x = -Math.PI / 2
      ring.position.set(s.x, 0.07, s.z)
      const icon = this.badge(glyph[0], glyph[1], color, 1.5)
      const baseY = s.kind === 'heal' ? 3.2 : 2.6
      icon.position.set(s.x, baseY, s.z)
      this.scene.add(ring, icon)
      this.stations.push({ def: s, ring, icon, baseY })
    }
  }

  setPointOwner(i: number, owner: number, capturing: number, contested: boolean, t: number): void {
    const v = this.points[i]
    this.pointOwners[i] = owner
    const col = owner >= 0 ? TEAM_COLORS[owner] : NEUTRAL
    const pulse = capturing >= 0 && capturing !== owner ? 0.5 + 0.5 * Math.sin(t * 8) : 1
    const shown = contested ? (Math.sin(t * 10) > 0 ? 0xffd35c : col) : capturing >= 0 && capturing !== owner && pulse > 0.5 ? TEAM_COLORS[capturing] : col
    ;(v.ring.material as THREE.MeshBasicMaterial).color.setHex(shown)
    ;(v.disk.material as THREE.MeshBasicMaterial).color.setHex(col)
    ;(v.beam.material as THREE.MeshBasicMaterial).color.setHex(shown)
    ;(v.beam.material as THREE.MeshBasicMaterial).opacity = 0.07 + 0.06 * pulse
    const sm = v.badge.material as THREE.SpriteMaterial
    const tex = v.badgeTex[owner + 1]
    if (sm.map !== tex) {
      sm.map = tex
      sm.needsUpdate = true
    }
  }

  setStationReady(i: number, ready: boolean): void {
    const m = this.stations[i].icon.material as THREE.SpriteMaterial
    m.opacity = ready ? 1 : 0.28
  }

  /** Per-frame ambient animation and sun/shadow follow. */
  animate(t: number, focus: THREE.Vector3): void {
    const pos = this.sea.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < arr.length; i += 3) {
      const x = this.seaBase[i], z = this.seaBase[i + 2]
      arr[i + 1] = WATER_Y + Math.sin(x * 0.045 + t * 1.1) * 0.22 + Math.cos(z * 0.06 + t * 1.4 + x * 0.01) * 0.18
    }
    pos.needsUpdate = true
    for (const s of this.stations) s.icon.position.y = s.baseY + Math.sin(t * 2 + s.def.x) * 0.18
    for (const icon of this.padIcons) icon.position.y += Math.sin(t * 2.2) * 0.004
    this.sun.position.set(focus.x - 120, focus.y + 150, focus.z - 70)
    this.sun.target.position.copy(focus)
  }
}

function onRoad(r: { x0: number; z0: number; x1: number; z1: number; w: number }, x: number, z: number): boolean {
  const dx = r.x1 - r.x0, dz = r.z1 - r.z0
  const len2 = dx * dx + dz * dz
  const t = Math.max(0, Math.min(1, ((x - r.x0) * dx + (z - r.z0) * dz) / len2))
  return Math.hypot(x - (r.x0 + dx * t), z - (r.z0 + dz * t)) < r.w / 2 + 1
}
