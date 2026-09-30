/**
 * Unified input for the shooter: keyboard + mouse (pointer lock) feed one action state.
 * Gameplay reads `move`, `look` and `held()/consume()`; it never checks raw keys.
 */
export type Action =
  | 'jump' | 'sprint' | 'crouch' | 'reload' | 'interact' | 'grenade' | 'fire' | 'aim' | 'pause' | 'score'
  | 'n1' | 'n2' | 'n3' | 'n4' | 'n5'
const KEY_BINDINGS: Partial<Record<Action, string[]>> = {
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'KeyC'],
  reload: ['KeyR'],
  interact: ['KeyE', 'KeyF'],
  grenade: ['KeyG'],
  pause: ['KeyP'],
  score: ['Tab'],
  n1: ['Digit1', 'Numpad1'],
  n2: ['Digit2', 'Numpad2'],
  n3: ['Digit3', 'Numpad3'],
  n4: ['Digit4', 'Numpad4'],
  n5: ['Digit5', 'Numpad5'],
}
const MOVE_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] }

export class Input {
  /** Movement intent in [-1, 1]: x = strafe right, y = forward. */
  readonly move = { x: 0, y: 0 }
  readonly look = { x: 0, y: 0 }
  sensitivity = 1
  invertY = false
  /** Pointer lock unavailable (e.g. restrictive iframe): use raw mouse movement instead. */
  freeLook = false
  /** Gameplay is active; enables free-look fallback and mouse buttons. */
  active = false
  private keys = new Set<string>()
  private mouse = new Set<number>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private listeners: Array<() => void> = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | Document, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', e => {
      const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea, select')
      if (typing) return
      if (this.active && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'ControlLeft')) e.preventDefault()
      if (e.repeat) return
      this.keys.add(e.code)
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
        if (codes.includes(e.code)) this.pressed_.add(action)
      }
    })
    on(window, 'keyup', e => this.keys.delete(e.code))
    on(window, 'blur', () => {
      this.keys.clear()
      this.mouse.clear()
    })
    on(window, 'mousedown', e => {
      if (!this.captured()) return
      this.mouse.add(e.button)
      if (e.button === 0) this.pressed_.add('fire')
      if (e.button === 2) this.pressed_.add('aim')
    })
    on(window, 'mouseup', e => this.mouse.delete(e.button))
    on(window, 'contextmenu', e => {
      if (this.active) e.preventDefault()
    })
    on(window, 'mousemove', e => {
      if (!this.captured()) return
      this.look.x += e.movementX * 0.0021
      this.look.y += e.movementY * 0.0021
    })
    document.addEventListener('pointerlockerror', this.onLockError)
    this.listeners.push(() => document.removeEventListener('pointerlockerror', this.onLockError))
  }

  private onLockError = () => {
    this.freeLook = true
  }
  captured(): boolean {
    return document.pointerLockElement === this.canvas || (this.freeLook && this.active)
  }

  lockPointer(): void {
    if (document.pointerLockElement === this.canvas) return
    if (!this.canvas.requestPointerLock) {
      this.freeLook = true
      return
    }
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined
      r?.catch?.(() => {
        this.freeLook = true
      })
    } catch {
      this.freeLook = true
    }
  }
  unlockPointer(): void {
    if (document.pointerLockElement) document.exitPointerLock()
  }
  get locked(): boolean {
    return document.pointerLockElement === this.canvas
  }

  update(): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    const x = (k(MOVE_KEYS.right) ? 1 : 0) - (k(MOVE_KEYS.left) ? 1 : 0)
    const y = (k(MOVE_KEYS.up) ? 1 : 0) - (k(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) if (k(codes)) this.held_.add(action)
    if (this.mouse.has(0)) this.held_.add('fire')
    if (this.mouse.has(2)) this.held_.add('aim')
    const len = Math.hypot(x, y)
    this.move.x = len > 1 ? x / len : x
    this.move.y = len > 1 ? y / len : y
  }
  held(action: Action): boolean {
    return this.held_.has(action)
  }
  pressed(action: Action): boolean {
    return this.pressed_.has(action)
  }
  consume(action: Action): boolean {
    return this.pressed_.delete(action)
  }
  takeLook(): { x: number; y: number } {
    const out = { x: this.look.x * this.sensitivity, y: this.look.y * this.sensitivity * (this.invertY ? -1 : 1) }
    this.look.x = 0
    this.look.y = 0
    return out
  }
  /** Simulate an action or raw key (automated smoke test and debugging). */
  simulate(action: Action, down: boolean): void {
    if (action === 'fire' || action === 'aim') {
      const b = action === 'fire' ? 0 : 2
      if (down) {
        this.mouse.add(b)
        this.pressed_.add(action)
      } else this.mouse.delete(b)
      return
    }
    const code = KEY_BINDINGS[action]?.[0]
    if (!code) return
    if (down) {
      this.keys.add(code)
      this.pressed_.add(action)
    } else this.keys.delete(code)
  }
  simulateKey(code: string, down: boolean): void {
    if (down) this.keys.add(code)
    else this.keys.delete(code)
  }
  endFrame(): void {
    this.pressed_.clear()
  }
  releaseAll(): void {
    this.keys.clear()
    this.mouse.clear()
    this.pressed_.clear()
  }
  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners = []
  }
}
