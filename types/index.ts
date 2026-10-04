export type ScriptStatus = 'draft' | 'review' | 'returned' | 'approved'
export type DeviceKind = 'desktop' | 'tablet' | 'mobile' | 'kiosk'
export type SyncConflictChoice = 'local' | 'remote' | 'delete'
export type SyncReceiptStatus = 'conflict' | 'success'

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

export interface SyncDataset {
  halls: Hall[]
  exhibits: Exhibit[]
  tombstones: string[]
}

export interface SyncPackage {
  packageId: string
  format: 'museum-script-sync/1'
  exportedAt: string
  exportedBy: string
  note: string
  base: SyncDataset
  current: SyncDataset
}

export interface SyncStats {
  accepted: number
  conflicts: number
  localAdds: number
  remoteAdds: number
  localDeletes: number
  remoteDeletes: number
  revived: number
  suppressed: number
}

export interface SyncConflict {
  id: string
  packageId: string
  entityType: 'hall' | 'exhibit' | 'draft' | 'segment'
  entityId: string
  parentId?: string
  field: string
  kind: 'field' | 'presence'
  baseValue: unknown
  localValue: unknown
  remoteValue: unknown
  resolution?: SyncConflictChoice
}

export interface SyncReconciliation {
  merged: SyncDataset
  conflicts: SyncConflict[]
  stats: SyncStats
}

export interface PendingSyncImport {
  pkg: SyncPackage
  conflicts: SyncConflict[]
}

export interface SyncReceipt {
  packageId: string
  exportedAt: string
  importedAt: string
  exportedBy: string
  status: SyncReceiptStatus
  accepted: number
  conflicts: number
  localAdds: number
  remoteAdds: number
  localDeletes: number
  remoteDeletes: number
  revived: number
  suppressed: number
}

export interface PersistedState {
  halls: Hall[]
  exhibits: Exhibit[]
  versions: VersionSnapshot[]
  syncBaseline: SyncDataset
  tombstones: string[]
  pendingSyncImport: PendingSyncImport | null
  syncReceipts: SyncReceipt[]
  selectedHallId: string
  selectedExhibitId: string
  selectedLanguageId: string
  lastSavedAt: string
}

export interface DiffLine {
  type: 'same' | 'add' | 'remove'
  text: string
}
