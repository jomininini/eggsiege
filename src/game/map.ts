/**
 * Map layout of the Science Park battlefield (metres). +X = east, +Z = south, the sea (Tolo
 * Harbour) lies north of the promenade at z < SHORE_Z. Every gameplay location is data here so
 * the world builder, AI navigation, minimap and tests read one source.
 */
export const SHORE_Z = -78
export const LAND = { minX: -130, maxX: 130, minZ: SHORE_Z, maxZ: 95 }
export const SEA = { minX: -155, maxX: 155, minZ: -170, maxZ: SHORE_Z - 1.5 }
export const WATER_Y = -1.2
export const SEA_FLOOR = -1.55

export type PointDef = { id: string; name: string; short: string; kind: 'building' | 'egg'; x: number; z: number; r: number }
export const POINTS: PointDef[] = [
  { id: 'rcc', name: '机器人技术促进中心', short: 'A', kind: 'building', x: -62, z: -36, r: 9 },
  { id: 'innocell', name: 'InnoCell 创科公寓', short: 'B', kind: 'building', x: -62, z: 46, r: 9 },
  { id: 'egg', name: '金蛋 · 高锟会议中心', short: '蛋', kind: 'egg', x: 0, z: 0, r: 13 },
  { id: '5e', name: '5E 大楼', short: 'C', kind: 'building', x: 62, z: -36, r: 9 },
  { id: 'hall', name: '大展览厅', short: 'D', kind: 'building', x: 62, z: 46, r: 9 },
]
export const EGG = { x: 0, z: 0, rx: 13, ry: 7, rz: 8.5, cy: 15.5 }

export type SkillId = 'scan' | 'shield' | 'steady' | 'rush'
export const SKILLS: Record<SkillId, { name: string; desc: string; color: string }> = {
  scan: { name: '量子扫描', desc: '持续标记附近敌人', color: '#7ef9ff' },
  shield: { name: '纳米护盾', desc: '获得 60 点护盾', color: '#9d8cff' },
  steady: { name: '智能稳定', desc: '后坐力与散布大幅降低', color: '#ffd35c' },
  rush: { name: '神经加速', desc: '移动速度提升 35%', color: '#5cff9d' },
}

export type StationKind = 'supply' | 'skill' | 'heal'
export type StationDef = { id: string; kind: StationKind; name: string; x: number; z: number; r: number; skill?: SkillId }
export const STATIONS: StationDef[] = [
  { id: 'rest-w', kind: 'supply', name: '海滨餐厅', x: -36, z: -56, r: 3.6 },
  { id: 'rest-e', kind: 'supply', name: '海港茶餐厅', x: 36, z: -56, r: 3.6 },
  { id: 'rest-s', kind: 'supply', name: '园区美食广场', x: 0, z: 78, r: 3.6 },
  { id: 'lab-scan', kind: 'skill', skill: 'scan', name: '创科体验馆', x: -30, z: 33.5, r: 3.2 },
  { id: 'lab-steady', kind: 'skill', skill: 'steady', name: '芯擎半导体', x: 30, z: 33.5, r: 3.2 },
  { id: 'lab-shield', kind: 'skill', skill: 'shield', name: '纳米盾材料', x: -96, z: -35.5, r: 3.2 },
  { id: 'lab-rush', kind: 'skill', skill: 'rush', name: '启航生物科技', x: 96, z: -35.5, r: 3.2 },
  { id: 'club', kind: 'heal', name: '科学园会所', x: 0, z: 53, r: 8 },
]

export type BuildingStyle = 'glass' | 'pilotis' | 'hall' | 'lab' | 'pavilion' | 'club' | 'rooftop'
export type BuildingDef = { id: string; name: string; x: number; z: number; w: number; d: number; h: number; style: BuildingStyle; tint: number; label?: string }
export const BUILDINGS: BuildingDef[] = [
  { id: 'rcc', name: '机器人技术促进中心', x: -62, z: -36, w: 30, d: 22, h: 9, style: 'hall', tint: 0x9fb4c8, label: 'RCC 机器人中心' },
  { id: 'hall', name: '大展览厅', x: 62, z: 46, w: 30, d: 22, h: 10, style: 'hall', tint: 0xb8c4d0, label: '大展览厅' },
  { id: 'innocell', name: 'InnoCell', x: -62, z: 46, w: 22, d: 16, h: 34, style: 'pilotis', tint: 0xd8dde3, label: 'InnoCell' },
  { id: '5e', name: '5E 大楼', x: 62, z: -36, w: 24, d: 18, h: 28, style: 'pilotis', tint: 0x7fb6d6, label: '5E' },
  { id: '10w', name: '10W 大楼', x: -28, z: -34, w: 16, d: 14, h: 10, style: 'rooftop', tint: 0x86c1cf, label: '10W' },
  { id: '20e', name: '20E 大楼', x: 28, z: -34, w: 16, d: 14, h: 10, style: 'rooftop', tint: 0x86c1cf, label: '20E' },
  { id: '16w', name: '16W 大楼', x: -40, z: 4, w: 10, d: 12, h: 18, style: 'glass', tint: 0x6aa6c4, label: '16W' },
  { id: '17e', name: '17E 大楼', x: 40, z: 4, w: 10, d: 12, h: 18, style: 'glass', tint: 0x6aa6c4, label: '17E' },
  { id: 'exp', name: '创科体验馆', x: -30, z: 42, w: 16, d: 12, h: 8, style: 'lab', tint: 0x2fd3c4, label: '创科体验馆' },
  { id: 'chip', name: '芯擎半导体', x: 30, z: 42, w: 16, d: 12, h: 8, style: 'lab', tint: 0xffc445, label: '芯擎半导体' },
  { id: 'nano', name: '纳米盾材料', x: -96, z: -44, w: 12, d: 12, h: 8, style: 'lab', tint: 0x9d8cff, label: '纳米盾材料' },
  { id: 'bio', name: '启航生物科技', x: 96, z: -44, w: 12, d: 12, h: 8, style: 'lab', tint: 0x5cff9d, label: '启航生物' },
  { id: 'rest-w', name: '海滨餐厅', x: -36, z: -64, w: 12, d: 7, h: 4.5, style: 'pavilion', tint: 0xff9a52, label: '海滨餐厅' },
  { id: 'rest-e', name: '海港茶餐厅', x: 36, z: -64, w: 12, d: 7, h: 4.5, style: 'pavilion', tint: 0xff9a52, label: '海港茶餐厅' },
  { id: 'rest-s', name: '园区美食广场', x: 0, z: 86, w: 16, d: 8, h: 5, style: 'pavilion', tint: 0xff9a52, label: '美食广场' },
  { id: 'club', name: '科学园会所', x: 0, z: 66, w: 24, d: 10, h: 7, style: 'club', tint: 0xf1e6d2, label: '会所' },
  { id: 's1', name: '19W 大楼', x: -100, z: 74, w: 18, d: 14, h: 30, style: 'glass', tint: 0x5f93b5 },
  { id: 's2', name: '22E 大楼', x: 100, z: 74, w: 18, d: 14, h: 30, style: 'glass', tint: 0x5f93b5 },
  { id: 's3', name: '12W 大楼', x: -40, z: 80, w: 16, d: 10, h: 14, style: 'glass', tint: 0x77a9c2 },
  { id: 's4', name: '15E 大楼', x: 40, z: 80, w: 16, d: 10, h: 14, style: 'glass', tint: 0x77a9c2 },
]

/** Rooftop drone pads: on 10W and 20E, reached by the external stairs. */
export const DRONE_PADS = [
  { id: 'drone-w', name: '10W 屋顶无人机坪', x: -28, y: 10, z: -36, r: 2.6 },
  { id: 'drone-e', name: '20E 屋顶无人机坪', x: 28, y: 10, z: -36, r: 2.6 },
]

export const BASES = [
  { team: 0, x: -116, z: 8, r: 10 },
  { team: 1, x: 116, z: 8, r: 10 },
]
export const HELIPADS = [
  { team: 0, x: -112, z: 48, r: 5 },
  { team: 1, x: 112, z: 48, r: 5 },
]
export const CAR_SPAWNS = [
  { team: 0, x: -98, z: 25, yaw: Math.PI / 2 },
  { team: 1, x: 98, z: 25, yaw: -Math.PI / 2 },
  { team: 0, x: -86, z: -10, yaw: Math.PI },
  { team: 1, x: 86, z: -10, yaw: Math.PI },
]
export const PIERS = [
  { team: 0, x: -100, w: 6, len: 18 },
  { team: 1, x: 100, w: 6, len: 18 },
]
export const BOAT_SPAWNS = [
  { team: 0, x: -93, z: -88, yaw: Math.PI / 2 },
  { team: 1, x: 93, z: -88, yaw: -Math.PI / 2 },
]

export type RoadDef = { x0: number; z0: number; x1: number; z1: number; w: number }
export const ROADS: RoadDef[] = [
  { x0: -128, z0: 25, x1: 128, z1: 25, w: 10 },
  { x0: -86, z0: -66, x1: -86, z1: 92, w: 9 },
  { x0: 86, z0: -66, x1: 86, z1: 92, w: 9 },
  { x0: -86, z0: -50, x1: 86, z1: -50, w: 8 },
  { x0: -12, z0: 25, x1: -12, z1: 92, w: 7 },
  { x0: 12, z0: 25, x1: 12, z1: 92, w: 7 },
]

export const isSea = (_x: number, z: number) => z < SHORE_Z
export const baseGround = (x: number, z: number) => (isSea(x, z) ? SEA_FLOOR : 0)

/** Where the helicopter can insert the player (and where the enemy calls strikes). */
export const heliTargets = () => POINTS.map((p, i) => ({ index: i, name: p.name, x: p.x, z: p.z + (p.kind === 'egg' ? 16 : 0) }))
