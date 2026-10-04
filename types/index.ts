export type ScriptStatus = 'draft' | 'review' | 'returned' | 'approved'
export type DeviceKind = 'desktop' | 'tablet' | 'mobile' | 'kiosk'

export interface Hall {
  id: string
  name: string
  description: string
}

export interface Segment {
  id: string
  label: string
  content: string
  locked: boolean
}

export interface LanguageDraft {
  id: string
  languageId: string
  title: string
  narration: string
  accessibility: string
  durationMinutes: number
  sources: string
  status: ScriptStatus
  segments: Segment[]
  updatedAt: string
}

export interface Exhibit {
  id: string
  hallId: string
  code: string
  title: string
  order: number
  drafts: LanguageDraft[]
}

export interface Language {
  id: string
  code: string
  label: string
  shortLabel: string
}

export interface VersionSnapshot {
  id: string
  exhibitId: string
  languageId: string
  name: string
  createdAt: string
  draft: LanguageDraft
}

/* ============ 巡展交接包：对账基线 ============ */

/** 展厅对账字段 */
export type HallField = 'name' | 'description'
/** 展项对账字段 */
export type ExhibitField = 'hallId' | 'code' | 'title' | 'order'
/** 语言稿对账字段 */
export type DraftField = 'title' | 'narration' | 'accessibility' | 'durationMinutes' | 'sources' | 'status'
/** 段落对账字段 */
export type SegmentField = 'label' | 'content' | 'locked'

/**
 * 共同基线：导出时展厅、展项、每种语言稿（含段落）都带一份，
 * 导入端用 “基线 / 本地当前 / 巡展包当前” 三份逐字段对账。
 */
export interface SegmentBaseline {
  id: string
  label: string
  content: string
  locked: boolean
}

export interface DraftBaseline {
  id: string
  languageId: string
  title: string
  narration: string
  accessibility: string
  durationMinutes: number
  sources: string
  status: ScriptStatus
  /** 导出基线时的段落顺序与内容 */
  segments: SegmentBaseline[]
}

export interface ExhibitBaseline {
  id: string
  hallId: string
  code: string
  title: string
  order: number
  drafts: DraftBaseline[]
}

export interface HallBaseline {
  id: string
  name: string
  description: string
}

/** 已删除段落的墓碑：key 为 语言稿 id，值为已删除的稳定段落编号集合 */
export type Tombstones = Record<string, string[]>

/* ============ 巡展交接包文件结构 ============ */

export interface TourPackage {
  kind: 'museum-tour-package'
  packageId: string
  exportedAt: string
  exportedBy: string
  hallIds: string[]
  /** 共同基线：基线端快照 */
  baselines: {
    halls: HallBaseline[]
    exhibits: ExhibitBaseline[]
  }
  /** 巡展端当前快照（已剔除被删除的段落） */
  current: {
    halls: Hall[]
    exhibits: Exhibit[]
  }
  /** 巡展端已知的删除编号，导入后旧包无法把这些段落复活 */
  tombstones: Tombstones
}

/* ============ 对账结果 ============ */

export type MergeTarget = 'hall' | 'exhibit' | 'draft' | 'segment'

/** 某条记录的定位信息，用于界面展示与写入 */
export interface MergeTargetRef {
  kind: MergeTarget
  hallId: string
  exhibitId: string
  draftId?: string
  segmentId?: string
  /** 记录标题/编号等展示名 */
  name: string
  languageLabel?: string
}

/** 字段级对账结果：单边变化自动接收，双边变化为冲突 */
export interface FieldMergeItem {
  type: 'field'
  key: string
  target: MergeTargetRef
  field: string
  fieldLabel: string
  base: unknown
  local: unknown
  incoming: unknown
  changedSide: 'local' | 'incoming'
  resolution: MergeResolution | null
  conflict: boolean
}

/** 记录/段落新增（仅一侧存在），默认接收巡展端新增，也可在导入前选择跳过 */
export interface AddedMergeItem {
  type: 'added'
  key: string
  target: MergeTargetRef
  /** 新增内容的简要预览 */
  preview: string
  resolution: Exclude<MergeResolution, 'local'>
}

/** 单边删除：基线有、巡展端没有（段落按稳定编号识别） */
export interface RemovedSegmentMergeItem {
  type: 'removed-segment'
  key: string
  target: MergeTargetRef
  base: unknown
  local: unknown
  /** incoming=接受删除并记墓碑；skip=保留该段 */
  resolution: Exclude<MergeResolution, 'local'> | null
  conflict: boolean
}

export type MergeItem = FieldMergeItem | AddedMergeItem | RemovedSegmentMergeItem

/** 对账决议：local 保留本地 / incoming 采用巡展包 / skip 跳过（不接收新增、保留删除前内容） */
export type MergeResolution = 'local' | 'incoming' | 'skip'

export interface MergeReport {
  packageId: string
  exportedAt: string
  exportedBy: string
  items: MergeItem[]
  /** 对账时发现本地已被本包写入，直接返回旧回执 */
  alreadyImported: boolean
}

/* ============ 导入回执（同一包重复导入只留一张） ============ */

export interface ImportReceipt {
  packageId: string
  exportedAt: string
  exportedBy: string
  importedAt: string
  /** 实际写入的条目数、自动接收数、冲突数 */
  appliedCount: number
  autoAcceptedCount: number
  conflictCount: number
  addedCount: number
  removedCount: number
  skippedCount: number
  summary: string
}

/** 未决冲突现场：导入失败或待人工裁决时持久化，刷新后继续 */
export interface PendingImport {
  pkg: TourPackage
  items: MergeItem[]
  report: MergeReport
  createdAt: string
}

/** 巡展同步状态：随主数据一起持久化 */
export interface SyncState {
  baselines: {
    halls: HallBaseline[]
    exhibits: ExhibitBaseline[]
  }
  tombstones: Tombstones
  receipts: ImportReceipt[]
  pending: PendingImport | null
}

export interface PersistedState {
  halls: Hall[]
  exhibits: Exhibit[]
  versions: VersionSnapshot[]
  selectedHallId: string
  selectedExhibitId: string
  selectedLanguageId: string
  lastSavedAt: string
  sync?: SyncState
}

export interface DiffLine {
  type: 'same' | 'add' | 'remove'
  text: string
}
