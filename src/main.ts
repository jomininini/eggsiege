import * as MapData from './game/map'
import './styles/main.css'
import { Audio } from './engine/audio'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { SaveStore, type SaveData } from './engine/save'
import type { Game } from './game/game'
import { onLang, setLang } from './game/i18n'
import { Ui } from './ui/ui'

declare global {
  interface Window {
    __game?: { game: Game; input: Input; ui: Ui; start(): void; map: typeof import('./game/map') }
  }
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const save = new SaveStore()
  setLang(save.data.lang)
  const input = new Input(canvas)
  const audio = new Audio()
  let game: Game | undefined
  let renderer: import('./engine/renderer').Renderer | undefined

  const applySettings = (d: SaveData) => {
    input.sensitivity = d.sensitivity
    input.invertY = d.invertY
    audio.setVolumes(d.musicVolume, d.sfxVolume, d.muted)
  }

  const startMatch = () => {
    if (!game) return
    audio.unlock()
    audio.startMusic()
    game.start({ mode: save.data.mode, perTeam: save.data.perTeam, difficulty: save.data.difficulty })
    ui.show('hud')
    loop.resetAccumulator()
    input.lockPointer()
  }
  const pause = () => {
    if (game?.state !== 'playing') return
    game.pause()
    ui.show('pause')
    input.unlockPointer()
  }
  const resume = () => {
    if (game?.state !== 'paused') return
    audio.unlock()
    game.resume()
    ui.show('hud')
    loop.resetAccumulator()
    input.lockPointer()
  }

  const ui = new Ui(save, audio, {
    play: startMatch,
    restart: startMatch,
    resume,
    quit: () => {
      game?.quitToTitle()
      audio.stopMusic()
      ui.show('title')
      input.unlockPointer()
    },
    settings: patch => {
      const qualityChanged = patch.quality !== undefined && patch.quality !== save.data.quality
      save.update(patch)
      applySettings(save.data)
      if (qualityChanged) renderer?.applyQuality(save.data.quality)
      if (patch.lang) setLang(patch.lang)
    },
  })
  ui.show('boot')
  applySettings(save.data)
  ui.setBootProgress(0.1)

  let loaded = 0
  const track = <T>(p: Promise<T>): Promise<T> => p.then(v => (ui.setBootProgress(0.1 + (++loaded / 3) * 0.8), v))
  const fonts = Promise.all([
    document.fonts.load('800 64px "Noto Sans SC"', '金蛋争夺战补给技能回血'),
    document.fonts.load('700 32px "Sora"', '0123'),
  ]).catch(() => undefined)
  const [{ Game }, { Renderer }] = await Promise.all([track(import('./game/game')), track(import('./engine/renderer')), track(fonts)])
  renderer = new Renderer(canvas, save.data.quality)
  game = new Game(renderer, input, audio)
  ui.attach(game)
  onLang(() => game?.relabel())
  ui.setBootProgress(1)

  document.addEventListener('pointerlockchange', () => {
    if (!input.locked && game?.state === 'playing' && !input.freeLook) pause()
  })
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape' && input.freeLook) {
      if (game?.state === 'playing') pause()
      else if (game?.state === 'paused') resume()
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause()
  })
  canvas.addEventListener('click', () => {
    if (game?.state === 'playing' && !input.locked) input.lockPointer()
  })

  const loop = new GameLoop({
    step: dt => {
      if (!game) return
      input.update()
      if (game.state === 'playing' && input.consume('pause')) {
        pause()
        return
      }
      game.step(dt)
      input.endFrame()
    },
    render: (alpha, frame) => {
      if (!game) return
      if (ui.screen !== 'title' || game.state !== 'title') game.render(alpha, frame)
      ui.update(frame, game.state === 'playing' && input.held('score'))
    },
  })
  loop.start()
  ui.show('title')
  window.__game = { game, input, ui, start: startMatch, map: MapData }
}

void boot()
