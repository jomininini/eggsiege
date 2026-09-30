import type { Audio } from '../engine/audio'
import type { SaveData, SaveStore } from '../engine/save'
import { CONFIG, PLAYER_TEAM, TEAM_CSS, TEAM_NAMES, TEAM_SHORT } from '../game/config'
import type { FeedEntry, Game, MatchResult, Marker, Toast } from '../game/game'
import { BASES, BUILDINGS, DRONE_PADS, HELIPADS, LAND, POINTS, ROADS, SEA, SHORE_Z, SKILLS, STATIONS, type SkillId } from '../game/map'
import { eggIndex, formatClock } from '../game/rules'

export type Screen = 'boot' | 'title' | 'hud' | 'pause' | 'end'
export type UiActions = {
  play(): void
  restart(): void
  resume(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
}

const REASONS: Record<string, string> = {
  egg: '守住金蛋直至倒计时结束',
  score: '率先达到目标积分',
  time: '作战时间结束，积分领先',
  '': '',
}

const CONTROLS: [string, string][] = [
  ['W A S D', '移动 / 驾驶'],
  ['鼠标', '瞄准视角'],
  ['左键', '射击'],
  ['右键', '机瞄（ADS）'],
  ['R', '换弹'],
  ['Shift', '冲刺 / 无人机加速'],
  ['空格', '跳跃'],
  ['C / Ctrl', '蹲伏（更稳）'],
  ['G', '投掷手雷'],
  ['E / F', '交互：上下载具、起飞无人机、登直升机'],
  ['1 - 5', '选择直升机目标据点'],
  ['Tab', '战况计分板'],
  ['Esc / P', '暂停'],
]

const LEGEND: [string, string, string][] = [
  ['#ffd35c', '金蛋 · 主控点', `中央高锟会议中心。占领每秒 +${CONFIG.match.tick.egg} 分，守满 ${CONFIG.match.eggHoldToWin} 秒直接获胜。`],
  ['#e8edf2', 'A B C D 建筑据点', '机器人中心、InnoCell、5E、大展览厅，每秒 +1 分。'],
  ['#ffa94d', '餐厅 · 补给点', '海滨餐厅、海港茶餐厅、美食广场：补满弹药，手雷 +2。'],
  ['#9d8cff', '科技公司 · 技能点', '量子扫描、纳米护盾、智能稳定、神经加速，持续 22 秒。'],
  ['#5cff9d', '会所 · 回血点', '站在会所泳池平台上持续恢复生命。'],
  ['#7ef9ff', '屋顶无人机坪', '10W、20E 屋顶（外挂楼梯上去），俯视侦察并标记敌人。'],
  ['#ff4d5e', '直升机 / 战车 / 快艇', '基地停机坪机降突击；道路战车、码头快艇可从海上登陆。'],
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
  private markerPool: HTMLDivElement[] = []
  private cache = new Map<string, string>()
  private hitTimer = 0
  private hurtEls: HTMLDivElement[] = []
  private miniTick = 0

  constructor(private readonly save: SaveStore, private readonly audio: Audio, private readonly actions: UiActions) {
    this.root.lang = 'zh-CN'
    document.documentElement.lang = 'zh-CN'
    this.buildBoot()
    this.buildTitle()
    this.buildHud()
    this.buildPause()
    this.buildEnd()
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
  }
  get screen(): Screen {
    return this.current
  }

  setBootProgress(v: number): void {
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

  private buildBoot(): void {
    const s = this.screen_('boot', 'boot')
    s.innerHTML = `<div class="boot-card"><div class="logo-egg"></div><h1>金蛋争夺战</h1><p>正在部署科学园战区…</p><div class="bar"><i></i></div></div>`
  }

  private buildTitle(): void {
    const s = this.screen_('title', 'title')
    s.innerHTML = `
      <div class="title-wrap">
        <div class="brand">
          <div class="kicker">临海创科园区 · 战术据点争夺</div>
          <h1><span class="gold">金蛋</span>争夺战</h1>
          <div class="sub">科学园前线</div>
        </div>
        <div class="brief panel">
          <div class="panel-h">任务简报</div>
          <p>吐露港畔的创科园区被划为演习战区。<b class="r">红方 · 赤焰</b> 与 <b class="b">蓝方 · 海鹰</b> 各 6 人，围绕五个据点展开争夺——核心是园区中央、十根白柱托起的<b class="g">金蛋</b>。</p>
          <ul class="goals">
            <li><i>01</i>占领据点每秒累积积分，先到 <b>${CONFIG.match.targetScore}</b> 分获胜</li>
            <li><i>02</i>或者占领<b class="g">金蛋</b>并连续守住 <b>${CONFIG.match.eggHoldToWin}</b> 秒，直接取胜</li>
            <li><i>03</i>利用餐厅补给、科技公司技能、会所回血、屋顶无人机、直升机机降与海上登陆打开局面</li>
          </ul>
          <div class="btns">
            <button class="btn primary" data-a="play">开始作战</button>
            <button class="btn" data-a="howto">操作与地图说明</button>
            <button class="btn" data-a="settings">设置</button>
          </div>
          <div class="career"></div>
          <div class="hint">点击“开始作战”后鼠标将被锁定用于瞄准，按 Esc 可随时暂停。</div>
        </div>
      </div>
      <div class="modal howto">
        <div class="panel wide">
          <div class="panel-h">操作说明 <button class="x" data-a="close">×</button></div>
          <div class="cols">
            <div><h3>基础操作</h3><div class="keys">${CONTROLS.map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div></div>
            <div><h3>园区战术要素</h3><div class="legend">${LEGEND.map(([c, t, d]) => `<div><i style="--c:${c}"></i><b>${t}</b><span>${d}</span></div>`).join('')}</div></div>
          </div>
          <div class="tips">小技巧：据点内人数越多占领越快；敌我同时在场时进度冻结。敌方据点需先“中立化”再占领。蓝方直升机会定期飞来压制，用步枪、车载机枪集火可将其击落。</div>
        </div>
      </div>
      <div class="modal settings-m"><div class="panel">${this.settingsHtml()}<div class="btns"><button class="btn primary" data-a="close">完成</button></div></div></div>`
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
    this.bindSettings(s)
    this.updateCareer()
  }

  private updateCareer(): void {
    const d = this.save.data
    const c = this.screens.get('title')?.querySelector('.career')
    if (c) c.innerHTML = d.matches ? `战绩：${d.matches} 场 · 胜 ${d.wins} · 单局最多击倒 ${d.bestKills}` : ''
  }

  private settingsHtml(): string {
    const d = this.save.data
    return `<div class="panel-h">设置</div>
      <div class="settings">
        <label>鼠标灵敏度 <input type="range" min="0.2" max="3" step="0.05" data-s="sensitivity" value="${d.sensitivity}"><em></em></label>
        <label>音乐音量 <input type="range" min="0" max="1" step="0.05" data-s="musicVolume" value="${d.musicVolume}"><em></em></label>
        <label>音效音量 <input type="range" min="0" max="1" step="0.05" data-s="sfxVolume" value="${d.sfxVolume}"><em></em></label>
        <label>画质 <select data-s="quality"><option value="low">流畅</option><option value="medium">均衡</option><option value="high">高清（泛光）</option></select></label>
        <label class="chk"><input type="checkbox" data-s="invertY" ${d.invertY ? 'checked' : ''}> 反转 Y 轴</label>
        <label class="chk"><input type="checkbox" data-s="muted" ${d.muted ? 'checked' : ''}> 静音</label>
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
        // Keep other copies of the same control in sync.
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
      <div class="panel-h">作战暂停</div>
      <div class="btns col">
        <button class="btn primary" data-a="resume">继续作战</button>
        <button class="btn" data-a="restart">重新开始</button>
        <button class="btn" data-a="quit">返回标题</button>
      </div>
      ${this.settingsHtml()}
      <div class="mini-keys">${CONTROLS.slice(0, 11).map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('')}</div>
    </div>`
    s.querySelector('[data-a=resume]')!.addEventListener('click', () => this.actions.resume())
    s.querySelector('[data-a=restart]')!.addEventListener('click', () => this.actions.restart())
    s.querySelector('[data-a=quit]')!.addEventListener('click', () => this.actions.quit())
    this.bindSettings(s)
  }

  private buildEnd(): void {
    const s = this.screen_('end', 'end')
    s.innerHTML = `<div class="panel end-panel"><div class="end-banner"></div><div class="end-reason"></div><div class="end-score"></div><div class="end-stats"></div><div class="end-board"></div>
      <div class="btns"><button class="btn primary" data-a="restart">再战一局</button><button class="btn" data-a="quit">返回标题</button></div></div>`
    s.querySelector('[data-a=restart]')!.addEventListener('click', () => this.actions.restart())
    s.querySelector('[data-a=quit]')!.addEventListener('click', () => this.actions.quit())
  }

  private showEnd(r: MatchResult): void {
    const s = this.screens.get('end')!
    const win = r.winner === PLAYER_TEAM
    const draw = r.winner < 0
    const banner = s.querySelector<HTMLElement>('.end-banner')!
    banner.className = `end-banner ${draw ? 'draw' : win ? 'win' : 'lose'}`
    banner.innerHTML = draw ? '平 局' : win ? '胜 利' : '失 败'
    s.querySelector('.end-reason')!.innerHTML = draw ? '双方积分相同' : `${TEAM_NAMES[r.winner]} ${REASONS[r.reason]}`
    s.querySelector('.end-score')!.innerHTML = `<b style="color:${TEAM_CSS[0]}">${Math.floor(r.scores[0])}</b><span>积分</span><b style="color:${TEAM_CSS[1]}">${Math.floor(r.scores[1])}</b><em>作战时长 ${formatClock(r.time)}</em>`
    const p = r.player
    s.querySelector('.end-stats')!.innerHTML = [
      ['击倒', p.kills], ['阵亡', p.deaths], ['占领', p.captures], ['命中率', `${Math.round(p.accuracy * 100)}%`], ['爆头', p.headshots], ['伤害', p.damage],
    ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')
    s.querySelector('.end-board')!.innerHTML = this.boardHtml(r.board)
    const d = this.save.data
    this.save.update({ matches: d.matches + 1, wins: d.wins + (win ? 1 : 0), bestKills: Math.max(d.bestKills, p.kills) })
    this.updateCareer()
  }

  private boardHtml(board: MatchResult['board']): string {
    const cols = [0, 1].map(team => `<div class="team t${team}"><div class="th">${TEAM_NAMES[team]}</div><div class="row h"><span>队员</span><span>击倒</span><span>阵亡</span><span>占领</span></div>${board
      .filter(b => b.team === team)
      .map(b => `<div class="row ${b.isPlayer ? 'me' : ''}"><span>${b.name}</span><span>${b.kills}</span><span>${b.deaths}</span><span>${b.captures}</span></div>`)
      .join('')}</div>`)
    return cols.join('')
  }

  // ─── HUD ────────────────────────────────────────────────────────────────
  private buildHud(): void {
    const s = this.screen_('hud', 'hud')
    s.innerHTML = `
      <div class="vignette"></div><div class="lowhp"></div><div class="drone-fx"><i></i></div>
      <div class="markers"></div>
      <div class="top">
        <div class="scorebar">
          <div class="team t0"><span class="nm">${TEAM_SHORT[0]}</span><b class="sc0">0</b><div class="goal"><i class="g0"></i></div></div>
          <div class="clock"><b class="time">10:00</b><span class="target">目标 ${CONFIG.match.targetScore}</span></div>
          <div class="team t1"><div class="goal"><i class="g1"></i></div><b class="sc1">0</b><span class="nm">${TEAM_SHORT[1]}</span></div>
        </div>
        <div class="chips">${POINTS.map((p, i) => `<div class="chip ${p.kind}" data-i="${i}" title="${p.name}"><b>${p.short}</b><i></i></div>`).join('')}</div>
        <div class="eggbar"><span class="lbl"></span><div class="track"><i></i></div></div>
        <div class="toasts"></div>
      </div>
      <div class="minimap panel-lite"><canvas width="240" height="184"></canvas><div class="mm-l">科学园战区</div></div>
      <div class="feed"></div>
      <div class="center">
        <div class="cross"><i class="u"></i><i class="d"></i><i class="l"></i><i class="r"></i><i class="dot"></i></div>
        <div class="hit"><i></i><i></i><i></i><i></i></div>
        <div class="hurts"></div>
      </div>
      <div class="capture"><div class="cap-name"></div><div class="cap-track"><i></i></div><div class="cap-state"></div></div>
      <div class="prompt"></div>
      <div class="respawn"><b>你已阵亡</b><span></span></div>
      <div class="vitals">
        <div class="hp-row"><span class="ic">+</span><b class="hp">100</b><div class="hpbar"><i class="hpfill"></i><i class="shfill"></i></div></div>
        <div class="buffs"></div>
      </div>
      <div class="ammo">
        <div class="wname">${CONFIG.weapon.name}</div>
        <div class="ammo-row"><b class="mag">30</b><span class="res">/ 150</span></div>
        <div class="gren"><span>手雷</span><b class="gn">2</b><span class="reload">换弹中…</span></div>
      </div>
      <div class="scoreboard"></div>`
    const q = <T extends HTMLElement>(sel: string) => s.querySelector<T>(sel)!
    this.hud = {
      sc0: q('.sc0'), sc1: q('.sc1'), g0: q('.g0'), g1: q('.g1'), time: q('.time'), eggbar: q('.eggbar'), eggLbl: q('.eggbar .lbl'), eggFill: q('.eggbar .track i'),
      toasts: q('.toasts'), feed: q('.feed'), cross: q('.cross'), hit: q('.hit'), hurts: q('.hurts'), capture: q('.capture'), capName: q('.cap-name'),
      capFill: q('.cap-track i'), capState: q('.cap-state'), prompt: q('.prompt'), respawn: q('.respawn'), respawnT: q('.respawn span'), hp: q('.hp'),
      hpfill: q('.hpfill'), shfill: q('.shfill'), buffs: q('.buffs'), mag: q('.mag'), res: q('.res'), gn: q('.gn'), reload: q('.reload'), wname: q('.wname'),
      markers: q('.markers'), lowhp: q('.lowhp'), drone: q('.drone-fx'), board: q('.scoreboard'), chips: q('.chips'), ammo: q('.ammo'),
    }
    this.mini = q<HTMLCanvasElement>('.minimap canvas')
  }

  private set(key: string, el: HTMLElement, html: string): void {
    if (this.cache.get(key) === html) return
    this.cache.set(key, html)
    el.innerHTML = html
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
    const d = el('div', 'kill', `<b style="color:${TEAM_CSS[e.killerTeam] ?? '#ccc'}">${e.killer}</b><span class="w">${e.weapon}${e.head ? ' ✦爆头' : ''}</span><b style="color:${TEAM_CSS[e.victimTeam]}">${e.victim}</b>`)
    if (e.killer === '你' || e.victim === '你') d.classList.add('me')
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
    this.hurtEls.push(d)
    setTimeout(() => {
      d.remove()
      this.hurtEls = this.hurtEls.filter(x => x !== d)
    }, 900)
    this.screens.get('hud')!.classList.remove('flash')
    void this.screens.get('hud')!.offsetWidth
    this.screens.get('hud')!.classList.add('flash')
  }

  private click(): void {
    this.audio.unlock()
    this.audio.play('ui')
  }

  /** Per-frame HUD refresh. */
  update(dt: number, showBoard: boolean): void {
    const g = this.game
    if (!g || (this.current !== 'hud' && this.current !== 'pause' && this.current !== 'end')) return
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
    // Point chips.
    m.points.forEach((s, i) => {
      const chip = h.chips.children[i] as HTMLElement
      const cls = `chip ${s.kind} o${s.owner} ${s.contested ? 'contested' : ''} ${s.capturing >= 0 && s.capturing !== s.owner ? `cap c${s.capturing}` : ''}`
      if (chip.className !== cls) chip.className = cls
      const fill = chip.querySelector('i') as HTMLElement
      fill.style.width = `${s.progress * 100}%`
      fill.style.background = s.owner >= 0 ? TEAM_CSS[s.owner] : s.progressTeam >= 0 ? TEAM_CSS[s.progressTeam] : '#e8edf2'
    })
    const egg = m.points[eggIndex(m)]
    if (egg.owner >= 0) {
      h.eggbar.className = `eggbar on t${egg.owner}`
      this.set('eggl', h.eggLbl, `${TEAM_SHORT[egg.owner]}控制金蛋 · 守卫 ${Math.floor(m.eggHold)}/${CONFIG.match.eggHoldToWin} 秒`)
      h.eggFill.style.width = `${(m.eggHold / CONFIG.match.eggHoldToWin) * 100}%`
    } else h.eggbar.className = 'eggbar'
    // Capture bar.
    const zi = g.playerZone()
    if (zi >= 0) {
      const s = m.points[zi]
      const pt = POINTS[zi]
      h.capture.classList.add('on')
      this.set('capn', h.capName, `${pt.short === '蛋' ? '' : pt.short + ' · '}${pt.name}`)
      const mineOwned = s.owner === PLAYER_TEAM
      let state = ''
      if (s.contested) state = '争夺中 · 清除区域内敌人'
      else if (mineOwned && s.progress >= 1) state = '已控制 · 守住据点'
      else if (mineOwned) state = '加固中…'
      else if (s.owner >= 0) state = '中立化敌方据点…'
      else state = '占领中…'
      this.set('caps', h.capState, state)
      h.capState.className = `cap-state ${s.contested ? 'warn' : ''}`
      const fillTeam = s.owner >= 0 ? s.owner : s.progressTeam
      h.capFill.style.width = `${s.progress * 100}%`
      h.capFill.style.background = fillTeam >= 0 ? TEAM_CSS[fillTeam] : '#e8edf2'
    } else h.capture.classList.remove('on')
    this.set('prompt', h.prompt, g.prompt)
    h.prompt.classList.toggle('on', !!g.prompt)
    // Vitals.
    const alive = p.alive
    h.respawn.classList.toggle('on', !alive && g.state === 'playing')
    if (!alive) this.set('rsp', h.respawnT, `${Math.max(0, Math.ceil(p.respawnAt - t))} 秒后在红方部署区重新部署`)
    const veh = g.activeVehicle
    if (veh) {
      this.set('hp', h.hp, String(Math.ceil(veh.hp)))
      h.hpfill.style.width = `${(veh.hp / veh.maxHp) * 100}%`
      h.shfill.style.width = '0%'
    } else {
      this.set('hp', h.hp, String(Math.ceil(p.hp)))
      h.hpfill.style.width = `${(p.hp / p.maxHp) * 100}%`
      h.shfill.style.width = `${Math.min(100, (p.shield / CONFIG.stations.shield) * 100)}%`
    }
    h.hp.parentElement!.classList.toggle('veh', !!veh)
    h.lowhp.style.opacity = String(alive && !veh ? Math.max(0, 1 - p.hp / 45) * 0.9 : 0)
    const buffs = (Object.keys(p.buffs) as SkillId[]).filter(k => p.buffs[k] > t)
    this.set('buffs', h.buffs, buffs.map(k => `<div class="buff" style="--c:${SKILLS[k].color}"><b>${SKILLS[k].name}</b><span>${Math.ceil(p.buffs[k] - t)}s</span></div>`).join('') + (t < p.spawnShieldUntil ? '<div class="buff" style="--c:#fff"><b>部署保护</b></div>' : ''))
    if (veh) {
      this.set('wname', h.wname, `${veh.label} · 车载机枪`)
      this.set('mag', h.mag, `${Math.round(Math.abs(veh.speed) * 3.6)}`)
      this.set('res', h.res, 'km/h')
      h.ammo.classList.add('veh')
    } else {
      this.set('wname', h.wname, CONFIG.weapon.name)
      this.set('mag', h.mag, String(p.mag))
      this.set('res', h.res, `/ ${Math.floor(p.reserve)}`)
      h.ammo.classList.remove('veh')
    }
    h.mag.classList.toggle('low', !veh && p.mag <= 8)
    this.set('gn', h.gn, String(p.grenades))
    h.reload.classList.toggle('on', p.reloading)
    // Crosshair.
    const onFoot = p.mode === 'foot' || p.mode === 'heli'
    const gap = 6 + p.spread(t) * 900
    h.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`)
    h.cross.classList.toggle('ads', p.ads > 0.6)
    h.cross.classList.toggle('off', !alive || p.mode === 'drone')
    h.cross.classList.toggle('veh', !onFoot)
    this.hitTimer -= dt
    if (this.hitTimer <= 0) h.hit.classList.remove('on')
    h.drone.classList.toggle('on', p.mode === 'drone')
    // Markers.
    this.updateMarkers(g.markers(window.innerWidth, window.innerHeight))
    // Minimap (throttled).
    this.miniTick -= dt
    if (this.miniTick <= 0) {
      this.miniTick = 0.08
      this.drawMinimap(g)
    }
    h.board.classList.toggle('on', showBoard)
    if (showBoard) {
      const board = g.units.map(u => ({ name: u.name, team: u.team, kills: u.kills, deaths: u.deaths, captures: u.captures, isPlayer: u.isPlayer }))
      this.set('board', h.board, `<div class="panel"><div class="panel-h">战况 · ${formatClock(m.timeLeft)}</div><div class="end-board">${this.boardHtml(board.sort((a, b) => b.kills - a.kills))}</div></div>`)
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
      const cls = `mk ${m.kind} ${m.edge ? 'edge' : ''}`
      if (d.className !== cls) d.className = cls
      d.style.setProperty('--c', m.color)
      const html = m.kind === 'point'
        ? `<b>${m.label}</b><span>${Math.round(m.dist)}m</span>`
        : m.kind === 'ally' ? (m.dist < 35 ? `<span>${m.label}</span>` : '')
        : m.kind === 'enemy' ? '' : `<span>${m.label}${m.dist > 8 ? ` ${Math.round(m.dist)}m` : ''}</span>`
      if (d.dataset.h !== html) {
        d.dataset.h = html
        d.innerHTML = html
      }
    })
  }

  // ─── minimap ────────────────────────────────────────────────────────────
  private mm(x: number, z: number): [number, number] {
    const W = this.mini.width, H = this.mini.height
    const minX = LAND.minX - 6, maxX = LAND.maxX + 6, minZ = SEA.minZ + 60, maxZ = LAND.maxZ + 4
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
    for (const s of STATIONS) icon(s.x, s.z, s.kind === 'supply' ? '#ffa94d' : s.kind === 'heal' ? '#5cff9d' : SKILLS[s.skill!].color, s.kind === 'supply' ? '补' : s.kind === 'heal' ? '血' : '技')
    for (const d of DRONE_PADS) icon(d.x, d.z, '#7ef9ff', '◇')
    for (const h of HELIPADS) icon(h.x, h.z, h.team === 0 ? '#ff8a96' : '#8ccaff', 'H')
    return c
  }

  private drawMinimap(game: Game): void {
    const c = this.mini
    const g = c.getContext('2d')!
    if (!this.miniBg) this.miniBg = this.buildMiniBg()
    g.drawImage(this.miniBg, 0, 0)
    const m = game.match
    POINTS.forEach((p, i) => {
      const s = m.points[i]
      const [x, y] = this.mm(p.x, p.z)
      const col = s.contested ? '#ffd35c' : s.owner >= 0 ? TEAM_CSS[s.owner] : '#e8edf2'
      g.strokeStyle = col
      g.lineWidth = 2
      g.beginPath()
      g.arc(x, y, p.r * 0.8, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = col
      g.font = `800 ${p.kind === 'egg' ? 10 : 9}px "Noto Sans SC", sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(p.short, x, y)
    })
    const t = game.time
    for (const v of game.vehicles) {
      if (!v.alive) continue
      const [x, y] = this.mm(v.pos.x, v.pos.z)
      g.fillStyle = v.driver ? '#ffffff' : v.kind === 'car' ? '#c9d4dd' : '#a9e4ff'
      g.fillRect(x - 2.5, y - 2.5, 5, 5)
    }
    for (const h of game.helis) {
      if (!h.alive) continue
      const [x, y] = this.mm(h.pos.x, h.pos.z)
      g.strokeStyle = TEAM_CSS[h.team]
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(x - 5, y)
      g.lineTo(x + 5, y)
      g.moveTo(x, y - 5)
      g.lineTo(x, y + 5)
      g.stroke()
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
    if (p.alive || p.mode === 'dead') {
      const [x, y] = this.mm(p.pos.x, p.pos.z)
      const yaw = p.mode === 'vehicle' && game.activeVehicle ? game.activeVehicle.yaw + Math.PI : p.yaw
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
