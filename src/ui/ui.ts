import type { Audio } from '../engine/audio'
import type { SaveData, SaveStore } from '../engine/save'
import { CONFIG, DIFFICULTY, DIFFICULTY_ORDER, difficultyName, launcherName, pistolName, PLAYER_TEAM, RT, TEAM_CSS, teamName, teamShort, weaponName, type Difficulty } from '../game/config'
import type { FeedEntry, Game, MatchResult, Marker, Toast } from '../game/game'
import { getLang, L, onLang, T } from '../game/i18n'
import {
  BASES, BRIDGES, BUILDINGS, CANAL, DRONE_PADS, EMPLACEMENTS, HELIPADS, ISLAND, ISLAND_DEPOT, ISLAND_POINT, LAKE, LAND, POINTS, pointName, pointShort, ROADS, SEA, SHORE_Z, SKILLS,
  STATIONS, type SkillId,
} from '../game/map'
import { eggIndex, formatClock } from '../game/rules'

export type Screen = 'boot' | 'title' | 'hud' | 'pause' | 'end'
export type UiActions = {
  play(): void
  restart(): void
  resume(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
}

const COVER = `${import.meta.env.BASE_URL}cover.jpg`

const reasonText = (r: string): string =>
  ({ egg: L('守住金蛋直至倒计时结束', 'held the Golden Egg until the countdown ended'), score: L('率先达到目标积分', 'reached the target score first'), time: L('作战时间结束，积分领先', 'led on points when time ran out'), '': '' })[r] ?? ''

const controls = (): [string, string][] => [
  ['W A S D', L('移动 / 驾驶 / 移动炮击目标圈', 'Move / drive / move the strike ring')],
  [L('鼠标', 'Mouse'), L('瞄准视角', 'Aim')],
  [L('左键', 'LMB'), L('射击 / 发射', 'Fire / launch')],
  [L('右键', 'RMB'), L('机瞄；导弹持续瞄准载具与飞行器即可锁定', 'Aim down sights; hold on a vehicle or aircraft to lock the missile')],
  ['Q / 1 · 2 · 3', L('切换 KT-9 步枪 / P-7 手枪（无限备弹）/ 飞鱼-2 便携导弹', 'Switch KT-9 rifle / P-7 sidearm (unlimited spares) / Flyfish-2 missile')],
  ['R', L('换弹（手枪也需换弹）/ 装填导弹', 'Reload (the sidearm too) / load missile')],
  ['Shift', L('冲刺 / 无人机加速', 'Sprint / drone boost')],
  [L('空格', 'Space'), L('跳跃', 'Jump')],
  ['C / Ctrl', L('蹲伏（更稳）', 'Crouch (steadier)')],
  ['G', L('投掷手雷', 'Throw grenade')],
  ['E', L('交互：载具、登陆艇、武装直升机、无人机、直升机、岛上武器', 'Interact: vehicles, landing craft, gunship, drone, helicopter, island weapons')],
  [L('空格 / C', 'Space / C'), L('武装直升机：爬升 / 下降；左键机炮、右键火箭弹', 'Gunship: climb / descend; LMB cannon, RMB rockets')],
  ['F', L('防空炮：切换瞄准 / 锁定模式', 'AA gun: toggle aim / lock mode')],
  ['B', L('无人机中：呼叫火箭炮轰炸下方', 'In drone: call a rocket strike below')],
  ['1 - 6', L('直升机目标（出海模式 6 = 降落出海岛）/ 阵亡后 2 选择出海岛重生', 'Heli target (sea mode 6 = land on the isle) / after death press 2 to respawn on the isle')],
  ['Tab', L('战况计分板', 'Scoreboard')],
  ['Esc / P', L('暂停', 'Pause')],
]

const legend = (): [string, string, string][] => [
  ['#ffd35c', L('金蛋 · 主控点', 'Golden Egg · main objective'), L(`中央高锟会议中心，脚下是连通大海的金蛋湖。占领每秒 +${CONFIG.match.tick.egg} 分，守满 ${CONFIG.match.eggHoldToWin} 秒直接获胜。`, `The central convention centre above the Egg Lake, linked to the sea by a canal. +${CONFIG.match.tick.egg}/s while held; keep it ${CONFIG.match.eggHoldToWin}s to win outright.`)],
  ['#e8edf2', L('A B C D 建筑据点', 'A B C D building points'), L('机器人中心、InnoCell、5E、大展览厅，每秒 +1 分。', 'Robotics Centre, InnoCell, 5E and the Exhibition Hall, +1/s each.')],
  ['#39d6c8', L('出海岛（出海模式）', 'Offshore Isle (sea mode)'), L('离岸小岛：占领后获得海盾防空炮、潮汐远程火箭炮与巡逻艇，并可在岛上重生。', 'An island just offshore: holding it grants the Sea Shield AA gun, Tide rocket battery, patrol boats and an island respawn.')],
  ['#ffa94d', L('餐厅 · 补给点', 'Canteens · resupply'), L('补满弹药，手雷 +2，便携导弹 +2。部署区缓慢补弹；出海模式占岛后岛上弹药库快速补弹。', 'Full ammo, +2 grenades, +2 missiles. The staging area tops up slowly; in sea mode the isle ammo depot refills fast for its holder.')],
  ['#9d8cff', L('科技公司 · 技能点', 'Tech firms · skills'), L('量子扫描、纳米护盾、智能稳定、神经加速，持续 22 秒。', 'Quantum scan, nano shield, smart stabiliser or neural rush for 22s.')],
  ['#5cff9d', L('会所 · 回血点', 'Clubhouse · healing'), L('站在会所泳池平台上持续恢复生命。', 'Stand on the clubhouse pool deck to regenerate.')],
  ['#7ef9ff', L('屋顶无人机坪', 'Rooftop drone pads'), L('10W、20E 屋顶，俯视侦察并标记敌人，可呼叫直升机与火箭炮。', '10W and 20E rooftops: scout from above, mark enemies, call the heli and rocket strikes.')],
  ['#ffd35c', L('登陆艇 / 武装直升机（出海模式）', 'Landing craft / gunship (sea mode)'), L('码头尽头的飞鱼高速登陆艇可载 5 名步兵抢滩；部署区旁的武装直升机可驾驶，能降落在出海岛停机坪补给。', 'The Flying Fish landing craft at each pier head carries 5 infantry to the beach; the gunship beside the staging area can be flown and lands on the Offshore Isle helipad to rearm.')],
  ['#ff4d5e', L('直升机 / 战车 / 快艇', 'Helicopter / cars / boats'), L('停机坪机降突击；道路战车、码头快艇从海上登陆，快艇可经水道驶入金蛋湖。', 'Heli insertion from the helipad; road cars and pier boats for landings — boats can sail the canal into the Egg Lake.')],
]

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

export class Ui {
  private root = document.querySelector<HTMLDivElement>('#ui')!
  private screens = new Map<Screen, HTMLElement>()
  private current: Screen = 'boot'
  private game?: Game
  private hud!: Record<string, HTMLElement>
  private mini!: HTMLCanvasElement
  private miniBg?: HTMLCanvasElement
  private miniSea = false
  private markerPool: HTMLDivElement[] = []
  private cache = new Map<string, string>()
  private hitTimer = 0
  /** Briefing panel minimised (session only — it always opens expanded on load). */
  private briefMin = false
  private miniTick = 0
  private bootProgress = 0
  private lastEnd?: MatchResult

  constructor(private readonly save: SaveStore, private readonly audio: Audio, private readonly actions: UiActions) {
    this.build()
    onLang(() => this.rebuild())
  }

  private build(): void {
    const zh = getLang() === 'zh'
    this.root.lang = zh ? 'zh-CN' : 'en'
    this.root.classList.toggle('en', !zh)
    this.buildBoot()
    this.buildTitle()
    this.buildHud()
    this.buildPause()
    this.buildEnd()
  }

  /** Language switch: rebuild every screen in place and keep the current one visible. */
  private rebuild(): void {
    const keep = this.current
    this.root.innerHTML = ''
    this.screens.clear()
    this.cache.clear()
    this.markerPool = []
    this.miniBg = undefined
    this.build()
    this.setBootProgress(this.bootProgress)
    if (this.lastEnd) this.fillEnd(this.lastEnd)
    this.show(keep)
  }

  attach(game: Game): void {
    this.game = game
    game.on({
      feed: e => this.pushFeed(e),
      toast: t => this.pushToast(t),
      hurt: a => this.showHurt(a),
      hitmarker: (kill, head) => this.showHit(kill, head),
      end: r => {
        this.showEnd(r)
        this.show('end')
        if (document.pointerLockElement) document.exitPointerLock()
      },
      stateChange: () => undefined,
    })
  }

  show(s: Screen): void {
    this.current = s
    for (const [k, e] of this.screens) e.classList.toggle('on', k === s || (k === 'hud' && (s === 'pause' || s === 'end')))
    this.screens.get('hud')!.classList.toggle('dim', s === 'pause' || s === 'end')
    if (s === 'hud') this.syncModeHud()
  }
  get screen(): Screen {
    return this.current
  }

  setBootProgress(v: number): void {
    this.bootProgress = v
    const bar = this.screens.get('boot')?.querySelector<HTMLElement>('.bar i')
    if (bar) bar.style.width = `${Math.round(v * 100)}%`
  }

  // ─── screens ────────────────────────────────────────────────────────────
  private screen_(name: Screen, cls: string): HTMLElement {
    const s = el('section', `screen ${cls}`)
    this.screens.set(name, s)
    this.root.appendChild(s)
    return s
  }

  private langToggle(): string {
    const l = getLang()
    return `<div class="lang-t" role="group" aria-label="Language"><button data-lang="zh" class="${l === 'zh' ? 'on' : ''}">中文</button><button data-lang="en" class="${l === 'en' ? 'on' : ''}">EN</button></div>`
  }

  private bindLang(scope: HTMLElement): void {
    scope.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(b => b.addEventListener('click', () => {
      this.click()
      const lang = b.dataset.lang === 'en' ? 'en' : 'zh'
      if (lang !== getLang()) this.actions.settings({ lang })
    }))
  }

  private buildBoot(): void {
    const s = this.screen_('boot', 'boot')
    s.style.backgroundImage = `linear-gradient(rgba(4,10,16,0.55), rgba(4,10,16,0.85)), url(${COVER})`
    s.innerHTML = `<div class="boot-card"><div class="logo-egg"></div><h1>${L('金蛋争夺战', 'GOLDEN EGG SIEGE')}</h1><p>${L('正在部署科学园战区…', 'Deploying the Science Park battlefield…')}</p><div class="bar"><i></i></div></div>`
  }

  private buildTitle(): void {
    const s = this.screen_('title', 'title')
    s.style.backgroundImage = `url(${COVER})`
    const d = this.save.data
    const diffDesc = (k: Difficulty) => {
      const t = DIFFICULTY[k]
      return L(`反应 ${t.reaction[0]}–${t.reaction[1]} 秒 · 单发伤害 ${t.damage} · 视野 ${t.viewRange} 米`, `reaction ${t.reaction[0]}–${t.reaction[1]}s · ${t.damage} dmg/shot · ${t.viewRange} m sight`)
    }
    s.innerHTML = `
      <div class="title-shade"></div>
      <div class="brand-en">${getLang() === 'en' ? '<b>GOLDEN EGG SIEGE</b><span>SCIENCE PARK FRONT</span>' : ''}</div>
      <div class="title-wrap">
        <div class="brief panel">
          <div class="panel-h">${L('任务简报', 'Mission briefing')} ${this.langToggle()}<button class="min" data-a="min" title="${L('最小化 / 展开简报', 'Minimise / expand briefing')}"><span class="mi">–</span><span class="mx">${L('展开', 'Expand')}</span></button></div>
          <div class="brief-body">
          <p>${L(
            `吐露港畔的创科园区被划为演习战区。<b class="r">红方 · 赤焰</b> 与 <b class="b">蓝方 · 海鹰</b> 围绕据点展开争夺——核心是园区中央、十根白柱托起的<b class="g">金蛋</b>。`,
            `The waterfront innovation park is now a live-fire exercise zone. <b class="r">Red · Blaze</b> and <b class="b">Blue · Sea Hawk</b> fight over its objectives — above all the <b class="g">Golden Egg</b> raised on ten white columns.`,
          )}</p>
          <ul class="goals">
            <li><i>01</i>${L(`占领据点每秒累积积分，先到 <b>${CONFIG.match.targetScore}</b> 分获胜`, `Hold points to score every second — first to <b>${CONFIG.match.targetScore}</b> wins`)}</li>
            <li><i>02</i>${L(`或者占领<b class="g">金蛋</b>并连续守住 <b>${CONFIG.match.eggHoldToWin}</b> 秒，直接取胜`, `Or take the <b class="g">Golden Egg</b> and hold it <b>${CONFIG.match.eggHoldToWin}</b>s to win outright`)}</li>
          </ul>
          <div class="opt-h">${L('作战模式', 'Game mode')}</div>
          <div class="modes">
            <button class="mode ${d.mode === 'standard' ? 'on' : ''}" data-mode="standard"><b>${L('标准模式', 'Standard')}</b><span>${L('园区五大据点 + 金蛋争夺；战车、快艇、无人机、直升机', 'Five park objectives + the Egg; cars, boats, drones and helicopters')}</span></button>
            <button class="mode sea ${d.mode === 'sea' ? 'on' : ''}" data-mode="sea"><b>${L('出海模式', 'Sea mode')}<em>${L('可选', 'optional')}</em></b><span>${L('新增出海岛：抢滩夺岛，操作防空炮（瞄准/锁定）与远程火箭炮轰炸科学园，驾巡逻艇经水道突袭金蛋湖', 'Adds the Offshore Isle: storm the beach, run the AA gun (aim/lock) and the rocket battery to bombard the park, then sail patrol boats up the canal into the Egg Lake')}</span></button>
          </div>
          <div class="opts">
            <label class="opt"><span>${L('每队人数', 'Team size')}</span><input type="range" min="2" max="10" step="1" data-o="perTeam" value="${d.perTeam}"><em class="pt">${d.perTeam} v ${d.perTeam}</em></label>
            <div class="opt"><span>${L('游戏难度', 'Difficulty')}</span><div class="seg">${DIFFICULTY_ORDER.map(k => `<button data-diff="${k}" class="${d.difficulty === k ? 'on' : ''}">${difficultyName(k)}</button>`).join('')}</div></div>
            <div class="diff-desc">${diffDesc(d.difficulty)}</div>
          </div>
          </div>
          <div class="btns">
            <button class="btn primary" data-a="play">${L('开始作战', 'Deploy')}</button>
            <button class="btn" data-a="howto">${L('操作与地图说明', 'Controls & map')}</button>
            <button class="btn" data-a="settings">${L('设置', 'Settings')}</button>
          </div>
          <div class="brief-body2"><div class="career"></div>
          <div class="hint">${L('点击“开始作战”后鼠标将被锁定用于瞄准，按 Esc 可随时暂停。', 'After “Deploy” the mouse is captured for aiming; press Esc to pause at any time.')}</div></div>
        </div>
      </div>
      <div class="modal howto">
        <div class="panel wide">
          <div class="panel-h">${L('操作说明', 'How to play')} <button class="x" data-a="close">×</button></div>
          <div class="cols">
            <div><h3>${L('基础操作', 'Controls')}</h3><div class="keys">${controls().map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div></div>
            <div><h3>${L('园区战术要素', 'Battlefield features')}</h3><div class="legend">${legend().map(([c, t, dd]) => `<div><i style="--c:${c}"></i><b>${t}</b><span>${dd}</span></div>`).join('')}</div></div>
          </div>
          <div class="tips">${L(
            '小技巧：据点内人数越多占领越快；敌我同时在场时进度冻结。飞鱼-2 导弹对步兵、战车、船只、直升机、无人机与岛上武器都有效；右键持续瞄准载具或飞行器完成锁定后发射即可追踪。看到地面红圈说明炮击将至，立即离开！',
            'Tips: more teammates capture faster; enemies inside freeze progress. The Flyfish-2 hurts infantry, cars, boats, helicopters, drones and island weapons — hold right mouse on a vehicle or aircraft until it locks and the missile will home in. A red ring on the ground means rockets are coming: get out!',
          )}</div>
        </div>
      </div>
      <div class="modal settings-m"><div class="panel">${this.settingsHtml()}<div class="btns"><button class="btn primary" data-a="close">${L('完成', 'Done')}</button></div></div></div>`
    const brief = s.querySelector<HTMLElement>('.brief')!
    if (this.briefMin) brief.classList.add('mini')
    s.querySelector('[data-a=min]')!.addEventListener('click', () => {
      this.click()
      this.briefMin = !this.briefMin
      brief.classList.toggle('mini', this.briefMin)
    })
    s.querySelector('[data-a=play]')!.addEventListener('click', () => {
      this.click()
      this.actions.play()
    })
    s.querySelector('[data-a=howto]')!.addEventListener('click', () => {
      this.click()
      s.querySelector('.howto')!.classList.add('on')
    })
    s.querySelector('[data-a=settings]')!.addEventListener('click', () => {
      this.click()
      s.querySelector('.settings-m')!.classList.add('on')
    })
    s.querySelectorAll('[data-a=close]').forEach(b => b.addEventListener('click', () => {
      this.click()
      s.querySelectorAll('.modal').forEach(m => m.classList.remove('on'))
    }))
    s.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.addEventListener('click', () => {
      this.click()
      const mode = b.dataset.mode === 'sea' ? 'sea' : 'standard'
      this.actions.settings({ mode })
      s.querySelectorAll('[data-mode]').forEach(o => o.classList.toggle('on', o === b))
    }))
    s.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(b => b.addEventListener('click', () => {
      this.click()
      const difficulty = b.dataset.diff as Difficulty
      this.actions.settings({ difficulty })
      s.querySelectorAll('[data-diff]').forEach(o => o.classList.toggle('on', o === b))
      s.querySelector('.diff-desc')!.innerHTML = diffDesc(difficulty)
    }))
    const pt = s.querySelector<HTMLInputElement>('[data-o=perTeam]')!
    pt.addEventListener('input', () => {
      const n = Number(pt.value)
      s.querySelector('.pt')!.textContent = `${n} v ${n}`
      this.actions.settings({ perTeam: n })
    })
    this.bindLang(s)
    this.bindSettings(s)
    this.updateCareer()
  }

  private updateCareer(): void {
    const d = this.save.data
    const c = this.screens.get('title')?.querySelector('.career')
    if (c) c.innerHTML = d.matches ? L(`战绩：${d.matches} 场 · 胜 ${d.wins} · 单局最多击倒 ${d.bestKills}`, `Record: ${d.matches} matches · ${d.wins} wins · best ${d.bestKills} kills`) : ''
  }

  private settingsHtml(): string {
    const d = this.save.data
    return `<div class="panel-h">${L('设置', 'Settings')} ${this.langToggle()}</div>
      <div class="settings">
        <label>${L('鼠标灵敏度', 'Mouse sensitivity')} <input type="range" min="0.2" max="3" step="0.05" data-s="sensitivity" value="${d.sensitivity}"><em></em></label>
        <label>${L('音乐音量', 'Music volume')} <input type="range" min="0" max="1" step="0.05" data-s="musicVolume" value="${d.musicVolume}"><em></em></label>
        <label>${L('音效音量', 'Effects volume')} <input type="range" min="0" max="1" step="0.05" data-s="sfxVolume" value="${d.sfxVolume}"><em></em></label>
        <label>${L('画质', 'Quality')} <select data-s="quality"><option value="low">${L('流畅', 'Fast')}</option><option value="medium">${L('均衡', 'Balanced')}</option><option value="high">${L('高清（泛光）', 'High (bloom)')}</option></select></label>
        <label class="chk"><input type="checkbox" data-s="invertY" ${d.invertY ? 'checked' : ''}> ${L('反转 Y 轴', 'Invert Y axis')}</label>
        <label class="chk"><input type="checkbox" data-s="muted" ${d.muted ? 'checked' : ''}> ${L('静音', 'Mute')}</label>
      </div>`
  }

  private bindSettings(scope: HTMLElement): void {
    scope.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-s]').forEach(inp => {
      const key = inp.dataset.s as keyof SaveData
      if (inp instanceof HTMLSelectElement) inp.value = String(this.save.data[key])
      const out = inp.parentElement?.querySelector('em')
      const show = () => {
        if (out && inp instanceof HTMLInputElement && inp.type === 'range') out.textContent = key === 'sensitivity' ? Number(inp.value).toFixed(2) : `${Math.round(Number(inp.value) * 100)}%`
      }
      show()
      inp.addEventListener('input', () => {
        show()
        let v: unknown
        if (inp instanceof HTMLInputElement && inp.type === 'checkbox') v = inp.checked
        else if (inp instanceof HTMLInputElement) v = Number(inp.value)
        else v = inp.value
        this.actions.settings({ [key]: v } as Partial<SaveData>)
        this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[data-s=${key}]`).forEach(o => {
          if (o === inp) return
          if (o instanceof HTMLInputElement && o.type === 'checkbox') o.checked = v as boolean
          else o.value = String(v)
        })
      })
    })
  }

  private buildPause(): void {
    const s = this.screen_('pause', 'pause')
    s.innerHTML = `<div class="panel">
      <div class="panel-h">${L('作战暂停', 'Paused')}</div>
      <div class="pause-info"></div>
      <div class="btns col">
        <button class="btn primary" data-a="resume">${L('继续作战', 'Resume')}</button>
        <button class="btn" data-a="restart">${L('重新开始', 'Restart')}</button>
        <button class="btn" data-a="quit">${L('返回标题（可更改模式、人数与难度）', 'Back to title (change mode, team size, difficulty)')}</button>
      </div>
      ${this.settingsHtml()}
      <div class="mini-keys">${controls().slice(0, 14).map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('')}</div>
    </div>`
    s.querySelector('[data-a=resume]')!.addEventListener('click', () => this.actions.resume())
    s.querySelector('[data-a=restart]')!.addEventListener('click', () => this.actions.restart())
    s.querySelector('[data-a=quit]')!.addEventListener('click', () => this.actions.quit())
    this.bindLang(s)
    this.bindSettings(s)
  }

  private matchInfo(): string {
    return `${RT.sea ? L('出海模式', 'Sea mode') : L('标准模式', 'Standard')} · ${RT.perTeam} v ${RT.perTeam} · ${difficultyName(RT.difficulty)}`
  }

  private buildEnd(): void {
    const s = this.screen_('end', 'end')
    s.innerHTML = `<div class="panel end-panel"><div class="end-banner"></div><div class="end-reason"></div><div class="end-score"></div><div class="end-stats"></div><div class="end-board"></div>
      <div class="btns"><button class="btn primary" data-a="restart">${L('再战一局', 'Play again')}</button><button class="btn" data-a="quit">${L('返回标题', 'Back to title')}</button></div></div>`
    s.querySelector('[data-a=restart]')!.addEventListener('click', () => this.actions.restart())
    s.querySelector('[data-a=quit]')!.addEventListener('click', () => this.actions.quit())
  }

  private showEnd(r: MatchResult): void {
    this.lastEnd = r
    this.fillEnd(r)
    const d = this.save.data
    this.save.update({ matches: d.matches + 1, wins: d.wins + (r.winner === PLAYER_TEAM ? 1 : 0), bestKills: Math.max(d.bestKills, r.player.kills) })
    this.updateCareer()
  }

  private fillEnd(r: MatchResult): void {
    const s = this.screens.get('end')!
    const win = r.winner === PLAYER_TEAM
    const draw = r.winner < 0
    const banner = s.querySelector<HTMLElement>('.end-banner')!
    banner.className = `end-banner ${draw ? 'draw' : win ? 'win' : 'lose'}`
    banner.innerHTML = draw ? L('平 局', 'DRAW') : win ? L('胜 利', 'VICTORY') : L('失 败', 'DEFEAT')
    s.querySelector('.end-reason')!.innerHTML = (draw ? L('双方积分相同', 'Scores level') : `${teamName(r.winner)} ${reasonText(r.reason)}`) + `<br><small>${this.matchInfo()}</small>`
    s.querySelector('.end-score')!.innerHTML = `<b style="color:${TEAM_CSS[0]}">${Math.floor(r.scores[0])}</b><span>${L('积分', 'SCORE')}</span><b style="color:${TEAM_CSS[1]}">${Math.floor(r.scores[1])}</b><em>${L('作战时长', 'Duration')} ${formatClock(r.time)}</em>`
    const p = r.player
    s.querySelector('.end-stats')!.innerHTML = [
      [L('击倒', 'Kills'), p.kills], [L('阵亡', 'Deaths'), p.deaths], [L('占领', 'Captures'), p.captures], [L('命中率', 'Accuracy'), `${Math.round(p.accuracy * 100)}%`], [L('爆头', 'Headshots'), p.headshots], [L('伤害', 'Damage'), p.damage],
    ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')
    s.querySelector('.end-board')!.innerHTML = this.boardHtml(r.board)
  }

  private boardHtml(board: MatchResult['board']): string {
    return [0, 1].map(team => `<div class="team t${team}"><div class="th">${teamName(team)}</div><div class="row h"><span>${L('队员', 'Player')}</span><span>${L('击倒', 'K')}</span><span>${L('阵亡', 'D')}</span><span>${L('占领', 'Cap')}</span></div>${board
      .filter(b => b.team === team)
      .map(b => `<div class="row ${b.isPlayer ? 'me' : ''}"><span>${b.isPlayer ? L('你', 'You') : b.name}</span><span>${b.kills}</span><span>${b.deaths}</span><span>${b.captures}</span></div>`)
      .join('')}</div>`).join('')
  }

  // ─── HUD ────────────────────────────────────────────────────────────────
  private buildHud(): void {
    const s = this.screen_('hud', 'hud')
    s.innerHTML = `
      <div class="vignette"></div><div class="lowhp"></div><div class="drone-fx"><i></i></div>
      <div class="aa-fx"><i class="ring"></i><i class="lockring"></i><b class="aa-mode"></b></div>
      <div class="arty-fx"><div class="arty-card"></div></div>
      <div class="markers"></div>
      <div class="top">
        <div class="scorebar">
          <div class="team t0"><span class="nm">${teamShort(0)}</span><b class="sc0">0</b><div class="goal"><i class="g0"></i></div></div>
          <div class="clock"><b class="time">10:00</b><span class="target">${L('目标', 'Target')} ${CONFIG.match.targetScore}</span></div>
          <div class="team t1"><div class="goal"><i class="g1"></i></div><b class="sc1">0</b><span class="nm">${teamShort(1)}</span></div>
        </div>
        <div class="chips">${POINTS.map((p, i) => `<div class="chip ${p.kind}" data-i="${i}" title="${pointName(p)}"><b>${pointShort(p)}</b><i></i></div>`).join('')}</div>
        <div class="eggbar"><span class="lbl"></span><div class="track"><i></i></div></div>
        <div class="toasts"></div>
      </div>
      <div class="minimap panel-lite"><canvas width="240" height="184"></canvas><div class="mm-l">${L('科学园战区', 'SCIENCE PARK')}</div></div>
      <div class="feed"></div>
      <div class="center">
        <div class="cross"><i class="u"></i><i class="d"></i><i class="l"></i><i class="r"></i><i class="dot"></i><i class="lock"></i></div>
        <div class="hit"><i></i><i></i><i></i><i></i></div>
        <div class="hurts"></div>
      </div>
      <div class="capture"><div class="cap-name"></div><div class="cap-track"><i></i></div><div class="cap-state"></div></div>
      <div class="prompt"></div>
      <div class="respawn"><b>${L('你已阵亡', 'You are down')}</b><span></span><div class="rsp-opt"></div></div>
      <div class="vitals">
        <div class="hp-row"><span class="ic">+</span><b class="hp">100</b><div class="hpbar"><i class="hpfill"></i><i class="shfill"></i></div></div>
        <div class="buffs"></div>
      </div>
      <div class="ammo">
        <div class="ammo-warn"><i class="arr">▲</i><span></span></div>
        <div class="slots"><span class="s1"><kbd>1</kbd>${L('步枪', 'Rifle')}</span><span class="s2"><kbd>2</kbd>${L('手枪', 'Pistol')}</span><span class="s3"><kbd>3</kbd>${L('导弹', 'Missile')}</span></div>
        <div class="wname">${weaponName()}</div>
        <div class="ammo-row"><b class="mag">30</b><span class="res">/ 150</span></div>
        <div class="gren"><span>${L('手雷', 'Grenades')}</span><b class="gn">2</b><span>${L('导弹', 'Missiles')}</span><b class="rk">1</b><span class="reload">${L('装填中…', 'Reloading…')}</span></div>
      </div>
      <div class="scoreboard"></div>`
    const q = <T extends HTMLElement>(sel: string) => s.querySelector<T>(sel)!
    this.hud = {
      sc0: q('.sc0'), sc1: q('.sc1'), g0: q('.g0'), g1: q('.g1'), time: q('.time'), eggbar: q('.eggbar'), eggLbl: q('.eggbar .lbl'), eggFill: q('.eggbar .track i'),
      toasts: q('.toasts'), feed: q('.feed'), cross: q('.cross'), crossLock: q('.cross .lock'), hit: q('.hit'), hurts: q('.hurts'), capture: q('.capture'), capName: q('.cap-name'),
      capFill: q('.cap-track i'), capState: q('.cap-state'), prompt: q('.prompt'), respawn: q('.respawn'), respawnT: q('.respawn span'), rspOpt: q('.rsp-opt'), hp: q('.hp'),
      hpfill: q('.hpfill'), shfill: q('.shfill'), buffs: q('.buffs'), mag: q('.mag'), res: q('.res'), gn: q('.gn'), rk: q('.rk'), reload: q('.reload'), wname: q('.wname'),
      slots: q('.slots'), markers: q('.markers'), lowhp: q('.lowhp'), drone: q('.drone-fx'), aa: q('.aa-fx'), aaMode: q('.aa-mode'), aaLock: q('.aa-fx .lockring'),
      arty: q('.arty-fx'), artyCard: q('.arty-card'), board: q('.scoreboard'), chips: q('.chips'), ammo: q('.ammo'), awarn: q('.ammo-warn'), awarnT: q('.ammo-warn span'), awarnA: q('.ammo-warn .arr'),
    }
    this.mini = q<HTMLCanvasElement>('.minimap canvas')
    this.syncModeHud()
  }

  /** Show / hide the island chip and resize the minimap for the current mode. */
  private syncModeHud(): void {
    if (!this.hud) return
    const chip = this.hud.chips.children[ISLAND_POINT] as HTMLElement | undefined
    if (chip) chip.style.display = RT.sea ? '' : 'none'
    if (this.miniSea !== RT.sea) {
      this.miniSea = RT.sea
      this.miniBg = undefined
    }
    // Keep the map to scale: the sea-mode view reaches out to the (now distant) isle.
    const minX = LAND.minX - 6, maxX = LAND.maxX + 6
    const minZ = RT.sea ? ISLAND.z - ISLAND.rz - 8 : SEA.minZ + 60
    const h = Math.round(this.mini.width * (LAND.maxZ + 4 - minZ) / (maxX - minX))
    this.mini.height = RT.sea ? Math.min(300, h) : 184
  }

  private set(key: string, e: HTMLElement, html: string): void {
    if (this.cache.get(key) === html) return
    this.cache.set(key, html)
    e.innerHTML = html
  }

  private pushToast(t: Toast): void {
    const box = this.hud.toasts
    const d = el('div', `toast ${t.kind}`, t.text)
    box.prepend(d)
    while (box.children.length > 4) box.lastElementChild!.remove()
    setTimeout(() => d.classList.add('out'), 3600)
    setTimeout(() => d.remove(), 4200)
  }

  private pushFeed(e: FeedEntry): void {
    const d = el('div', 'kill', `<b style="color:${TEAM_CSS[e.killerTeam] ?? '#ccc'}">${e.killer}</b><span class="w">${e.weapon}${e.head ? L(' ✦爆头', ' ✦HEADSHOT') : ''}</span><b style="color:${TEAM_CSS[e.victimTeam]}">${e.victim}</b>`)
    const me = this.game?.player.name
    if (e.killer === me || e.victim === me) d.classList.add('me')
    this.hud.feed.prepend(d)
    while (this.hud.feed.children.length > 6) this.hud.feed.lastElementChild!.remove()
    setTimeout(() => d.remove(), 7000)
  }

  private showHit(kill: boolean, head: boolean): void {
    const h = this.hud.hit
    h.className = `hit on ${kill ? 'kill' : ''} ${head ? 'head' : ''}`
    this.hitTimer = kill ? 0.35 : 0.15
  }

  private showHurt(angle: number): void {
    const d = el('div', 'hurt')
    d.style.transform = `rotate(${-angle}rad)`
    this.hud.hurts.appendChild(d)
    setTimeout(() => d.remove(), 900)
    const hud = this.screens.get('hud')!
    hud.classList.remove('flash')
    void hud.offsetWidth
    hud.classList.add('flash')
  }

  private click(): void {
    this.audio.unlock()
    this.audio.play('ui')
  }

  /** Per-frame HUD refresh. */
  update(dt: number, showBoard: boolean): void {
    const g = this.game
    if (!g || (this.current !== 'hud' && this.current !== 'pause' && this.current !== 'end')) return
    if (this.current === 'pause') this.set('pinfo', this.screens.get('pause')!.querySelector<HTMLElement>('.pause-info')!, this.matchInfo())
    const m = g.match
    const p = g.player
    const h = this.hud
    const t = g.time
    this.set('sc0', h.sc0, String(Math.floor(m.scores[0])))
    this.set('sc1', h.sc1, String(Math.floor(m.scores[1])))
    h.g0.style.width = `${Math.min(100, (m.scores[0] / CONFIG.match.targetScore) * 100)}%`
    h.g1.style.width = `${Math.min(100, (m.scores[1] / CONFIG.match.targetScore) * 100)}%`
    this.set('time', h.time, formatClock(m.timeLeft))
    h.time.classList.toggle('warn', m.timeLeft < 60)
    m.points.forEach((s, i) => {
      const chip = h.chips.children[i] as HTMLElement
      if (!chip) return
      const cls = `chip ${s.kind} o${s.owner} ${s.contested ? 'contested' : ''} ${s.capturing >= 0 && s.capturing !== s.owner ? `cap c${s.capturing}` : ''}`
      if (chip.className !== cls) chip.className = cls
      const fill = chip.querySelector('i') as HTMLElement
      fill.style.width = `${s.progress * 100}%`
      fill.style.background = s.owner >= 0 ? TEAM_CSS[s.owner] : s.progressTeam >= 0 ? TEAM_CSS[s.progressTeam] : '#e8edf2'
    })
    const egg = m.points[eggIndex(m)]
    if (egg.owner >= 0) {
      h.eggbar.className = `eggbar on t${egg.owner}`
      this.set('eggl', h.eggLbl, L(`${teamShort(egg.owner)}控制金蛋 · 守卫 ${Math.floor(m.eggHold)}/${CONFIG.match.eggHoldToWin} 秒`, `${teamShort(egg.owner)} holds the Egg · ${Math.floor(m.eggHold)}/${CONFIG.match.eggHoldToWin}s`))
      h.eggFill.style.width = `${(m.eggHold / CONFIG.match.eggHoldToWin) * 100}%`
    } else h.eggbar.className = 'eggbar'
    // Capture bar.
    const zi = g.playerZone()
    if (zi >= 0) {
      const s = m.points[zi]
      const pt = POINTS[zi]
      h.capture.classList.add('on')
      this.set('capn', h.capName, `${pt.kind === 'building' ? pointShort(pt) + ' · ' : ''}${pointName(pt)}`)
      const mineOwned = s.owner === PLAYER_TEAM
      let state: string
      if (s.contested) state = L('争夺中 · 清除区域内敌人', 'Contested · clear the zone')
      else if (mineOwned && s.progress >= 1) state = L('已控制 · 守住据点', 'Secured · hold the point')
      else if (mineOwned) state = L('加固中…', 'Reinforcing…')
      else if (s.owner >= 0) state = L('中立化敌方据点…', 'Neutralising enemy point…')
      else state = L('占领中…', 'Capturing…')
      this.set('caps', h.capState, state)
      h.capState.className = `cap-state ${s.contested ? 'warn' : ''}`
      const fillTeam = s.owner >= 0 ? s.owner : s.progressTeam
      h.capFill.style.width = `${s.progress * 100}%`
      h.capFill.style.background = fillTeam >= 0 ? TEAM_CSS[fillTeam] : '#e8edf2'
    } else h.capture.classList.remove('on')
    this.set('prompt', h.prompt, g.prompt)
    h.prompt.classList.toggle('on', !!g.prompt)
    // Death / respawn choice.
    const alive = p.alive
    h.respawn.classList.toggle('on', !alive && g.state === 'playing')
    if (!alive) {
      const isle = g.islandRespawnAvailable
      const where = isle && g.respawnIsland ? L('出海岛', 'the Offshore Isle') : L('红方部署区', 'the Red staging area')
      this.set('rsp', h.respawnT, L(`${Math.max(0, Math.ceil(p.respawnAt - t))} 秒后在${where}重新部署`, `Redeploying at ${where} in ${Math.max(0, Math.ceil(p.respawnAt - t))}s`))
      this.set('rspo', h.rspOpt, isle ? `<span class="${g.respawnIsland ? '' : 'on'}"><kbd>1</kbd>${L('部署区', 'Staging area')}</span><span class="${g.respawnIsland ? 'on' : ''}"><kbd>2</kbd>${L('出海岛', 'Offshore Isle')}</span>` : '')
    }
    // Vitals.
    const veh = g.activeVehicle
    const seat = g.seatStatus()
    const gs = g.gunshipStatus()
    const armour = veh ? { hp: veh.hp, max: veh.maxHp } : seat ? { hp: seat.hp, max: seat.maxHp } : gs ? { hp: gs.hp, max: gs.maxHp } : null
    if (armour) {
      this.set('hp', h.hp, String(Math.ceil(armour.hp)))
      h.hpfill.style.width = `${(armour.hp / armour.max) * 100}%`
      h.shfill.style.width = '0%'
    } else {
      this.set('hp', h.hp, String(Math.ceil(p.hp)))
      h.hpfill.style.width = `${(p.hp / p.maxHp) * 100}%`
      h.shfill.style.width = `${Math.min(100, (p.shield / CONFIG.stations.shield) * 100)}%`
    }
    h.hp.parentElement!.classList.toggle('veh', !!armour)
    h.lowhp.style.opacity = String(alive && !armour ? Math.max(0, 1 - p.hp / 45) * 0.9 : 0)
    const buffs = (Object.keys(p.buffs) as SkillId[]).filter(k => p.buffs[k] > t)
    this.set('buffs', h.buffs, buffs.map(k => `<div class="buff" style="--c:${SKILLS[k].color}"><b>${T(SKILLS[k].name)}</b><span>${Math.ceil(p.buffs[k] - t)}s</span></div>`).join('') + (t < p.spawnShieldUntil ? `<div class="buff" style="--c:#fff"><b>${L('部署保护', 'Spawn shield')}</b></div>` : ''))
    // Weapon panel.
    const launcher = p.weapon === 'launcher'
    const pistol = p.weapon === 'pistol'
    h.slots.className = `slots ${launcher ? 'w3' : pistol ? 'w2' : 'w1'}`
    h.slots.style.display = veh || seat || gs ? 'none' : ''
    if (gs) {
      this.set('wname', h.wname, L(`${gs.name} · 机炮 + 火箭弹`, `${gs.name} · cannon + rockets`))
      this.set('mag', h.mag, String(gs.rockets))
      this.set('res', h.res, `/ ${gs.maxRockets} · ${gs.grounded ? L('着陆', 'landed') : `${gs.alt} m`}`)
      h.ammo.className = 'ammo veh'
    } else if (veh) {
      this.set('wname', h.wname, L(`${veh.label} · 车载机枪`, `${veh.label} · mounted gun`))
      this.set('mag', h.mag, `${Math.round(Math.abs(veh.speed) * 3.6)}`)
      this.set('res', h.res, 'km/h')
      h.ammo.className = 'ammo veh'
    } else if (seat) {
      if (seat.kind === 'aa') {
        this.set('wname', h.wname, `${seat.name} · ${seat.lockMode ? L('锁定模式 · 防空导弹', 'LOCK · SAM') : L('瞄准模式 · 高射炮', 'AIM · flak')}`)
        this.set('mag', h.mag, seat.lockMode ? (seat.samWait > 0 ? String(Math.ceil(seat.samWait)) : L('就绪', 'RDY')) : '∞')
        this.set('res', h.res, seat.lockMode ? (seat.samWait > 0 ? L('秒', 's') : '') : '')
      } else {
        this.set('wname', h.wname, `${seat.name} · ${L('10 连齐射', '10-rocket salvo')}`)
        this.set('mag', h.mag, seat.salvoLeft > 0 ? String(seat.salvoLeft) : seat.readyWait > 0 ? String(Math.ceil(seat.readyWait)) : L('就绪', 'RDY'))
        this.set('res', h.res, seat.salvoLeft > 0 ? L('发射中', 'firing') : seat.readyWait > 0 ? L('秒装填', 's reload') : '')
      }
      h.ammo.className = 'ammo seat'
    } else if (launcher) {
      this.set('wname', h.wname, launcherName())
      this.set('mag', h.mag, String(p.rocket))
      this.set('res', h.res, `/ ${p.rocketReserve}`)
      h.ammo.className = 'ammo launcher'
    } else if (pistol) {
      this.set('wname', h.wname, pistolName())
      this.set('mag', h.mag, String(p.pmag))
      this.set('res', h.res, '/ ∞')
      h.ammo.className = 'ammo pistol'
    } else {
      this.set('wname', h.wname, weaponName())
      this.set('mag', h.mag, String(p.mag))
      this.set('res', h.res, `/ ${Math.floor(p.reserve)}`)
      h.ammo.className = 'ammo'
    }
    h.res.classList.toggle('low', !veh && !seat && !launcher && !pistol && p.reserve < CONFIG.lowReserve)
    h.mag.classList.toggle('low', !veh && !seat && (launcher ? p.rocket === 0 : pistol ? p.pmag <= 3 : p.mag <= 8))
    // Rifle ammo warning with a bearing to the nearest resupply point.
    const ast = alive && !veh && !seat && p.mode === 'foot' ? g.ammoState : ''
    h.awarn.className = `ammo-warn ${ast}`
    if (ast) {
      const best = g.ammoPoints()[0]
      if (best) {
        const dx = best.x - p.pos.x, dz = best.z - p.pos.z
        const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw)
        const rel = Math.atan2(dx * cy - dz * sy, -dx * sy - dz * cy)
        h.awarnA.style.transform = `rotate(${rel.toFixed(2)}rad)`
        const head = ast === 'dry' ? L('步枪弹药耗尽', 'Rifle dry') : L('步枪备弹不足', 'Rifle ammo low')
        this.set('awarn', h.awarnT, best.d < 5 ? L(`${head} · 已到达${best.name}`, `${head} · at ${best.name}`) : L(`${head} → ${best.name} ${Math.round(best.d)} 米`, `${head} → ${best.name} ${Math.round(best.d)} m`))
      }
    }
    this.set('gn', h.gn, String(p.grenades))
    this.set('rk', h.rk, String(p.rocket + p.rocketReserve))
    h.reload.classList.toggle('on', !veh && !seat && !gs && p.reloading)
    // Crosshair + lock ring.
    const onFoot = p.mode === 'foot' || p.mode === 'heli'
    const gap = 6 + p.spread(t) * 900
    h.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`)
    h.cross.classList.toggle('ads', p.ads > 0.6)
    h.cross.classList.toggle('off', !alive || p.mode === 'drone' || p.mode === 'arty' || p.mode === 'aa')
    h.cross.classList.toggle('veh', !onFoot)
    h.cross.classList.toggle('rl', onFoot && launcher)
    const lockK = onFoot && launcher && p.lockTarget ? Math.min(1, p.lockT / CONFIG.launcher.lockTime) : 0
    h.crossLock.style.setProperty('--k', lockK.toFixed(3))
    h.crossLock.classList.toggle('done', lockK >= 1)
    this.hitTimer -= dt
    if (this.hitTimer <= 0) h.hit.classList.remove('on')
    h.drone.classList.toggle('on', p.mode === 'drone')
    h.aa.classList.toggle('on', p.mode === 'aa')
    if (seat?.kind === 'aa') {
      h.aa.classList.toggle('lockmode', seat.lockMode)
      h.aaLock.style.setProperty('--k', seat.lockK.toFixed(3))
      h.aaLock.classList.toggle('done', seat.lockK >= 1)
      this.set('aam', h.aaMode, seat.lockMode ? L('锁定模式 LOCK', 'LOCK MODE') : L('瞄准模式 AIM', 'AIM MODE'))
    }
    h.arty.classList.toggle('on', p.mode === 'arty')
    if (seat?.kind === 'arty' && seat.cursor) {
      this.set('arty', h.artyCard, `<b>${L('潮汐远程火箭炮', 'TIDE ROCKET BATTERY')}</b><span>${L('目标距离', 'Range')} ${Math.round(seat.cursor.dist)} m · ${L('杀伤半径', 'Blast radius')} ${seat.cursor.r} m</span><span>${seat.readyWait > 0 ? L(`装填 ${Math.ceil(seat.readyWait)} 秒`, `Reloading ${Math.ceil(seat.readyWait)}s`) : L('左键齐射', 'LMB: fire salvo')} · WASD / ${L('鼠标', 'mouse')} · Shift</span>`)
    }
    this.updateMarkers(g.markers(window.innerWidth, window.innerHeight))
    this.miniTick -= dt
    if (this.miniTick <= 0) {
      this.miniTick = 0.08
      this.drawMinimap(g)
    }
    h.board.classList.toggle('on', showBoard)
    if (showBoard) {
      const board = g.units.map(u => ({ name: u.name, team: u.team, kills: u.kills, deaths: u.deaths, captures: u.captures, isPlayer: u.isPlayer }))
      this.set('board', h.board, `<div class="panel"><div class="panel-h">${L('战况', 'Battle')} · ${formatClock(m.timeLeft)} · ${this.matchInfo()}</div><div class="end-board">${this.boardHtml(board.sort((a, b) => b.kills - a.kills))}</div></div>`)
    }
  }

  private updateMarkers(list: Marker[]): void {
    const layer = this.hud.markers
    while (this.markerPool.length < list.length) {
      const d = el('div', 'mk')
      layer.appendChild(d)
      this.markerPool.push(d)
    }
    this.markerPool.forEach((d, i) => {
      const m = list[i]
      if (!m) {
        if (d.style.display !== 'none') d.style.display = 'none'
        return
      }
      d.style.display = ''
      d.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`
      const cls = `mk ${m.kind} ${m.edge ? 'edge' : ''} ${m.kind === 'lock' && (m.progress ?? 0) >= 1 ? 'done' : ''}`
      if (d.className !== cls) d.className = cls
      d.style.setProperty('--c', m.color)
      if (m.kind === 'lock') d.style.setProperty('--k', String(m.progress ?? 0))
      const html = m.kind === 'point'
        ? `<b>${m.label}</b><span>${Math.round(m.dist)}m</span>`
        : m.kind === 'ally' ? (m.dist < 35 && m.label ? `<span>${m.label}</span>` : '')
        : m.kind === 'enemy' ? ''
        : m.kind === 'lock' ? `<i></i><span>${m.label} ${Math.round(m.dist)}m</span>`
        : `<span>${m.label}${m.dist > 8 ? ` ${Math.round(m.dist)}m` : ''}</span>`
      if (d.dataset.h !== html) {
        d.dataset.h = html
        d.innerHTML = html
      }
    })
  }

  // ─── minimap ────────────────────────────────────────────────────────────
  private mm(x: number, z: number): [number, number] {
    const W = this.mini.width, H = this.mini.height
    const minX = LAND.minX - 6, maxX = LAND.maxX + 6
    const minZ = RT.sea ? ISLAND.z - ISLAND.rz - 8 : SEA.minZ + 60
    const maxZ = LAND.maxZ + 4
    return [((x - minX) / (maxX - minX)) * W, ((z - minZ) / (maxZ - minZ)) * H]
  }

  private buildMiniBg(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = this.mini.width
    c.height = this.mini.height
    const g = c.getContext('2d')!
    g.fillStyle = '#123447'
    g.fillRect(0, 0, c.width, c.height)
    const [, sy] = this.mm(0, SHORE_Z)
    g.fillStyle = '#2c3a38'
    g.fillRect(0, sy, c.width, c.height - sy)
    g.fillStyle = 'rgba(126,249,255,0.25)'
    g.fillRect(0, sy - 1, c.width, 2)
    g.strokeStyle = '#4b5760'
    for (const r of ROADS) {
      const [x0, y0] = this.mm(r.x0, r.z0)
      const [x1, y1] = this.mm(r.x1, r.z1)
      g.lineWidth = r.w * 0.8
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1, y1)
      g.stroke()
    }
    // Egg Lake + canal to the sea.
    g.fillStyle = '#1b5570'
    const [cx0, cy0] = this.mm(-CANAL.halfW, SHORE_Z - 1)
    const [cx1, cy1] = this.mm(CANAL.halfW, CANAL.z1 + 1)
    g.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0)
    const [lx, ly] = this.mm(LAKE.x, LAKE.z)
    const [lrx] = this.mm(LAKE.x + LAKE.r, 0)
    const [, lry] = this.mm(0, LAKE.z + LAKE.r)
    g.beginPath()
    g.ellipse(lx, ly, lrx - lx, lry - ly, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#6d7f8c'
    for (const b of BRIDGES) {
      const [bx0, by0] = this.mm(-CANAL.halfW - 1, b.z - b.w / 2)
      const [bx1, by1] = this.mm(CANAL.halfW + 1, b.z + b.w / 2)
      g.fillRect(bx0, by0, bx1 - bx0, by1 - by0)
    }
    if (RT.sea) {
      const [ix, iy] = this.mm(ISLAND.x, ISLAND.z)
      const [irx] = this.mm(ISLAND.x + ISLAND.rx, 0)
      const [, iry] = this.mm(0, ISLAND.z + ISLAND.rz)
      g.fillStyle = '#c9b98a'
      g.beginPath()
      g.ellipse(ix, iy, irx - ix + 1.5, iry - iy + 1.5, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#3f6b45'
      g.beginPath()
      g.ellipse(ix, iy, irx - ix - 1, iry - iy - 1, 0, 0, Math.PI * 2)
      g.fill()
    }
    for (const b of BUILDINGS) {
      const [x0, y0] = this.mm(b.x - b.w / 2, b.z - b.d / 2)
      const [x1, y1] = this.mm(b.x + b.w / 2, b.z + b.d / 2)
      g.fillStyle = b.style === 'pavilion' ? '#8a6040' : b.style === 'lab' ? '#46607a' : b.style === 'club' ? '#3f7a5a' : '#6d7f8c'
      g.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
    for (const b of BASES) {
      const [x, y] = this.mm(b.x, b.z)
      g.fillStyle = b.team === 0 ? 'rgba(255,77,94,0.35)' : 'rgba(63,169,255,0.35)'
      g.beginPath()
      g.arc(x, y, b.r * 0.8, 0, Math.PI * 2)
      g.fill()
    }
    const icon = (x: number, z: number, color: string, glyph: string) => {
      const [px, py] = this.mm(x, z)
      g.fillStyle = color
      g.font = '700 9px "Noto Sans SC", sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(glyph, px, py)
    }
    const en = getLang() === 'en'
    for (const s of STATIONS) icon(s.x, s.z, s.kind === 'supply' ? '#ffa94d' : s.kind === 'heal' ? '#5cff9d' : SKILLS[s.skill!].color, s.kind === 'supply' ? (en ? 'S' : '补') : s.kind === 'heal' ? (en ? '+' : '血') : (en ? 'K' : '技'))
    if (RT.sea) icon(ISLAND_DEPOT.x, ISLAND_DEPOT.z, '#ffa94d', en ? 'S' : '补')
    for (const d of DRONE_PADS) icon(d.x, d.z, '#7ef9ff', '◇')
    for (const h of HELIPADS) icon(h.x, h.z, h.team === 0 ? '#ff8a96' : '#8ccaff', 'H')
    return c
  }

  private drawMinimap(game: Game): void {
    const c = this.mini
    const g = c.getContext('2d')!
    if (!this.miniBg || this.miniBg.height !== c.height) this.miniBg = this.buildMiniBg()
    g.drawImage(this.miniBg, 0, 0)
    const m = game.match
    POINTS.forEach((p, i) => {
      if (i === ISLAND_POINT && !RT.sea) return
      const s = m.points[i]
      const [x, y] = this.mm(p.x, p.z)
      const col = s.contested ? '#ffd35c' : s.owner >= 0 ? TEAM_CSS[s.owner] : '#e8edf2'
      g.strokeStyle = col
      g.lineWidth = 2
      g.beginPath()
      g.arc(x, y, Math.max(5, p.r * 0.8), 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = col
      g.font = `800 ${p.kind === 'egg' ? 10 : 9}px "Noto Sans SC", sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(pointShort(p), x, y)
    })
    if (RT.sea) {
      game.emps.forEach((e, i) => {
        const def = EMPLACEMENTS[i]
        if (!def) return
        const [x, y] = this.mm(e.pos.x, e.pos.z)
        g.fillStyle = !e.alive ? '#555' : e.team >= 0 ? TEAM_CSS[e.team] : '#ffd35c'
        g.beginPath()
        if (e.kind === 'aa') {
          g.moveTo(x, y - 4)
          g.lineTo(x + 4, y + 3)
          g.lineTo(x - 4, y + 3)
        } else g.rect(x - 3.5, y - 3.5, 7, 7)
        g.fill()
      })
    }
    for (const s of game.strikes) {
      const [x, y] = this.mm(s.x, s.z)
      const [rx] = this.mm(s.x + s.r, 0)
      g.strokeStyle = TEAM_CSS[s.team]
      g.fillStyle = s.team === PLAYER_TEAM ? 'rgba(255,77,94,0.18)' : 'rgba(63,169,255,0.22)'
      g.lineWidth = 1.5
      g.beginPath()
      g.arc(x, y, rx - x, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }
    const t = game.time
    for (const v of game.vehicles) {
      if (!v.alive || !v.enabled) continue
      const [x, y] = this.mm(v.pos.x, v.pos.z)
      g.fillStyle = v.driver ? '#ffffff' : v.kind === 'car' ? '#c9d4dd' : v.kind === 'lander' ? '#ffd35c' : '#a9e4ff'
      const sz = v.kind === 'lander' ? 7 : 5
      g.fillRect(x - sz / 2, y - sz / 2, sz, sz)
    }
    for (const h of game.helis) {
      if (!h.alive || !h.enabled) continue
      const [x, y] = this.mm(h.pos.x, h.pos.z)
      g.strokeStyle = TEAM_CSS[h.team]
      g.lineWidth = 1.5
      g.beginPath()
      if (game.gunships.includes(h as never)) {
        // Gunship: diamond with a cross.
        g.moveTo(x, y - 5)
        g.lineTo(x + 5, y)
        g.lineTo(x, y + 5)
        g.lineTo(x - 5, y)
        g.closePath()
      }
      g.moveTo(x - 5, y)
      g.lineTo(x + 5, y)
      g.moveTo(x, y - 5)
      g.lineTo(x, y + 5)
      g.stroke()
    }
    for (const s of game.scouts) {
      if (!s.active) continue
      const [x, y] = this.mm(s.pos.x, s.pos.z)
      g.strokeStyle = TEAM_CSS[s.team]
      g.lineWidth = 1.2
      g.strokeRect(x - 3, y - 3, 6, 6)
    }
    const p = game.player
    for (const u of game.units) {
      if (!u.alive || u === p) continue
      const ally = u.team === p.team
      if (!ally && u.spottedUntil <= t) continue
      const [x, y] = this.mm(u.pos.x, u.pos.z)
      g.fillStyle = TEAM_CSS[u.team]
      g.beginPath()
      g.arc(x, y, ally ? 2.4 : 3, 0, Math.PI * 2)
      g.fill()
    }
    if (p.mode === 'drone') {
      const d = game.drone
      const [x, y] = this.mm(d.pos.x, d.pos.z)
      const [rx] = this.mm(d.pos.x + CONFIG.drone.markRadius, 0)
      g.strokeStyle = 'rgba(126,249,255,0.8)'
      g.setLineDash([3, 3])
      g.beginPath()
      g.arc(x, y, rx - x, 0, Math.PI * 2)
      g.stroke()
      g.setLineDash([])
    }
    const seat = game.seatStatus()
    if (seat?.cursor) {
      const [x, y] = this.mm(seat.cursor.x, seat.cursor.z)
      const [rx] = this.mm(seat.cursor.x + seat.cursor.r, 0)
      g.strokeStyle = '#ffd35c'
      g.lineWidth = 1.5
      g.beginPath()
      g.arc(x, y, rx - x, 0, Math.PI * 2)
      g.stroke()
    }
    if (p.alive || p.mode === 'dead') {
      const [x, y] = this.mm(p.pos.x, p.pos.z)
      const yaw = p.mode === 'vehicle' && game.activeVehicle ? game.activeVehicle.yaw + Math.PI : game.gunshipYaw ?? p.yaw
      g.save()
      g.translate(x, y)
      g.rotate(-yaw)
      g.fillStyle = '#fff'
      g.beginPath()
      g.moveTo(0, -6)
      g.lineTo(4, 4)
      g.lineTo(0, 2)
      g.lineTo(-4, 4)
      g.closePath()
      g.fill()
      g.restore()
    }
  }
}
