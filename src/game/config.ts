import { L } from './i18n'

/** Every tuning number for 金蛋争夺战 lives here. */
export const CONFIG = {
  match: {
    seconds: 600,
    targetScore: 1000,
    /** Seconds a team must keep the Golden Egg to win outright. */
    eggHoldToWin: 120,
    killPoints: 2,
    /** Team points granted every second for each owned point, by kind. */
    tick: { building: 1, egg: 2, island: 1 },
  },
  capture: {
    /** Progress per second for one capturer (a full capture is 0 → 1). */
    rate: 0.14,
    eggRate: 0.09,
    maxUnits: 3,
    decay: 0.05,
  },
  player: {
    radius: 0.4,
    height: 1.75,
    crouchHeight: 1.2,
    eye: 1.62,
    crouchEye: 1.1,
    walk: 6.2,
    sprint: 9.2,
    crouchSpeed: 3.2,
    swimSpeed: 3.4,
    accel: 60,
    airAccel: 14,
    jump: 6.6,
    gravity: -19,
    step: 0.62,
    hp: 100,
    respawn: 4,
    spawnShield: 2.5,
    fov: 74,
    adsFov: 48,
  },
  weapon: {
    mag: 30,
    reserve: 150,
    maxReserve: 210,
    rpm: 620,
    damage: 25,
    headMult: 2.1,
    reload: 2.1,
    range: 240,
    spread: 0.0035,
    moveSpread: 0.028,
    airSpread: 0.06,
    bloomPerShot: 0.006,
    bloomMax: 0.05,
    recoilPitch: 0.013,
    recoilYaw: 0.004,
    recoilRecover: 7,
  },
  /** Shoulder-fired guided missile: hits infantry, vehicles, boats, aircraft and emplacements. */
  launcher: {
    reserve: 3,
    maxReserve: 5,
    reload: 2.4,
    lockTime: 0.8,
    lockCone: 0.1,
    lockRange: 240,
    speed: 62,
    turn: 3.4,
    life: 5,
    radius: 5.5,
    damage: 120,
    /** Extra damage on a direct vehicle / aircraft / emplacement hit. */
    direct: 240,
  },
  grenade: { start: 2, max: 4, fuse: 2.2, radius: 7.5, damage: 115, speed: 19 },
  bots: {
    perTeam: 6,
    hp: 100,
    speed: 5.3,
    fov: 2.4,
    burst: [3, 6] as const,
    fireInterval: 0.12,
    burstPause: [0.45, 1.1] as const,
    regenDelay: 6,
    regen: 6,
    respawn: 6,
  },
  stations: {
    supplyCooldown: 20,
    supplyAmmo: 90,
    skillDuration: 22,
    skillCooldown: 40,
    shield: 60,
    healRate: 24,
    baseHealRate: 30,
  },
  car: { hp: 480, maxSpeed: 24, reverse: 9, accel: 15, brake: 30, turn: 1.9, radius: 1.9, gunDamage: 16, gunInterval: 0.09, ramDamage: 140, respawn: 25 },
  boat: { hp: 300, maxSpeed: 30, reverse: 8, accel: 16, brake: 18, turn: 1.5, radius: 2.2, gunDamage: 14, gunInterval: 0.1, respawn: 25 },
  drone: { duration: 15, cooldown: 35, height: 46, speed: 26, markRadius: 42, markTime: 20, hp: 80 },
  scout: { hp: 70, first: 40, interval: 80, duration: 30, height: 36, radius: 28, markRadius: 34 },
  heli: { hp: 700, cruise: 28, height: 30, supportTime: 16, cooldown: 75, gunDamage: 9, gunInterval: 0.14, range: 60, respawn: 60, enemyFirstCall: 100 },
  /** 海盾防空炮: manual flak (aim mode) or radar-locked SAM (lock mode). */
  aa: {
    hp: 700,
    respawn: 45,
    flakInterval: 0.1,
    flakDamage: 26,
    groundDamage: 24,
    fuse: 5,
    range: 300,
    samReload: 4.5,
    samLock: 1.0,
    samCone: 0.12,
    samSpeed: 78,
    samTurn: 4.6,
    samDamage: 380,
    autoRange: 170,
    autoFlakChance: 0.3,
    autoSamCd: 14,
  },
  /** 潮汐远程火箭炮: long-range area bombardment from the island. */
  artillery: {
    hp: 900,
    respawn: 50,
    cooldown: 32,
    rockets: 10,
    radius: 13,
    rocketDamage: 105,
    blast: 7,
    flight: 3.2,
    range: 280,
    cursorSpeed: 55,
  },
} as const

export type Difficulty = 'easy' | 'normal' | 'hard' | 'elite'
export type BotTuning = {
  reaction: readonly [number, number]
  spread: number
  damage: number
  viewRange: number
  missileCd: readonly [number, number]
  artyInterval: number
  heliInterval: number
}
export const DIFFICULTY: Record<Difficulty, BotTuning> = {
  easy: { reaction: [0.65, 1.2], spread: 0.05, damage: 7, viewRange: 55, missileCd: [22, 34], artyInterval: 80, heliInterval: 150 },
  normal: { reaction: [0.35, 0.75], spread: 0.03, damage: 10, viewRange: 70, missileCd: [13, 20], artyInterval: 58, heliInterval: 110 },
  hard: { reaction: [0.22, 0.5], spread: 0.022, damage: 12, viewRange: 80, missileCd: [9, 14], artyInterval: 46, heliInterval: 90 },
  elite: { reaction: [0.12, 0.3], spread: 0.016, damage: 14, viewRange: 92, missileCd: [6, 10], artyInterval: 38, heliInterval: 75 },
}
export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard', 'elite']
export const difficultyName = (d: Difficulty): string =>
  ({ easy: L('新兵', 'Recruit'), normal: L('老兵', 'Veteran'), hard: L('精英', 'Elite'), elite: L('传奇', 'Legend') })[d]

export type GameMode = 'standard' | 'sea'
export type MatchOptions = { mode: GameMode; perTeam: number; difficulty: Difficulty }

/** Runtime match settings chosen on the title screen (read by bots, AI directors and HUD). */
export const RT: { sea: boolean; perTeam: number; difficulty: Difficulty; bot: BotTuning } = {
  sea: false,
  perTeam: CONFIG.bots.perTeam,
  difficulty: 'normal',
  bot: DIFFICULTY.normal,
}
export function applyOptions(o: MatchOptions): void {
  RT.sea = o.mode === 'sea'
  RT.perTeam = Math.max(2, Math.min(10, Math.round(o.perTeam)))
  RT.difficulty = o.difficulty
  RT.bot = DIFFICULTY[o.difficulty]
}

export const teamName = (t: number): string => (t === 0 ? L('红方 · 赤焰', 'Red · Blaze') : L('蓝方 · 海鹰', 'Blue · Sea Hawk'))
export const teamShort = (t: number): string => (t === 0 ? L('红方', 'Red') : L('蓝方', 'Blue'))
export const weaponName = (): string => L('KT-9 脉冲步枪', 'KT-9 Pulse Rifle')
export const launcherName = (): string => L('飞鱼-2 便携导弹', 'Flyfish-2 Missile')
export const TEAM_COLORS = [0xff4d5e, 0x3fa9ff] as const
export const TEAM_CSS = ['#ff4d5e', '#3fa9ff'] as const
export const NEUTRAL_COLOR = 0xffd35c
export const PLAYER_TEAM = 0
