import type {
  Exhibit, ExhibitBaseline, FieldMergeItem, Hall, HallBaseline, ImportReceipt,
  LanguageDraft, MergeItem, MergeReport, MergeResolution, RemovedSegmentMergeItem,
  Segment, SegmentBaseline, SyncState, TourPackage, AddedMergeItem, MergeTargetRef
} from '~/types'

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

export const HALL_FIELDS = ['name', 'description'] as const
export const EXHIBIT_FIELDS = ['hallId', 'code', 'title', 'order'] as const
export const DRAFT_FIELDS = ['title', 'narration', 'accessibility', 'durationMinutes', 'sources', 'status'] as const
export const SEGMENT_FIELDS = ['label', 'content', 'locked'] as const

export const FIELD_LABELS: Record<string, string> = {
  name: '名称',
  description: '说明',
  hallId: '所属展厅',
  code: '展项编号',
  title: '标题',
  order: '排序',
  narration: '讲解词',
  accessibility: '无障碍描述',
  durationMinutes: '预计时长',
  sources: '资料来源',
  status: '审校状态',
  label: '段落名',
  content: '段落内容',
  locked: '锁定状态'
}

const PACKAGE_KIND = 'museum-tour-package'

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function uid(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'getRandomValues' in crypto
    ? crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
    : Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

/* ------------------------------------------------------------------ */
/* 基线：展厅、展项、每种语言稿（含段落）各带一份共同基线               */
/* ------------------------------------------------------------------ */

export function segmentBaseline(segment: Segment): SegmentBaseline {
  return { id: segment.id, label: segment.label, content: segment.content, locked: segment.locked }
}

export function draftBaseline(draft: LanguageDraft) {
  return {
    id: draft.id,
    languageId: draft.languageId,
    title: draft.title,
    narration: draft.narration,
    accessibility: draft.accessibility,
    durationMinutes: draft.durationMinutes,
    sources: draft.sources,
    status: draft.status,
    segments: draft.segments.map(segmentBaseline)
  }
}

export function exhibitBaseline(exhibit: Exhibit): ExhibitBaseline {
  return {
    id: exhibit.id,
    hallId: exhibit.hallId,
    code: exhibit.code,
    title: exhibit.title,
    order: exhibit.order,
    drafts: exhibit.drafts.map(draftBaseline)
  }
}

export function hallBaseline(hall: Hall): HallBaseline {
  return { id: hall.id, name: hall.name, description: hall.description }
}

export function buildBaselines(halls: Hall[], exhibits: Exhibit[]): SyncState['baselines'] {
  return {
    halls: halls.map(hallBaseline),
    exhibits: exhibits.map(exhibitBaseline)
  }
}

/* ------------------------------------------------------------------ */
/* 导出巡展交接包                                                      */
/* ------------------------------------------------------------------ */

export interface ExportContext {
  halls: Hall[]
  exhibits: Exhibit[]
  baselines: SyncState['baselines']
  tombstones: Record<string, string[]>
  exportedBy: string
  now?: string
}

export function createTourPackage(ctx: ExportContext): TourPackage {
  const now = ctx.now || new Date().toISOString()
  const current = clone({ halls: ctx.halls, exhibits: ctx.exhibits })
  // 已删除段落绝不进入巡展包当前稿，避免再被带出去
  for (const exhibit of current.exhibits) {
    for (const draft of exhibit.drafts) {
      const dead = new Set(ctx.tombstones[draft.id] || [])
      if (dead.size) draft.segments = draft.segments.filter(segment => !dead.has(segment.id))
    }
  }
  return {
    kind: PACKAGE_KIND,
    packageId: uid('pkg'),
    exportedAt: now,
    exportedBy: ctx.exportedBy || '巡展组',
    hallIds: current.halls.map(hall => hall.id),
    baselines: clone(ctx.baselines),
    current,
    tombstones: clone(ctx.tombstones)
  }
}

/* ------------------------------------------------------------------ */
/* 包校验                                                              */
/* ------------------------------------------------------------------ */

export function validatePackage(raw: unknown): TourPackage {
  if (typeof raw !== 'object' || raw === null) throw new Error('文件内容不是有效的交接包。')
  const pkg = raw as Partial<TourPackage>
  if (pkg.kind !== PACKAGE_KIND) throw new Error('文件标识不正确，可能不是巡展交接包。')
  if (!pkg.packageId || typeof pkg.packageId !== 'string') throw new Error('交接包缺少编号。')
  if (!pkg.exportedAt) throw new Error('交接包缺少导出时间。')
  if (!pkg.baselines || !Array.isArray(pkg.baselines.halls) || !Array.isArray(pkg.baselines.exhibits)) {
    throw new Error('交接包缺少共同基线，无法对账。')
  }
  if (!pkg.current || !Array.isArray(pkg.current.halls) || !Array.isArray(pkg.current.exhibits)) {
    throw new Error('交接包缺少巡展端当前稿件。')
  }
  if (typeof pkg.tombstones !== 'object' || pkg.tombstones === null) throw new Error('交接包缺少删除记录。')
  return pkg as TourPackage
}

/* ------------------------------------------------------------------ */
/* 三方对账                                                            */
/* ------------------------------------------------------------------ */

export interface ReconcileContext {
  pkg: TourPackage
  halls: Hall[]
  exhibits: Exhibit[]
  tombstones: Record<string, string[]>
  languageLabel: (id: string) => string
  hallName: (id: string) => string
}

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map(item => [item.id, item]))
}

function isTombstoned(tombstones: Record<string, string[]>, draftId: string, segmentId: string): boolean {
  return (tombstones[draftId] || []).includes(segmentId)
}

/**
 * 逐字段比较 基线 / 本地 / 巡展 三方：
 * - 巡展单边改 → 自动接收项
 * - 两边改成相同结果 → 已一致，不出项
 * - 两边都改且不同 → 冲突项，等待人工选定
 */
function compareField(
  base: unknown,
  local: unknown,
  incoming: unknown
): { conflict: boolean; changedSide: 'local' | 'incoming' | null } {
  const localChanged = JSON.stringify(local) !== JSON.stringify(base)
  const incomingChanged = JSON.stringify(incoming) !== JSON.stringify(base)
  if (!localChanged && !incomingChanged) return { conflict: false, changedSide: null }
  if (JSON.stringify(local) === JSON.stringify(incoming)) return { conflict: false, changedSide: null }
  if (!localChanged && incomingChanged) return { conflict: false, changedSide: 'incoming' }
  if (localChanged && !incomingChanged) return { conflict: false, changedSide: 'local' }
  return { conflict: true, changedSide: null }
}

let itemSeq = 0
function nextKey(): string {
  itemSeq += 1
  return `merge-${Date.now().toString(36)}-${itemSeq}`
}

export function reconcile(ctx: ReconcileContext): MergeReport {
  const { pkg, tombstones } = ctx
  const items: MergeItem[] = []

  const baseHalls = byId(pkg.baselines.halls)
  const inHalls = byId(pkg.current.halls)
  const localHalls = byId(ctx.halls)

  const baseExhibits = byId(pkg.baselines.exhibits)
  const inExhibits = byId(pkg.current.exhibits)
  const localExhibits = byId(ctx.exhibits)

  /* ---- 展厅 ---- */
  for (const id of new Set([...baseHalls.keys(), ...inHalls.keys(), ...localHalls.keys()])) {
    const b = baseHalls.get(id)
    const i = inHalls.get(id)
    const l = localHalls.get(id)
    const target: MergeTargetRef = { kind: 'hall', hallId: id, exhibitId: '', name: i?.name || b?.name || l?.name || id }
    if (b && i && l) {
      pushFieldItems(items, target, HALL_FIELDS as unknown as string[], b as unknown as Record<string, unknown>, l as unknown as Record<string, unknown>, i as unknown as Record<string, unknown>)
    } else if (!b && i && !l) {
      items.push(addedItem(target, i.name))
    } else if (!b && i && l) {
      pushFieldItems(items, target, HALL_FIELDS as unknown as string[], undefined, l as unknown as Record<string, unknown>, i as unknown as Record<string, unknown>)
    }
    // 其余情形：整厅删除不在巡展交接范围内，保持本地不动
  }

  /* ---- 展项 ---- */
  for (const id of new Set([...baseExhibits.keys(), ...inExhibits.keys(), ...localExhibits.keys()])) {
    const b = baseExhibits.get(id)
    const i = inExhibits.get(id)
    const l = localExhibits.get(id)
    const target: MergeTargetRef = {
      kind: 'exhibit', hallId: i?.hallId || b?.hallId || l?.hallId || '', exhibitId: id,
      name: i ? `${i.code} ${i.title}` : b ? `${b.code} ${b.title}` : l ? `${l.code} ${l.title}` : id
    }
    if (b && i && l) {
      pushFieldItems(items, target, EXHIBIT_FIELDS as unknown as string[], b as unknown as Record<string, unknown>, l as unknown as Record<string, unknown>, i as unknown as Record<string, unknown>)
      reconcileDrafts(items, b, i, l, ctx)
    } else if (!b && i && !l) {
      items.push(addedItem(target, `${i.code} ${i.title}`))
    } else if (!b && i && l) {
      pushFieldItems(items, target, EXHIBIT_FIELDS as unknown as string[], undefined, l as unknown as Record<string, unknown>, i as unknown as Record<string, unknown>)
      reconcileDrafts(items, undefined, i, l, ctx)
    }
  }

  return {
    packageId: pkg.packageId,
    exportedAt: pkg.exportedAt,
    exportedBy: pkg.exportedBy,
    items,
    alreadyImported: false
  }
}

function addedItem(target: MergeTargetRef, preview: string): AddedMergeItem {
  return { type: 'added', key: nextKey(), target, preview, resolution: 'incoming' }
}

function pushFieldItems(
  items: MergeItem[],
  target: MergeTargetRef,
  fields: readonly string[],
  base: Record<string, unknown> | undefined,
  local: Record<string, unknown>,
  incoming: Record<string, unknown>
) {
  for (const field of fields) {
    const b = base ? base[field] : undefined
    const cmp = compareField(b, local[field], incoming[field])
    if (cmp.changedSide === null && !cmp.conflict) continue
    // 没有共同基线时（如本地单边新建的记录），本地单边改动不出项
    if (base === undefined && cmp.changedSide === 'local' && !cmp.conflict) continue
    const item: FieldMergeItem = {
      type: 'field',
      key: nextKey(),
      target: { ...target },
      field,
      fieldLabel: FIELD_LABELS[field] || field,
      base: b,
      local: local[field],
      incoming: incoming[field],
      changedSide: cmp.changedSide || 'local',
      resolution: null,
      conflict: cmp.conflict
    }
    items.push(item)
  }
}

function reconcileDrafts(
  items: MergeItem[],
  baseEx: ExhibitBaseline | undefined,
  inEx: Exhibit,
  localEx: Exhibit,
  ctx: ReconcileContext
) {
  const baseDrafts = byId(baseEx?.drafts || [])
  const inDrafts = byId(inEx.drafts)
  const localDrafts = byId(localEx.drafts)

  for (const draftId of new Set([...baseDrafts.keys(), ...inDrafts.keys(), ...localDrafts.keys()])) {
    const b = baseDrafts.get(draftId)
    const i = inDrafts.get(draftId)
    const l = localDrafts.get(draftId)
    const languageId = i?.languageId || b?.languageId || l?.languageId || ''
    const target: MergeTargetRef = {
      kind: 'draft',
      hallId: inEx.hallId,
      exhibitId: inEx.id,
      draftId,
      name: localEx ? `${localEx.code} ${localEx.title}` : `${inEx.code} ${inEx.title}`,
      languageLabel: ctx.languageLabel(languageId)
    }

    if (b && i && l) {
      pushFieldItems(items, target, DRAFT_FIELDS as unknown as string[], b as unknown as Record<string, unknown>, l as unknown as Record<string, unknown>, i as unknown as Record<string, unknown>)
      reconcileSegments(items, target, b.segments, i.segments, l.segments, ctx)
    } else if (i && !l) {
      // 本地缺这份语言稿（或本地已删）。已在删除记录中的旧稿不复活。
      const dead = (ctx.tombstones[draftId] || []).length > 0 && b === undefined
      if (!dead) items.push(addedItem(target, ctx.languageLabel(languageId)))
    } else if (!b && i && l) {
      pushFieldItems(items, target, DRAFT_FIELDS as unknown as string[], undefined, l as unknown as Record<string, unknown>, i as unknown as Record<string, unknown>)
      reconcileSegments(items, target, [], i.segments, l.segments, ctx)
    }
    // 巡展端整稿删除：仅段落支持删除对账，语言稿本身保持本地不动
  }
}

function reconcileSegments(
  items: MergeItem[],
  draftTarget: MergeTargetRef,
  baseSegments: SegmentBaseline[],
  inSegments: Segment[],
  localSegments: Segment[],
  ctx: ReconcileContext
) {
  const draftId = draftTarget.draftId!
  const base = byId(baseSegments)
  const incoming = byId(inSegments)
  const local = byId(localSegments)

  for (const segmentId of new Set([...base.keys(), ...incoming.keys(), ...local.keys()])) {
    const b = base.get(segmentId)
    const i = incoming.get(segmentId)
    const l = local.get(segmentId)
    const target: MergeTargetRef = {
      ...draftTarget,
      kind: 'segment',
      segmentId,
      name: i?.label || b?.label || l?.label || segmentId
    }

    // 已有删除记录：任何旧包都不能把它复活
    if (isTombstoned(ctx.tombstones, draftId, segmentId) && !l) continue

    if (b && i && l) {
      pushFieldItems(items, target, SEGMENT_FIELDS as unknown as string[], b as unknown as Record<string, unknown>, l as unknown as Record<string, unknown>, i as unknown as Record<string, unknown>)
      continue
    }

    if (b && !i) {
      // 巡展端删除了该段落（按稳定编号识别）
      if (!l) continue // 两边都已删除，无需出项，写回时补墓碑
      const localEdited = SEGMENT_FIELDS.some(field =>
        JSON.stringify((l as unknown as Record<string, unknown>)[field]) !== JSON.stringify((b as unknown as Record<string, unknown>)[field]))
      const item: RemovedSegmentMergeItem = {
        type: 'removed-segment',
        key: nextKey(),
        target,
        base: b.content,
        local: l.content,
        resolution: localEdited ? null : 'incoming',
        conflict: localEdited
      }
      items.push(item)
      continue
    }

    if (b && i && !l) {
      // 本地已删除，巡展端还改过：冲突，可选保持删除或采用巡展稿（受墓碑保护）
      const incomingEdited = SEGMENT_FIELDS.some(field =>
        JSON.stringify((i as unknown as Record<string, unknown>)[field]) !== JSON.stringify((b as unknown as Record<string, unknown>)[field]))
      if (!incomingEdited) continue // 巡展端没动，尊重本地删除
      items.push({
        type: 'removed-segment',
        key: nextKey(),
        target,
        base: b.content,
        local: undefined,
        resolution: null,
        conflict: true
      })
      continue
    }

    if (!b && i && !l) {
      // 巡展端新增段落
      if (isTombstoned(ctx.tombstones, draftId, segmentId)) continue
      items.push(addedItem(target, i.label || i.content.slice(0, 20)))
      continue
    }

    if (!b && i && l) {
      // 两边都有、基线没有：相同则静默，不同按冲突列出
      pushFieldItems(items, target, SEGMENT_FIELDS as unknown as string[], undefined, l as unknown as Record<string, unknown>, i as unknown as Record<string, unknown>)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 决议校验与写入（事务，由 store 包裹回滚）                           */
/* ------------------------------------------------------------------ */

export function unresolvedConflicts(items: MergeItem[]): MergeItem[] {
  return items.filter(item => {
    if (item.type === 'field') return item.conflict && !item.resolution
    if (item.type === 'removed-segment') return item.conflict && !item.resolution
    return false
  })
}

export interface ApplyStats {
  appliedCount: number
  autoAcceptedCount: number
  conflictCount: number
  addedCount: number
  removedCount: number
  skippedCount: number
}

export function applyMerge(
  local: { halls: Hall[]; exhibits: Exhibit[] },
  pkg: TourPackage,
  items: MergeItem[],
  tombstonesIn: Record<string, string[]>
): { tombstones: Record<string, string[]>; stats: ApplyStats } {
  const pending = unresolvedConflicts(items)
  if (pending.length) throw new Error(`还有 ${pending.length} 处冲突未选定，暂不写入。`)

  const tombstones: Record<string, string[]> = clone(tombstonesIn)
  const addTombstone = (draftId: string, segmentId: string) => {
    const set = new Set(tombstones[draftId] || [])
    set.add(segmentId)
    tombstones[draftId] = [...set]
  }
  const isDead = (draftId: string, segmentId: string) => (tombstones[draftId] || []).includes(segmentId)

  const stats: ApplyStats = {
    appliedCount: 0, autoAcceptedCount: 0, conflictCount: 0,
    addedCount: 0, removedCount: 0, skippedCount: 0
  }

  const findHall = (id: string): Hall => {
    const hall = local.halls.find(item => item.id === id)
    if (!hall) throw new Error(`写入失败：展厅 ${id} 不存在。`)
    return hall
  }
  const findExhibit = (id: string): Exhibit => {
    const exhibit = local.exhibits.find(item => item.id === id)
    if (!exhibit) throw new Error(`写入失败：展项 ${id} 不存在。`)
    return exhibit
  }
  const findDraft = (exhibitId: string, draftId: string): LanguageDraft => {
    const draft = findExhibit(exhibitId).drafts.find(item => item.id === draftId)
    if (!draft) throw new Error(`写入失败：语言稿 ${draftId} 不存在。`)
    return draft
  }

  // 先落新增记录，保证后续字段写得到
  const order: Record<MergeItem['type'], number> = { added: 0, field: 1, 'removed-segment': 2 }
  const sorted = [...items].sort((a, b) => {
    const rank = { hall: 0, exhibit: 1, draft: 2, segment: 3 }
    return order[a.type] - order[b.type] || rank[a.target.kind] - rank[b.target.kind]
  })

  for (const item of sorted) {
    const t = item.target
    if (item.type === 'added') {
      if (item.resolution === 'skip') { stats.skippedCount++; continue }
      const incomingHall = pkg.current.halls.find(hall => hall.id === t.hallId)
      const incomingExhibit = pkg.current.exhibits.find(exhibit => exhibit.id === t.exhibitId)
      if (t.kind === 'hall') {
        if (!incomingHall) throw new Error('写入失败：巡展包中找不到该展厅。')
        local.halls.push(clone(incomingHall))
      } else if (t.kind === 'exhibit') {
        if (!incomingExhibit) throw new Error('写入失败：巡展包中找不到该展项。')
        findHall(incomingExhibit.hallId)
        local.exhibits.push(clone(incomingExhibit))
      } else if (t.kind === 'draft') {
        if (!incomingExhibit) throw new Error('写入失败：巡展包中找不到该展项。')
        const draft = incomingExhibit.drafts.find(d => d.id === t.draftId)
        if (!draft) throw new Error('写入失败：巡展包中找不到该语言稿。')
        findExhibit(t.exhibitId).drafts.push(clone(draft))
      } else {
        if (isDead(t.draftId!, t.segmentId!)) { stats.skippedCount++; continue }
        const draft = incomingExhibit?.drafts.find(d => d.id === t.draftId)
        const segment = draft?.segments.find(s => s.id === t.segmentId)
        if (!segment) throw new Error('写入失败：巡展包中找不到该段落。')
        findDraft(t.exhibitId, t.draftId!).segments.push(clone(segment))
      }
      stats.addedCount++
      stats.appliedCount++
      continue
    }

    if (item.type === 'removed-segment') {
      const accept = item.resolution !== 'skip'
      if (!accept) { stats.skippedCount++; continue }
      const draft = findDraft(t.exhibitId, t.draftId!)
      draft.segments = draft.segments.filter(segment => segment.id !== t.segmentId)
      addTombstone(t.draftId!, t.segmentId!)
      stats.removedCount++
      stats.appliedCount++
      if (item.conflict) stats.conflictCount++
      continue
    }

    // 字段项
    const resolution: MergeResolution | null = item.resolution
    if (item.conflict) stats.conflictCount++
    if (!item.conflict && item.changedSide === 'local') continue // 本地单边改动：无需动作

    let takeIncoming: boolean
    if (item.conflict) takeIncoming = resolution === 'incoming'
    else takeIncoming = item.changedSide === 'incoming' && resolution !== 'local'

    if (!takeIncoming) { stats.skippedCount++; continue }

    if (t.kind === 'hall') {
      findHall(t.hallId)[item.field as keyof Hall] = clone(item.incoming) as never
    } else if (t.kind === 'exhibit') {
      findExhibit(t.exhibitId)[item.field as keyof Exhibit] = clone(item.incoming) as never
    } else if (t.kind === 'draft') {
      findDraft(t.exhibitId, t.draftId!)[item.field as keyof LanguageDraft] = clone(item.incoming) as never
    } else {
      const segment = findDraft(t.exhibitId, t.draftId!).segments.find(s => s.id === t.segmentId)
      if (!segment) throw new Error('写入失败：段落已不存在。')
      segment[item.field as keyof Segment] = clone(item.incoming) as never
    }
    stats.appliedCount++
    if (!item.conflict) stats.autoAcceptedCount++
  }

  // 合并巡展包带来的墓碑，并为“基线有、巡展已无、本地结果也无”的段落补墓碑
  for (const [draftId, ids] of Object.entries(pkg.tombstones || {})) {
    for (const id of ids) addTombstone(draftId, id)
  }
  for (const baseEx of pkg.baselines.exhibits) {
    for (const baseDraft of baseEx.drafts) {
      const incomingExhibit = pkg.current.exhibits.find(ex => ex.id === baseEx.id)
      const incomingDraft = incomingExhibit?.drafts.find(d => d.id === baseDraft.id)
      const localExhibit = local.exhibits.find(ex => ex.id === baseEx.id)
      const localDraft = localExhibit?.drafts.find(d => d.id === baseDraft.id)
      for (const segment of baseDraft.segments) {
        const stillIncoming = incomingDraft?.segments.some(s => s.id === segment.id)
        const stillLocal = localDraft?.segments.some(s => s.id === segment.id)
        if (!stillIncoming && !stillLocal) addTombstone(baseDraft.id, segment.id)
      }
    }
  }

  return { tombstones, stats }
}

/* ------------------------------------------------------------------ */
/* 回执                                                                */
/* ------------------------------------------------------------------ */

export function buildReceipt(pkg: TourPackage, items: MergeItem[], stats: ApplyStats, now?: string): ImportReceipt {
  const parts: string[] = []
  parts.push(`自动接收 ${stats.autoAcceptedCount} 处`)
  if (stats.conflictCount) parts.push(`冲突裁决 ${stats.conflictCount} 处`)
  if (stats.addedCount) parts.push(`新增 ${stats.addedCount} 条`)
  if (stats.removedCount) parts.push(`删除 ${stats.removedCount} 段`)
  if (stats.skippedCount) parts.push(`跳过 ${stats.skippedCount} 处`)
  return {
    packageId: pkg.packageId,
    exportedAt: pkg.exportedAt,
    exportedBy: pkg.exportedBy,
    importedAt: now || new Date().toISOString(),
    appliedCount: stats.appliedCount,
    autoAcceptedCount: stats.autoAcceptedCount,
    conflictCount: stats.conflictCount,
    addedCount: stats.addedCount,
    removedCount: stats.removedCount,
    skippedCount: stats.skippedCount,
    summary: `已接收「${pkg.exportedBy}」巡展包：${parts.join('，')}。`
  }
}
