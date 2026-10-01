/**
 * Map layout of the Science Park battlefield (metres). +X = east, +Z = south, the sea (Tolo
 * Harbour) lies north of the promenade at z < SHORE_Z. Every gameplay location is data here so
 * the world builder, AI navigation, minimap and tests read one source.
 *
 * Round 2: a lake sits under the Golden Egg and joins the sea through a canal; 出海岛 (Offshore
 * Isle) lies just off the promenade with AA guns, a rocket battery and a patrol-boat jetty.
 */
import { L, type Txt } from './i18n'

export const SHORE_Z = -78
export const LAND = { minX: -130, maxX: 130, minZ: SHORE_Z, maxZ: 95 }
/** Open sea: 1.5x the original 310 x 92 m (round 4). */
export const SEA = { minX: -232, maxX: 232, minZ: -216, maxZ: SHORE_Z - 1.5 }
export const WATER_Y = -1.2
export const SEA_FLOOR = -1.55

/** Lake under the Golden Egg. */
export const LAKE = { x: 0, z: 0, r: 12 }
/** Canal from the lake to the sea (runs north along x = 0). */
export const CANAL = { halfW: 4.5, z0: SHORE_Z, z1: -Math.sqrt(LAKE.r * LAKE.r - 4.5 * 4.5) }
/** 出海岛: raised sandy island off the promenade. */
/** Centre 100 m off the promenade (twice the original 50 m). */
export const ISLAND = { x: 0, z: -178, rx: 30, rz: 17, y: 0.4 }
/** Island-relative helper for everything placed on / around 出海岛. */
const IZ = (dz: number): number => ISLAND.z + dz

export const inIsland = (x: number, z: number, pad = 0): boolean => {
  const dx = (x - ISLAND.x) / (ISLAND.rx + pad), dz = (z - ISLAND.z) / (ISLAND.rz + pad)
  return dx * dx + dz * dz < 1
}
export const inLake = (x: number, z: number): boolean => (x - LAKE.x) ** 2 + (z - LAKE.z) ** 2 < LAKE.r * LAKE.r
export const inCanal = (x: number, z: number): boolean => Math.abs(x) < CANAL.halfW && z >= SHORE_Z - 0.01 && z <= CANAL.z1 + 1.5
/** Open water at (x, z): the sea (minus the island), the canal and the lake. */
export const isWater = (x: number, z: number): boolean => (z < SHORE_Z ? !inIsland(x, z) : inLake(x, z) || inCanal(x, z))
/** Land-side water (canal + lake) — the part carved out of the park. */
export const isInlandWater = (x: number, z: number): boolean => z >= SHORE_Z && (inLake(x, z) || inCanal(x, z))
export const baseGround = (x: number, z: number): number => (z < SHORE_Z ? (inIsland(x, z) ? ISLAND.y : SEA_FLOOR) : inLake(x, z) || inCanal(x, z) ? SEA_FLOOR : 0)

export type PointKind = 'building' | 'egg' | 'island'
export type PointDef = { id: string; name: string; en: string; short: string; shortEn: string; kind: PointKind; x: number; z: number; r: number; standX: number; standZ: number }
/** Capture points. 出海岛 is last and only active in 出海模式 (sea mode). */
export const POINTS: PointDef[] = [
  { id: 'rcc', name: '机器人技术促进中心', en: 'Robotics Centre', short: 'A', shortEn: 'A', kind: 'building', x: -62, z: -36, r: 9, standX: -62, standZ: -36 },
  { id: 'innocell', name: 'InnoCell 创科公寓', en: 'InnoCell Residence', short: 'B', shortEn: 'B', kind: 'building', x: -62, z: 46, r: 9, standX: -62, standZ: 46 },
  { id: 'egg', name: '金蛋 · 高锟会议中心', en: 'Golden Egg · Charles Kao Auditorium', short: '蛋', shortEn: 'EGG', kind: 'egg', x: 0, z: 0, r: 17, standX: 0, standZ: 14.5 },
  { id: '5e', name: '5E 大楼', en: 'Building 5E', short: 'C', shortEn: 'C', kind: 'building', x: 62, z: -36, r: 9, standX: 62, standZ: -36 },
  { id: 'hall', name: '大展览厅', en: 'Grand Exhibition Hall', short: 'D', shortEn: 'D', kind: 'building', x: 62, z: 46, r: 9, standX: 62, standZ: 46 },
  { id: 'isle', name: '出海岛', en: 'Offshore Isle', short: '岛', shortEn: 'ISL', kind: 'island', x: 0, z: IZ(1), r: 9, standX: 0, standZ: IZ(1) },
]
export const ISLAND_POINT = POINTS.length - 1
/** Ammo depot on the Offshore Isle (sea mode): active for whichever team holds the isle. */
export const ISLAND_DEPOT = { x: 6, z: IZ(9.5), r: 3.6 }
/** Helipad on the isle: transport helicopters land here, gunships land / rearm here when the isle is held. */
export const ISLAND_HELIPAD = { x: 13, z: IZ(-5), r: 4.5, y: ISLAND.y }
export const pointName = (p: PointDef): string => L(p.name, p.en)
export const pointShort = (p: PointDef): string => L(p.short, p.shortEn)
/** Number of active points for the chosen mode. */
export const activePointCount = (sea: boolean): number => (sea ? POINTS.length : POINTS.length - 1)

export const EGG = { x: 0, z: 0, rx: 13, ry: 7, rz: 8.5, cy: 15.5 }
export type SkillId = 'scan' | 'shield' | 'steady' | 'rush'
export const SKILLS: Record<SkillId, { name: Txt; desc: Txt; color: string }> = {
  scan: { name: { zh: '量子扫描', en: 'Quantum Scan' }, desc: { zh: '持续标记附近敌人', en: 'keeps marking nearby enemies' }, color: '#7ef9ff' },
  shield: { name: { zh: '纳米护盾', en: 'Nano Shield' }, desc: { zh: '获得 60 点护盾', en: '+60 shield' }, color: '#9d8cff' },
  steady: { name: { zh: '智能稳定', en: 'Smart Stabiliser' }, desc: { zh: '后坐力与散布大幅降低', en: 'much less recoil and spread' }, color: '#ffd35c' },
  rush: { name: { zh: '神经加速', en: 'Neuro Rush' }, desc: { zh: '移动速度提升 35%', en: '+35% move speed' }, color: '#5cff9d' },
}
export type StationKind = 'supply' | 'skill' | 'heal'
export type StationDef = { id: string; kind: StationKind; name: string; en: string; x: number; z: number; r: number; skill?: SkillId }
export const STATIONS: StationDef[] = [
  { id: 'rest-w', kind: 'supply', name: '海滨餐厅', en: 'Seaside Restaurant', x: -36, z: -56, r: 3.6 },
  { id: 'rest-e', kind: 'supply', name: '海港茶餐厅', en: 'Harbour Café', x: 36, z: -56, r: 3.6 },
  { id: 'rest-s', kind: 'supply', name: '园区美食广场', en: 'Park Food Court', x: 0, z: 78, r: 3.6 },
  { id: 'lab-scan', kind: 'skill', skill: 'scan', name: '创科体验馆', en: 'InnoTech Gallery', x: -30, z: 33.5, r: 3.2 },
  { id: 'lab-steady', kind: 'skill', skill: 'steady', name: '芯擎半导体', en: 'CoreDrive Semi', x: 30, z: 33.5, r: 3.2 },
  { id: 'lab-shield', kind: 'skill', skill: 'shield', name: '纳米盾材料', en: 'NanoShield Materials', x: -96, z: -35.5, r: 3.2 },
  { id: 'lab-rush', kind: 'skill', skill: 'rush', name: '启航生物科技', en: 'Voyage Biotech', x: 96, z: -35.5, r: 3.2 },
  { id: 'club', kind: 'heal', name: '科学园会所', en: 'Park Clubhouse', x: 0, z: 53, r: 8 },
]
export const stationName = (s: StationDef): string => L(s.name, s.en)
export type BuildingStyle = 'glass' | 'pilotis' | 'hall' | 'lab' | 'pavilion' | 'club' | 'rooftop'
export type BuildingDef = { id: string; name: string; x: number; z: number; w: number; d: number; h: number; style: BuildingStyle; tint: number; label?: string; labelEn?: string }
export const BUILDINGS: BuildingDef[] = [
  { id: 'rcc', name: '机器人技术促进中心', x: -62, z: -36, w: 30, d: 22, h: 9, style: 'hall', tint: 0x9fb4c8, label: 'RCC 机器人中心', labelEn: 'RCC Robotics' },
  { id: 'hall', name: '大展览厅', x: 62, z: 46, w: 30, d: 22, h: 10, style: 'hall', tint: 0xb8c4d0, label: '大展览厅', labelEn: 'Exhibition Hall' },
  { id: 'innocell', name: 'InnoCell', x: -62, z: 46, w: 22, d: 16, h: 34, style: 'pilotis', tint: 0xd8dde3, label: 'InnoCell' },
  { id: '5e', name: '5E 大楼', x: 62, z: -36, w: 24, d: 18, h: 28, style: 'pilotis', tint: 0x7fb6d6, label: '5E' },
  { id: '10w', name: '10W 大楼', x: -28, z: -34, w: 16, d: 14, h: 10, style: 'rooftop', tint: 0x86c1cf, label: '10W' },
  { id: '20e', name: '20E 大楼', x: 28, z: -34, w: 16, d: 14, h: 10, style: 'rooftop', tint: 0x86c1cf, label: '20E' },
  { id: '16w', name: '16W 大楼', x: -40, z: 4, w: 10, d: 12, h: 18, style: 'glass', tint: 0x6aa6c4, label: '16W' },
  { id: '17e', name: '17E 大楼', x: 40, z: 4, w: 10, d: 12, h: 18, style: 'glass', tint: 0x6aa6c4, label: '17E' },
  { id: 'exp', name: '创科体验馆', x: -30, z: 42, w: 16, d: 12, h: 8, style: 'lab', tint: 0x2fd3c4, label: '创科体验馆', labelEn: 'InnoTech Gallery' },
  { id: 'chip', name: '芯擎半导体', x: 30, z: 42, w: 16, d: 12, h: 8, style: 'lab', tint: 0xffc445, label: '芯擎半导体', labelEn: 'CoreDrive Semi' },
  { id: 'nano', name: '纳米盾材料', x: -96, z: -44, w: 12, d: 12, h: 8, style: 'lab', tint: 0x9d8cff, label: '纳米盾材料', labelEn: 'NanoShield' },
  { id: 'bio', name: '启航生物科技', x: 96, z: -44, w: 12, d: 12, h: 8, style: 'lab', tint: 0x5cff9d, label: '启航生物', labelEn: 'Voyage Bio' },
  { id: 'rest-w', name: '海滨餐厅', x: -36, z: -64, w: 12, d: 7, h: 4.5, style: 'pavilion', tint: 0xff9a52, label: '海滨餐厅', labelEn: 'Seaside Diner' },
  { id: 'rest-e', name: '海港茶餐厅', x: 36, z: -64, w: 12, d: 7, h: 4.5, style: 'pavilion', tint: 0xff9a52, label: '海港茶餐厅', labelEn: 'Harbour Café' },
  { id: 'rest-s', name: '园区美食广场', x: 0, z: 86, w: 16, d: 8, h: 5, style: 'pavilion', tint: 0xff9a52, label: '美食广场', labelEn: 'Food Court' },
  { id: 'club', name: '科学园会所', x: 0, z: 66, w: 24, d: 10, h: 7, style: 'club', tint: 0xf1e6d2, label: '会所', labelEn: 'Clubhouse' },
  { id: 's1', name: '19W 大楼', x: -100, z: 74, w: 18, d: 14, h: 30, style: 'glass', tint: 0x5f93b5 },
  { id: 's2', name: '22E 大楼', x: 100, z: 74, w: 18, d: 14, h: 30, style: 'glass', tint: 0x5f93b5 },
  { id: 's3', name: '12W 大楼', x: -40, z: 80, w: 16, d: 10, h: 14, style: 'glass', tint: 0x77a9c2 },
  { id: 's4', name: '15E 大楼', x: 40, z: 80, w: 16, d: 10, h: 14, style: 'glass', tint: 0x77a9c2 },
]
/** Rooftop drone pads: on 10W and 20E, reached by the external stairs. */
export const DRONE_PADS = [
  { id: 'drone-w', name: '10W 屋顶无人机坪', en: '10W rooftop drone pad', x: -28, y: 10, z: -36, r: 2.6 },
  { id: 'drone-e', name: '20E 屋顶无人机坪', en: '20E rooftop drone pad', x: 28, y: 10, z: -36, r: 2.6 },
]
export const BASES = [
  { team: 0, x: -116, z: 8, r: 10 },
  { team: 1, x: 116, z: 8, r: 10 },
]
export const HELIPADS = [
  { team: 0, x: -112, z: 48, r: 5 },
  { team: 1, x: 112, z: 48, r: 5 },
]
/** Gunship pads beside the transport pads (sea mode). */
export const GUNSHIP_PADS = [
  { team: 0, x: -112, z: 66, r: 5 },
  { team: 1, x: 112, z: 66, r: 5 },
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
/** Team boats beside the piers. `sea` boats only exist in sea mode. */
export const BOAT_SPAWNS = [
  { team: 0, x: -93, z: -88, yaw: Math.PI / 2, sea: false },
  { team: 1, x: 93, z: -88, yaw: -Math.PI / 2, sea: false },
  { team: 0, x: -107, z: -88, yaw: Math.PI / 2, sea: true },
  { team: 1, x: 107, z: -88, yaw: -Math.PI / 2, sea: true },
]
/** High-speed landing craft moored at each pier head (sea mode): driver + 5 infantry. */
export const LANDER_SPAWNS = [
  { team: 0, x: -100, z: -102, yaw: Math.PI },
  { team: 1, x: 100, z: -102, yaw: Math.PI },
]
/** Patrol boats at the island jetties; they belong to whoever holds 出海岛 (sea mode only). */
export const ISLAND_BOATS = [
  { x: -15, z: IZ(24), yaw: 0 },
  { x: 15, z: IZ(24), yaw: 0 },
]
export const ISLAND_JETTIES = [
  { x: -10, z0: IZ(14), z1: IZ(23), w: 3 },
  { x: 10, z0: IZ(14), z1: IZ(23), w: 3 },
]
/** Where assault boats beach on the island (water approach + dry landing spot), per team. */
export const BEACHES = [
  { team: 0, wx: -37, wz: IZ(1), lx: -26, lz: IZ(1) },
  { team: 1, wx: 37, wz: IZ(1), lx: 26, lz: IZ(1) },
]
/** Canal route from the island jetties into the egg lake. */
export const CANAL_ROUTE = [
  { x: 0, z: IZ(48) },
  { x: 0, z: -100 },
  { x: 0, z: -82 },
  { x: 0, z: -62 },
  { x: 0, z: -36 },
  { x: 0, z: -16 },
  { x: 0, z: -8.5 },
]
export type EmplacementKind = 'aa' | 'arty'
export const EMPLACEMENTS: { id: string; kind: EmplacementKind; x: number; z: number; yaw: number }[] = [
  { id: 'aa-w', kind: 'aa', x: -17, z: IZ(7), yaw: Math.PI },
  { id: 'aa-e', kind: 'aa', x: 17, z: IZ(7), yaw: Math.PI },
  { id: 'arty', kind: 'arty', x: 0, z: IZ(-11), yaw: 0 },
]
/** Raised bridges over the canal (deck top height, span along x, width along z). */
export const BRIDGES = [
  { z: -50, w: 8, top: 1.6, road: true },
  { z: -73, w: 5, top: 1.6, road: false },
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
/** @deprecated use isWater */
export const isSea = isWater
/** Where the helicopter can insert the player (and where the enemy calls strikes). */
export type HeliTarget = { index: number; name: string; x: number; z: number; land: boolean; y: number }
export const heliTargets = (count = POINTS.length - 1): HeliTarget[] =>
  POINTS.slice(0, count).map((p, i) =>
    p.kind === 'island'
      ? { index: i, name: pointName(p), x: ISLAND_HELIPAD.x, z: ISLAND_HELIPAD.z, land: true, y: ISLAND_HELIPAD.y }
      : { index: i, name: pointName(p), x: p.x, z: p.z + (p.kind === 'egg' ? 16 : 0), land: false, y: 0 })
