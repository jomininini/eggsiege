import * as THREE from 'three'

/** Procedural canvas textures: no image files are shipped for the world. */
const FONT = "'Noto Sans SC', 'Sora', sans-serif"

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

let seed = 1337
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

/** Curtain-wall glass facade: returns [map, emissiveMap]. */
export function facadeTextures(tint: THREE.Color, cols = 8, rows = 12): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const [c, g] = canvas(256, 256)
  const [e, ge] = canvas(256, 256)
  ge.fillStyle = '#000'
  ge.fillRect(0, 0, 256, 256)
  const frame = `rgb(${(tint.r * 90 + 40) | 0},${(tint.g * 90 + 45) | 0},${(tint.b * 90 + 55) | 0})`
  g.fillStyle = frame
  g.fillRect(0, 0, 256, 256)
  const cw = 256 / cols, rh = 256 / rows
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const px = x * cw + 2, py = y * rh + 2, w = cw - 4, h = rh - 5
      const grad = g.createLinearGradient(px, py, px + w, py + h)
      const k = 0.55 + rand() * 0.35
      grad.addColorStop(0, `rgb(${(tint.r * 170 * k + 30) | 0},${(tint.g * 190 * k + 40) | 0},${(tint.b * 220 * k + 50) | 0})`)
      grad.addColorStop(1, `rgb(${(tint.r * 90 * k + 15) | 0},${(tint.g * 110 * k + 25) | 0},${(tint.b * 140 * k + 40) | 0})`)
      g.fillStyle = grad
      g.fillRect(px, py, w, h)
      const r = rand()
      if (r > 0.82) {
        const warm = rand() > 0.4
        ge.fillStyle = warm ? 'rgba(255,214,150,0.9)' : 'rgba(150,240,255,0.85)'
        ge.fillRect(px, py, w, h)
        g.fillStyle = warm ? 'rgba(255,230,190,0.55)' : 'rgba(200,250,255,0.5)'
        g.fillRect(px, py, w, h)
      }
    }
  }
  // Floor slab lines.
  g.fillStyle = 'rgba(255,255,255,0.18)'
  for (let y = 0; y < rows; y += 1) g.fillRect(0, y * rh + rh - 3, 256, 1.5)
  const map = tex(c)
  const emi = tex(e)
  for (const t of [map, emi]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
  }
  return [map, emi]
}

/** Gold panel lines for the Golden Egg shell. */
export function eggTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256)
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#f6d27a')
  grad.addColorStop(0.5, '#e0a93e')
  grad.addColorStop(1, '#b77b22')
  g.fillStyle = grad
  g.fillRect(0, 0, 512, 256)
  g.strokeStyle = 'rgba(90,50,10,0.45)'
  g.lineWidth = 2
  for (let x = 0; x <= 512; x += 16) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, 256)
    g.stroke()
  }
  for (let y = 0; y <= 256; y += 14) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(512, y)
    g.stroke()
  }
  // Viewing window slit.
  g.fillStyle = '#2a2a33'
  g.fillRect(40, 118, 110, 16)
  const t = tex(c)
  t.wrapS = THREE.RepeatWrapping
  return t
}

export function groundTexture(base: string, line: string, size = 256, step = 32): THREE.CanvasTexture {
  const [c, g] = canvas(size, size)
  g.fillStyle = base
  g.fillRect(0, 0, size, size)
  for (let i = 0; i < 900; i += 1) {
    g.fillStyle = `rgba(0,0,0,${rand() * 0.05})`
    g.fillRect(rand() * size, rand() * size, 2, 2)
  }
  g.strokeStyle = line
  g.lineWidth = 1.5
  for (let x = 0; x <= size; x += step) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, size)
    g.stroke()
    g.beginPath()
    g.moveTo(0, x)
    g.lineTo(size, x)
    g.stroke()
  }
  const t = tex(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** A text sign texture (for flat building signs and floating labels). */
export function textTexture(text: string, opts: { color?: string; bg?: string; stroke?: string; size?: number; pad?: number; weight?: number } = {}): { texture: THREE.CanvasTexture; aspect: number } {
  const size = opts.size ?? 64
  const pad = opts.pad ?? 18
  const [m, gm] = canvas(8, 8)
  void m
  gm.font = `${opts.weight ?? 800} ${size}px ${FONT}`
  const w = Math.ceil(gm.measureText(text).width) + pad * 2
  const h = size + pad * 2
  const [c, g] = canvas(w, h)
  if (opts.bg) {
    g.fillStyle = opts.bg
    roundRect(g, 0, 0, w, h, h * 0.22)
    g.fill()
  }
  g.font = `${opts.weight ?? 800} ${size}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if (opts.stroke) {
    g.lineWidth = size * 0.16
    g.strokeStyle = opts.stroke
    g.lineJoin = 'round'
    g.strokeText(text, w / 2, h / 2 + size * 0.04)
  }
  g.fillStyle = opts.color ?? '#fff'
  g.fillText(text, w / 2, h / 2 + size * 0.04)
  return { texture: tex(c), aspect: w / h }
}

/** Round badge icon with a glyph (station markers, point letters). */
export function badgeTexture(glyph: string, color: string, ring = '#0b1420'): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128)
  g.beginPath()
  g.arc(64, 64, 58, 0, Math.PI * 2)
  g.fillStyle = ring
  g.fill()
  g.lineWidth = 8
  g.strokeStyle = color
  g.stroke()
  let fs = glyph.length > 1 ? 44 : 62
  g.font = `900 ${fs}px ${FONT}`
  const tw = g.measureText(glyph).width
  if (tw > 100) {
    fs = Math.floor((fs * 100) / tw)
    g.font = `900 ${fs}px ${FONT}`
  }
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = color
  g.fillText(glyph, 64, 68)
  return tex(c)
}

export function helipadTexture(color: string, letter = 'H'): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#2b3138'
  g.beginPath()
  g.arc(128, 128, 126, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = color
  g.lineWidth = 10
  g.beginPath()
  g.arc(128, 128, 104, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#f4f4f4'
  g.font = `900 130px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(letter, 128, 136)
  return tex(c)
}

export function skyTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(8, 256)
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#2c5a92')
  grad.addColorStop(0.45, '#7fb0d8')
  grad.addColorStop(0.62, '#f3c79a')
  grad.addColorStop(0.7, '#f6a877')
  grad.addColorStop(1, '#6f8ea8')
  g.fillStyle = grad
  g.fillRect(0, 0, 8, 256)
  return tex(c)
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** A flat sign mesh `height` metres tall. */
export function signMesh(text: string, height: number, opts: Parameters<typeof textTexture>[1] = {}): THREE.Mesh {
  const { texture, aspect } = textTexture(text, opts)
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), mat)
  return m
}

/** A camera-facing label sprite `height` metres tall. */
export function labelSprite(text: string, height: number, opts: Parameters<typeof textTexture>[1] = {}, depthTest = true): THREE.Sprite {
  const { texture, aspect } = textTexture(text, opts)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest, transparent: true, toneMapped: false }))
  s.scale.set(height * aspect, height, 1)
  return s
}
