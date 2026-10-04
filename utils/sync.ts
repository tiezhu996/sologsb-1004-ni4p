import type {
  Exhibit,
  Hall,
  LanguageDraft,
  PendingSyncImport,
  ScriptStatus,
  Segment,
  SyncConflict,
  SyncConflictChoice,
  SyncDataset,
  SyncPackage,
  SyncReceipt,
  SyncReconciliation,
  SyncStats
} from '~/types'

const STATUSES: ScriptStatus[] = ['draft', 'review', 'returned', 'approved']
const LANGUAGE_IDS = ['zh', 'en', 'ja']

const hallFields = [
  { key: 'name', label: '展厅名称' },
  { key: 'description', label: '展厅说明' }
] as const

const exhibitFields = [
  { key: 'hallId', label: '所属展厅' },
  { key: 'code', label: '展项编号' },
  { key: 'title', label: '展项标题' },
  { key: 'order', label: '排序' }
] as const

const draftFields = [
  { key: 'languageId', label: '语言' },
  { key: 'title', label: '稿件标题' },
  { key: 'narration', label: '讲解词' },
  { key: 'accessibility', label: '无障碍描述' },
  { key: 'durationMinutes', label: '预计朗读时长' },
  { key: 'sources', label: '资料来源' },
  { key: 'status', label: '审校状态' }
] as const

const segmentFields = [
  { key: 'label', label: '段落标题' },
  { key: 'content', label: '段落内容' },
  { key: 'locked', label: '锁定状态' }
] as const

function emptyStats(): SyncStats {
  return {
    accepted: 0,
    conflicts: 0,
    localAdds: 0,
    remoteAdds: 0,
    localDeletes: 0,
    remoteDeletes: 0,
    revived: 0,
    suppressed: 0
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function uniqueStrings(values: unknown[], label: string) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value)) {
    throw new Error(`${label}必须是非空字符串数组`)
  }
  if (new Set(values).size !== values.length) throw new Error(`${label}存在重复编号`)
}

function stableSortIds(baseIds: string[], ...lists: Array<Set<string> | Map<string, unknown>>) {
  const seen = new Set<string>()
  const result: string[] = []
  const add = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  baseIds.forEach(add)
  lists.forEach(list => Array.from(list.keys()).filter(id => list instanceof Set ? list.has(id) : list.has(id)).sort().forEach(add))
  return result
}

export function createDataset(halls: Hall[], exhibits: Exhibit[], tombstones: string[] = []): SyncDataset {
  return {
    halls: clone(halls),
    exhibits: clone(exhibits),
    tombstones: [...new Set(tombstones)].sort()
  }
}

export function createStableId(used: Set<string>): string {
  let id = ''
  do {
    const random = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    id = `segment-${random}`
  } while (used.has(id))
  used.add(id)
  return id
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function validateDataset(value: unknown, datasetRole: 'base' | 'current' = 'current'): SyncDataset {
  if (!isObject(value)) throw new Error('交接包中的数据集格式不正确')
  const hallSource = value.halls
  const exhibitSource = value.exhibits
  if (!Array.isArray(hallSource) || !Array.isArray(exhibitSource)) throw new Error('交接包缺少展厅或展项数据')
  const tombstones = Array.isArray(value.tombstones) ? value.tombstones : []
  uniqueStrings(tombstones, '删除记录')

  const halls: Hall[] = []
  const hallIds = new Set<string>()
  for (const item of hallSource) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id) throw new Error('展厅编号无效')
    if (hallIds.has(item.id)) throw new Error(`展厅编号重复：${item.id}`)
    hallIds.add(item.id)
    halls.push({ id: item.id, name: text(item.name), description: text(item.description) })
  }

  const exhibits: Exhibit[] = []
  const exhibitIds = new Set<string>()
  const draftIds = new Set<string>()
  const segmentIds = new Set<string>()

  for (const item of exhibitSource) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id) throw new Error('展项编号无效')
    if (exhibitIds.has(item.id)) throw new Error(`展项编号重复：${item.id}`)
    if (!hallIds.has(text(item.hallId))) throw new Error(`展项 ${item.id} 缺少有效展厅`)
    if (typeof item.code !== 'string' || typeof item.title !== 'string') throw new Error(`展项 ${item.id} 字段不完整`)
    if (typeof item.order !== 'number' || !Number.isFinite(item.order)) throw new Error(`展项 ${item.id} 排序无效`)
    if (!Array.isArray(item.drafts)) throw new Error(`展项 ${item.id} 缺少语言稿`)
    exhibitIds.add(item.id)

    const drafts: LanguageDraft[] = []
    for (const draftSource of item.drafts) {
      if (!isObject(draftSource) || typeof draftSource.id !== 'string' || !draftSource.id) throw new Error('语言稿编号无效')
      if (draftIds.has(draftSource.id)) throw new Error(`语言稿编号重复：${draftSource.id}`)
      if (!LANGUAGE_IDS.includes(text(draftSource.languageId))) throw new Error(`语言稿 ${draftSource.id} 的语言不受支持`)
      if (!STATUSES.includes(text(draftSource.status) as ScriptStatus)) throw new Error(`语言稿 ${draftSource.id} 的状态无效`)
      if (typeof draftSource.title !== 'string' || typeof draftSource.narration !== 'string' || typeof draftSource.accessibility !== 'string' || typeof draftSource.sources !== 'string') {
        throw new Error(`语言稿 ${draftSource.id} 存在文本字段缺失`)
      }
      if (typeof draftSource.durationMinutes !== 'number' || !Number.isFinite(draftSource.durationMinutes)) {
        throw new Error(`语言稿 ${draftSource.id} 的朗读时长无效`)
      }
      if (typeof draftSource.updatedAt !== 'string' || !draftSource.updatedAt) throw new Error(`语言稿 ${draftSource.id} 缺少更新时间`)
      if (!Array.isArray(draftSource.segments)) throw new Error(`语言稿 ${draftSource.id} 缺少段落数据`)

      const segments: Segment[] = []
      for (const segmentSource of draftSource.segments) {
        if (!isObject(segmentSource) || typeof segmentSource.id !== 'string' || !segmentSource.id) throw new Error('段落编号无效')
        if (segmentIds.has(segmentSource.id)) throw new Error(`段落编号重复：${segmentSource.id}`)
        if (datasetRole === 'current' && tombstones.includes(segmentSource.id)) throw new Error(`段落 ${segmentSource.id} 已删除，不能被旧交接包恢复`)
        if (typeof segmentSource.label !== 'string' || typeof segmentSource.content !== 'string') throw new Error(`段落 ${segmentSource.id} 字段不完整`)
        if (typeof segmentSource.locked !== 'boolean') throw new Error(`段落 ${segmentSource.id} 的锁定状态无效`)
        segmentIds.add(segmentSource.id)
        segments.push({ id: segmentSource.id, label: segmentSource.label, content: segmentSource.content, locked: segmentSource.locked })
      }

      draftIds.add(draftSource.id)
      drafts.push({
        id: draftSource.id,
        languageId: text(draftSource.languageId),
        title: draftSource.title,
        narration: draftSource.narration,
        accessibility: draftSource.accessibility,
        durationMinutes: draftSource.durationMinutes,
        sources: draftSource.sources,
        status: draftSource.status as ScriptStatus,
        segments,
        updatedAt: draftSource.updatedAt
      })
    }

    exhibits.push({
      id: item.id,
      hallId: text(item.hallId),
      code: item.code,
      title: item.title,
      order: item.order,
      drafts
    })
  }

  return { halls, exhibits, tombstones: [...new Set(tombstones)].sort() }
}

export function parseSyncPackage(value: string): SyncPackage {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('交接包不是有效的 JSON 文件')
  }
  if (!isObject(parsed) || parsed.format !== 'museum-script-sync/1') throw new Error('交接包格式或版本不受支持')
  if (typeof parsed.packageId !== 'string' || !parsed.packageId) throw new Error('交接包缺少唯一编号')
  if (typeof parsed.exportedAt !== 'string' || Number.isNaN(Date.parse(parsed.exportedAt))) throw new Error('交接包导出时间无效')
  if (typeof parsed.exportedBy !== 'string' || typeof parsed.note !== 'string') throw new Error('交接包来源信息不完整')
  if (!isObject(parsed.base) || !isObject(parsed.current)) throw new Error('交接包缺少共同基线或当前数据')

  const pkg: SyncPackage = {
    packageId: parsed.packageId,
    format: 'museum-script-sync/1',
    exportedAt: parsed.exportedAt,
    exportedBy: parsed.exportedBy,
    note: parsed.note,
    base: validateDataset(parsed.base, 'base'),
    current: validateDataset(parsed.current)
  }
  return pkg
}

export function createSyncPackage(current: SyncDataset, baseline: SyncDataset, exportedBy: string, note: string): SyncPackage {
  return {
    packageId: `package-${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    format: 'museum-script-sync/1',
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy.trim() || '巡展组',
    note: note.trim(),
    base: clone(baseline),
    current: clone(current)
  }
}

function toMap<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map(item => [item.id, item]))
}

function valueChanged(a: unknown, b: unknown) {
  return JSON.stringify(a) !== JSON.stringify(b)
}

function conflictId(...parts: string[]) {
  return parts.join(':')
}

function fieldLabel(entityType: SyncConflict['entityType'], field: string) {
  const fields = entityType === 'hall' ? hallFields : entityType === 'exhibit' ? exhibitFields : entityType === 'draft' ? draftFields : segmentFields
  return fields.find(item => item.key === field)?.label || field
}

export function describeConflict(conflict: SyncConflict) {
  const field = conflict.kind === 'field' ? fieldLabel(conflict.entityType, conflict.field) : '记录存在状态'
  const type = { hall: '展厅', exhibit: '展项', draft: '语言稿', segment: '段落' }[conflict.entityType]
  return `${type}「${conflict.entityId}」${field}`
}

function mergeScalar<T extends object, K extends keyof T>(
  target: T,
  key: K,
  baseValue: T[K] | undefined,
  localValue: T[K] | undefined,
  remoteValue: T[K] | undefined,
  stats: SyncStats,
  makeConflict: (resolution?: SyncConflictChoice) => SyncConflict,
  conflicts: SyncConflict[],
  forceConflict = false
) {
  const localChanged = valueChanged(baseValue, localValue) || forceConflict
  const remoteChanged = valueChanged(baseValue, remoteValue)
  if (!localChanged && !remoteChanged) {
    if (localValue !== undefined) target[key] = localValue
    return
  }
  if (localChanged && !remoteChanged) {
    if (localValue !== undefined) target[key] = localValue
    stats.accepted++
    return
  }
  if (!localChanged && remoteChanged) {
    if (remoteValue !== undefined) target[key] = remoteValue
    stats.accepted++
    return
  }
  if (valueChanged(localValue, remoteValue)) {
    const existing = conflicts.find(item => item.id === makeConflict().id)
    const conflict = existing || makeConflict()
    if (!existing) conflicts.push(conflict)
    stats.conflicts++
    const chosen = conflict.resolution === 'remote' ? remoteValue : localValue
    if (chosen !== undefined) target[key] = chosen
  } else if (localValue !== undefined) {
    target[key] = localValue
    stats.accepted++
  }
}

function recordConflict(
  idParts: string[],
  entityType: SyncConflict['entityType'],
  entityId: string,
  parentId: string | undefined,
  baseValue: unknown,
  localValue: unknown,
  remoteValue: unknown,
  packageId: string,
  resolution?: SyncConflictChoice,
  field = '__presence__',
  kind: SyncConflict['kind'] = 'presence'
): SyncConflict {
  return {
    id: conflictId(...idParts),
    packageId,
    entityType,
    entityId,
    parentId,
    field,
    kind,
    baseValue,
    localValue,
    remoteValue,
    resolution
  }
}

function reconcileSegment(
  id: string,
  baseDraftId: string | undefined,
  base: Segment | undefined,
  local: Segment | undefined,
  remote: Segment | undefined,
  localTombstones: Set<string>,
  baseTombstones: Set<string>,
  mergedTombstones: Set<string>,
  conflicts: SyncConflict[],
  stats: SyncStats,
  packageId: string
): Segment | undefined {
  const make = (resolution?: SyncConflictChoice) => recordConflict(
    [packageId, 'segment', baseDraftId || 'new', id], 'segment', id, baseDraftId,
    base ? clone(base) : null, local ? clone(local) : null, remote ? clone(remote) : null, packageId, resolution
  )

  if (remote && !base && (baseTombstones.has(id) || localTombstones.has(id))) {
    mergedTombstones.add(id)
    stats.suppressed++
    return undefined
  }

  if (!base) {
    if (local && !remote) {
      stats.localAdds++
      mergedTombstones.delete(id)
      return clone(local)
    }
    if (!local && remote) {
      if (localTombstones.has(id) || baseTombstones.has(id)) {
        mergedTombstones.add(id)
        stats.suppressed++
        return undefined
      }
      stats.remoteAdds++
      return clone(remote)
    }
    if (local && remote) {
      const existing = conflicts.find(item => item.id === make().id)
      const conflict = existing || make()
      if (!existing) conflicts.push(conflict)
      stats.conflicts++
      const chosen = conflict.resolution === 'remote' ? remote : conflict.resolution === 'delete' ? undefined : local
      if (!chosen) mergedTombstones.add(id)
      else mergedTombstones.delete(id)
      return chosen ? clone(chosen) : undefined
    }
    return undefined
  }

  if (base && local && !remote) {
    const localEdited = valueChanged(base, local)
    if (localEdited) {
      const existing = conflicts.find(item => item.id === make().id)
      const conflict = existing || make()
      if (!existing) conflicts.push(conflict)
      stats.conflicts++
      if (conflict.resolution === 'local') {
        mergedTombstones.delete(id)
        return clone(local)
      }
      if (!conflict.resolution) return clone(local)
      if (conflict.resolution === 'delete') {
        mergedTombstones.add(id)
        return undefined
      }
      return undefined
    }
    stats.remoteDeletes++
    mergedTombstones.add(id)
    return undefined
  }

  if (local && !remote) {
    stats.localAdds++
    mergedTombstones.delete(id)
    return clone(local)
  }

  if (!local && remote) {
    if (valueChanged(base, remote)) {
      const existing = conflicts.find(item => item.id === make().id)
      const conflict = existing || make()
      if (!existing) conflicts.push(conflict)
      stats.conflicts++
      if (conflict.resolution === 'remote') {
        stats.revived++
        mergedTombstones.delete(id)
        return clone(remote)
      }
      mergedTombstones.add(id)
      return undefined
    }
    stats.localDeletes++
    mergedTombstones.add(id)
    return undefined
  }

  if (!local && !remote) {
    mergedTombstones.add(id)
    return undefined
  }

  const localDeleted = localTombstones.has(id)
  const localChanged = valueChanged(base, local)
  const remoteChanged = valueChanged(base, remote)
  if (localDeleted && remoteChanged) {
    const existing = conflicts.find(item => item.id === make().id)
    const conflict = existing || make()
    if (!existing) conflicts.push(conflict)
    stats.conflicts++
    if (conflict.resolution === 'remote') {
      stats.revived++
      mergedTombstones.delete(id)
      return clone(remote)
    }
    if (conflict.resolution === 'delete') {
      mergedTombstones.add(id)
      return undefined
    }
    mergedTombstones.add(id)
    return undefined
  } else if (localDeleted) {
    stats.localDeletes++
    mergedTombstones.add(id)
    return undefined
  }

  const localSegment = local
  const remoteSegment = remote
  if (!localSegment || !remoteSegment) return undefined
  const result: Segment = { id, label: localSegment.label, content: localSegment.content, locked: localSegment.locked }
  const protectedRemoteChange = Boolean((base.locked || localSegment.locked) && valueChanged(base, remoteSegment))
  segmentFields.forEach(field => {
    const fieldKey = field.key as keyof Segment
    const forceFieldConflict = protectedRemoteChange && (fieldKey === 'label' || fieldKey === 'content')
    mergeScalar(
      result, fieldKey,
      base[fieldKey] as never,
      localSegment[fieldKey] as never,
      remoteSegment[fieldKey] as never,
      stats,
      resolution => recordConflict(
        [packageId, 'segment', baseDraftId || 'draft', id, String(field.key)], 'segment', id, baseDraftId,
        base[fieldKey] ?? null,
        localSegment[fieldKey] ?? null,
        remoteSegment[fieldKey] ?? null,
        packageId, resolution, String(field.key), 'field'
      ),
      conflicts,
      forceFieldConflict
    )
  })
  return result
}

function signature(value: unknown) {
  return JSON.stringify(value)
}

export function reconcileImport(local: SyncDataset, pkg: SyncPackage, previousConflicts: SyncConflict[] = []): SyncReconciliation {
  const stats = emptyStats()
  const conflicts = clone(previousConflicts.filter(item => item.packageId === pkg.packageId))
  const base = pkg.base
  const remote = pkg.current
  const mergedTombstones = new Set([...local.tombstones, ...base.tombstones])
  const localBaseTombstones = new Set(local.tombstones)
  const baseTombstones = new Set(base.tombstones)

  const baseHalls = toMap(base.halls)
  const localHalls = toMap(local.halls)
  const remoteHalls = toMap(remote.halls)
  const mergedHalls: Hall[] = []

  for (const id of stableSortIds(base.halls.map(item => item.id), localHalls, remoteHalls)) {
    const baseHall = baseHalls.get(id)
    const localHall = localHalls.get(id)
    const remoteHall = remoteHalls.get(id)
    const makePresence = (resolution?: SyncConflictChoice) => recordConflict(
      [pkg.packageId, 'hall', id], 'hall', id, undefined,
      baseHall ? clone(baseHall) : null, localHall ? clone(localHall) : null, remoteHall ? clone(remoteHall) : null,
      pkg.packageId, resolution
    )

    let chosen: Hall | undefined
    if (!baseHall) {
      if (localHall && !remoteHall) { chosen = clone(localHall); stats.localAdds++ }
      else if (!localHall && remoteHall) { chosen = clone(remoteHall); stats.remoteAdds++ }
      else if (localHall && remoteHall) {
        const existing = conflicts.find(item => item.id === makePresence().id)
        const conflict = existing || makePresence()
        if (!existing) conflicts.push(conflict)
        stats.conflicts++
        chosen = clone(conflict.resolution === 'remote' ? remoteHall : conflict.resolution === 'delete' ? undefined : localHall)
      }
    } else {
      const localExists = Boolean(localHall)
      const remoteExists = Boolean(remoteHall)
      if (localExists && !remoteExists) {
        const localChanged = localHall ? valueChanged(baseHall, localHall) : false
        if (localChanged) {
          const existing = conflicts.find(item => item.id === makePresence().id)
          const conflict = existing || makePresence()
          if (!existing) conflicts.push(conflict)
          stats.conflicts++
          const hallChoice = conflict.resolution === 'local' ? localHall : conflict.resolution === 'remote' ? remoteHall : undefined
          if (!conflict.resolution) chosen = clone(localHall)
          else if (hallChoice) chosen = clone(hallChoice)
        } else {
          stats.remoteDeletes++
        }
      } else if (!localExists && remoteExists) {
        const remoteChanged = valueChanged(baseHall, remoteHall)
        if (remoteChanged) {
          const existing = conflicts.find(item => item.id === makePresence().id)
          const conflict = existing || makePresence()
          if (!existing) conflicts.push(conflict)
          stats.conflicts++
          chosen = conflict.resolution === 'remote' ? clone(remoteHall!) : undefined
        } else {
          stats.localDeletes++
        }
      } else if (localHall && remoteHall) {
        chosen = { id, name: localHall.name, description: localHall.description }
        hallFields.forEach(field => mergeScalar(
          chosen!, field.key as keyof Hall,
          baseHall[field.key] as never, localHall[field.key] as never, remoteHall[field.key] as never,
          stats,
          resolution => recordConflict(
            [pkg.packageId, 'hall', id, String(field.key)], 'hall', id, undefined,
            baseHall[field.key] ?? null, localHall[field.key] ?? null, remoteHall[field.key] ?? null,
            pkg.packageId, resolution, String(field.key), 'field'
          ),
          conflicts
        ))
      }
    }
    if (chosen) mergedHalls.push(chosen)
  }

  const mergedHallIds = new Set(mergedHalls.map(item => item.id))
  const baseExhibits = toMap(base.exhibits)
  const localExhibits = toMap(local.exhibits)
  const remoteExhibits = toMap(remote.exhibits)
  const mergedExhibits: Exhibit[] = []

  for (const id of stableSortIds(base.exhibits.map(item => item.id), localExhibits, remoteExhibits)) {
    const baseExhibit = baseExhibits.get(id)
    const localExhibit = localExhibits.get(id)
    const remoteExhibit = remoteExhibits.get(id)
    if ((localExhibit || remoteExhibit) && !mergedHallIds.has((localExhibit || remoteExhibit)!.hallId)) continue

    const makePresence = (resolution?: SyncConflictChoice) => recordConflict(
      [pkg.packageId, 'exhibit', id], 'exhibit', id, undefined,
      baseExhibit ? clone(baseExhibit) : null, localExhibit ? clone(localExhibit) : null, remoteExhibit ? clone(remoteExhibit) : null,
      pkg.packageId, resolution
    )
    let chosen: Exhibit | undefined

    if (!baseExhibit) {
      if (localExhibit && !remoteExhibit) { chosen = clone(localExhibit); stats.localAdds++ }
      else if (!localExhibit && remoteExhibit) { chosen = clone(remoteExhibit); stats.remoteAdds++ }
      else if (localExhibit && remoteExhibit) {
        const existing = conflicts.find(item => item.id === makePresence().id)
        const conflict = existing || makePresence()
        if (!existing) conflicts.push(conflict)
        stats.conflicts++
        chosen = clone(conflict.resolution === 'remote' ? remoteExhibit : conflict.resolution === 'delete' ? undefined : localExhibit)
      }
    } else {
      if (localExhibit && !remoteExhibit) {
        if (valueChanged(signature(baseExhibit), signature(localExhibit))) {
          const existing = conflicts.find(item => item.id === makePresence().id)
          const conflict = existing || makePresence()
          if (!existing) conflicts.push(conflict)
          stats.conflicts++
          const exhibitChoice = conflict.resolution === 'local' ? localExhibit : conflict.resolution === 'remote' ? remoteExhibit : undefined
          if (!conflict.resolution) chosen = clone(localExhibit)
          else if (exhibitChoice) chosen = clone(exhibitChoice)
        } else stats.remoteDeletes++
      } else if (!localExhibit && remoteExhibit) {
        if (valueChanged(signature(baseExhibit), signature(remoteExhibit))) {
          const existing = conflicts.find(item => item.id === makePresence().id)
          const conflict = existing || makePresence()
          if (!existing) conflicts.push(conflict)
          stats.conflicts++
          chosen = conflict.resolution === 'remote' ? clone(remoteExhibit) : undefined
        } else stats.localDeletes++
      } else if (localExhibit && remoteExhibit) {
        chosen = { ...clone(localExhibit), drafts: [] }
        const exhibitTarget = chosen
        exhibitFields.forEach(field => mergeScalar(
          exhibitTarget, field.key as keyof Exhibit,
          baseExhibit![field.key] as never, localExhibit[field.key] as never, remoteExhibit[field.key] as never,
          stats,
          resolution => recordConflict(
            [pkg.packageId, 'exhibit', id, String(field.key)], 'exhibit', id, localExhibit.hallId,
            baseExhibit[field.key] ?? null, localExhibit[field.key] ?? null, remoteExhibit[field.key] ?? null,
            pkg.packageId, resolution, String(field.key), 'field'
          ),
          conflicts
        ))
      }
    }

    if (chosen) {
      const bEx = baseExhibit
      const lEx = localExhibit
      const rEx = remoteExhibit
      const baseDrafts = toMap(bEx?.drafts || [])
      const localDrafts = toMap(lEx?.drafts || [])
      const remoteDrafts = toMap(rEx?.drafts || [])
      const mergedDrafts: LanguageDraft[] = []

      for (const draftId of stableSortIds(bEx?.drafts.map(item => item.id) || [], localDrafts, remoteDrafts)) {
        const baseDraft = baseDrafts.get(draftId)
        const localDraft = localDrafts.get(draftId)
        const remoteDraft = remoteDrafts.get(draftId)
        const makeDraftPresence = (resolution?: SyncConflictChoice) => recordConflict(
          [pkg.packageId, 'draft', draftId], 'draft', draftId, id,
          baseDraft ? clone(baseDraft) : null, localDraft ? clone(localDraft) : null, remoteDraft ? clone(remoteDraft) : null,
          pkg.packageId, resolution
        )
        let draft: LanguageDraft | undefined

        if (!baseDraft) {
          if (localDraft && !remoteDraft) { draft = clone(localDraft); stats.localAdds++ }
          else if (!localDraft && remoteDraft) { draft = clone(remoteDraft); stats.remoteAdds++ }
          else if (localDraft && remoteDraft) {
            const existing = conflicts.find(item => item.id === makeDraftPresence().id)
            const conflict = existing || makeDraftPresence()
            if (!existing) conflicts.push(conflict)
            stats.conflicts++
            const draftChoice = conflict.resolution === 'remote' ? remoteDraft : conflict.resolution === 'delete' ? undefined : localDraft
            draft = draftChoice ? clone(draftChoice) : undefined
          }
        } else if (localDraft && !remoteDraft) {
          if (valueChanged(signature(baseDraft), signature(localDraft))) {
            const existing = conflicts.find(item => item.id === makeDraftPresence().id)
            const conflict = existing || makeDraftPresence()
            if (!existing) conflicts.push(conflict)
            stats.conflicts++
            const draftChoice = conflict.resolution === 'local' ? localDraft : conflict.resolution === 'remote' ? remoteDraft : undefined
            if (!conflict.resolution) draft = clone(localDraft)
            else if (draftChoice) draft = clone(draftChoice)
          } else {
            stats.remoteDeletes++
          }
        } else if (!localDraft && remoteDraft) {
          if (valueChanged(signature(baseDraft), signature(remoteDraft))) {
            const existing = conflicts.find(item => item.id === makeDraftPresence().id)
            const conflict = existing || makeDraftPresence()
            if (!existing) conflicts.push(conflict)
            stats.conflicts++
            if (conflict.resolution === 'remote') draft = clone(remoteDraft)
          } else {
            stats.localDeletes++
          }
        } else if (localDraft && remoteDraft) {
          draft = { ...clone(localDraft), segments: [] }
          const draftTarget = draft
          draftFields.forEach(field => mergeScalar(
            draftTarget, field.key as keyof LanguageDraft,
            baseDraft![field.key] as never, localDraft[field.key] as never, remoteDraft[field.key] as never,
            stats,
            resolution => recordConflict(
              [pkg.packageId, 'draft', draftId, String(field.key)], 'draft', draftId, id,
              baseDraft[field.key] ?? null, localDraft[field.key] ?? null, remoteDraft[field.key] ?? null,
              pkg.packageId, resolution, String(field.key), 'field'
            ),
            conflicts
          ))
          draft.updatedAt = localDraft.updatedAt >= remoteDraft.updatedAt ? localDraft.updatedAt : remoteDraft.updatedAt
        }

        if (draft) {
          const baseSegments = toMap(baseDraft?.segments || [])
          const localSegments = toMap(localDraft?.segments || [])
          const remoteSegments = toMap(remoteDraft?.segments || [])
          const baseSegmentIds = new Set((baseDraft?.segments || []).map(item => item.id))
          const removedFromRemote = new Set(pkg.current.tombstones)
          const iterableSegments = new Map(baseSegments)
          localSegments.forEach((segment, segmentId) => iterableSegments.set(segmentId, segment))
          remoteSegments.forEach((segment, segmentId) => iterableSegments.set(segmentId, segment))
          for (const segmentId of stableSortIds([...baseSegmentIds], new Set([...localBaseTombstones, ...removedFromRemote]), iterableSegments)) {
            const mergedSegment = reconcileSegment(
              segmentId, draftId,
              baseSegments.get(segmentId), localSegments.get(segmentId), remoteSegments.get(segmentId),
              localBaseTombstones,
              baseTombstones, mergedTombstones, conflicts, stats, pkg.packageId
            )
            if (mergedSegment) draft.segments.push(mergedSegment)
          }
          draft.segments = draft.segments.filter(segment => !mergedTombstones.has(segment.id))
          mergedDrafts.push(draft)
        }
      }
      chosen.drafts = mergedDrafts
      mergedExhibits.push(chosen)
    }
  }

  stats.conflicts = conflicts.filter(conflict => !conflict.resolution).length

  return {
    merged: {
      halls: mergedHalls,
      exhibits: mergedExhibits,
      tombstones: Array.from(mergedTombstones).sort()
    },
    conflicts,
    stats
  }
}

export function pendingConflictCount(pending: PendingSyncImport | null) {
  return pending?.conflicts.filter(item => !item.resolution).length || 0
}

export function receiptFromResult(pkg: SyncPackage, result: SyncReconciliation): SyncReceipt {
  return {
    packageId: pkg.packageId,
    exportedAt: pkg.exportedAt,
    importedAt: new Date().toISOString(),
    exportedBy: pkg.exportedBy,
    status: 'success',
    accepted: result.stats.accepted,
    conflicts: result.stats.conflicts,
    localAdds: result.stats.localAdds,
    remoteAdds: result.stats.remoteAdds,
    localDeletes: result.stats.localDeletes,
    remoteDeletes: result.stats.remoteDeletes,
    revived: result.stats.revived,
    suppressed: result.stats.suppressed
  }
}
