import { defineStore } from 'pinia'
import type { Exhibit, Hall, ImportReceipt, Language, LanguageDraft, MergeItem, PersistedState, ScriptStatus, Segment, SyncState, VersionSnapshot, TourPackage } from '~/types'
import {
  applyMerge, buildBaselines, buildReceipt, clone as cloneData, createTourPackage,
  reconcile, uid, validatePackage
} from './sync'

export const LANGUAGES: Language[] = [
  { id: 'zh', code: 'zh-CN', label: '简体中文', shortLabel: '中' },
  { id: 'en', code: 'en-US', label: 'English', shortLabel: 'EN' },
  { id: 'ja', code: 'ja-JP', label: '日本語', shortLabel: '日' }
]

const STORAGE_KEY = 'museum-script-studio-v1'

export function languageLabel(id: string): string {
  return LANGUAGES.find(item => item.id === id)?.label || id
}

function freshSync(halls: Hall[], exhibits: Exhibit[]): SyncState {
  return { baselines: buildBaselines(halls, exhibits), tombstones: {}, receipts: [], pending: null }
}

const segments = (prefix: string, values: Array<[string, string, boolean?]>): Segment[] => values.map(([label, content, locked], index) => ({
  id: `${prefix}-${index + 1}`,
  label,
  content,
  locked: Boolean(locked)
}))

function demoState(): PersistedState {
  const halls: Hall[] = [
    { id: 'hall-ancient', name: '文明肇始厅', description: '史前至先秦文明，共 18 个展项' },
    { id: 'hall-silk', name: '丝路交融厅', description: '丝绸之路上的器物、信仰与生活' },
    { id: 'hall-city', name: '城市记忆厅', description: '近现代城市空间与市民生活' }
  ]
  const exhibits: Exhibit[] = [
    {
      id: 'exhibit-jade', hallId: 'hall-ancient', code: 'A-03', title: '玉琮：沟通天地的礼器', order: 3,
      drafts: [
        {
          id: 'draft-jade-zh', languageId: 'zh', title: '玉琮：沟通天地的礼器',
          narration: '这件玉琮出土于长江下游的良渚遗址。它外方内圆，四角雕刻神人兽面纹，体现了新石器时代晚期精湛的玉器工艺。',
          accessibility: '玉琮为深青色，高约二十厘米。触摸模型可感受方形四角与中央圆孔；圆孔贯穿器身。',
          durationMinutes: 2.5, sources: '《中国玉器全集》第一卷；本馆藏品档案 1987-J-042',
          status: 'approved', updatedAt: '2026-09-23T08:35:00.000Z',
          segments: segments('jade-zh', [
            ['开场定位', '这件玉琮来自距今约五千年的良渚文化。', true],
            ['器物观察', '它外方内圆，四角雕刻神人兽面纹。', true],
            ['文化含义', '玉琮常被看作沟通天地的礼器，也象征权力与身份。'],
            ['参观提示', '请沿展柜顺时针观察，触摸复制品前先使用免洗消毒液。']
          ])
        },
        {
          id: 'draft-jade-en', languageId: 'en', title: 'Jade Cong: A Ritual Object Between Heaven and Earth',
          narration: 'This jade cong was made by the Liangzhu culture. Its square exterior and circular bore embody an early Chinese vision of the cosmos.',
          accessibility: 'The object is dark green. A tactile model shows four corners, carved faces, and a central circular opening.',
          durationMinutes: 2.3, sources: 'Complete Collection of Chinese Jades, Vol. 1; Museum accession 1987-J-042',
          status: 'review', updatedAt: '2026-09-24T02:15:00.000Z',
          segments: segments('jade-en', [
            ['Introduction', 'This jade cong is about five thousand years old.', true],
            ['Visual description', 'Its square body encloses a circular opening, while spirit-and-animal motifs cover the corners.'],
            ['Meaning', 'Jade cong is understood as a ritual link between heaven and earth.']
          ])
        },
        {
          id: 'draft-jade-ja', languageId: 'ja', title: '玉琮：天と地を結ぶ礼器',
          narration: 'こちらは良渚文化の玉琮です。外側は方形、中央は円形で、四隅には神人獣面文が刻まれています。',
          accessibility: '暗い青緑色の玉製です。複製模型では四つの角と中央の円孔を触って確認できます。',
          durationMinutes: 2.6, sources: '『中国玉器全集』第一巻；収蔵資料 1987-J-042',
          status: 'draft', updatedAt: '2026-09-21T06:10:00.000Z',
          segments: segments('jade-ja', [
            ['導入', '約五千年前の良渚文化を代表する玉琮です。'],
            ['観察', '外側は方形、中央は円形で、四隅に精緻な文様があります。'],
            ['意味', '天地を結ぶ礼器として、力と身分を象徴しました。']
          ])
        }
      ]
    },
    {
      id: 'exhibit-bronze', hallId: 'hall-ancient', code: 'A-08', title: '青铜爵与礼制', order: 8,
      drafts: [
        {
          id: 'draft-bronze-zh', languageId: 'zh', title: '青铜爵与礼制',
          narration: '爵是最早的青铜酒器之一。三足稳定器身，长流便于倾倒，柱饰则与商周礼仪密切相关。',
          accessibility: '器物为青铜色，器口一侧有长流，底部三足支撑。复制件配有可触摸的局部纹样。',
          durationMinutes: 3, sources: '《殷周青铜器通论》；展品说明卡 A-08',
          status: 'returned', updatedAt: '2026-09-23T11:20:00.000Z',
          segments: segments('bronze-zh', [
            ['器物介绍', '这是一件商代青铜爵，用于温酒和饮酒。'],
            ['结构说明', '三足使器身稳定，前端的流便于倾倒。'],
            ['礼制背景', '青铜器数量与形制反映了使用者的身份。'],
            ['修改说明', '审校意见：补充“柱饰”的用途，并核对年代。']
          ])
        },
        {
          id: 'draft-bronze-en', languageId: 'en', title: 'Bronze Jue and Ritual Order',
          narration: 'The jue was among the earliest bronze drinking vessels. Its tripod base, pouring spout, and posts were closely tied to Shang and Zhou ritual.',
          accessibility: 'The tactile replica includes the long spout, tripod feet, and raised posts.',
          durationMinutes: 2.8, sources: 'A General Survey of Yin-Zhou Bronzes; Gallery label A-08',
          status: 'draft', updatedAt: '2026-09-22T09:00:00.000Z',
          segments: segments('bronze-en', [['Object', 'This bronze jue dates to the Shang dynasty.'], ['Structure', 'Three legs support the body; the long spout guides the pour.']])
        }
      ]
    },
    {
      id: 'exhibit-silk', hallId: 'hall-silk', code: 'B-02', title: '织机与丝路纹样', order: 2,
      drafts: [{
        id: 'draft-silk-zh', languageId: 'zh', title: '织机与丝路纹样',
        narration: '织机把一根根丝线组织成布匹，也把不同地区的图案与故事连接在一起。',
        accessibility: '体验区提供放大纹样、凸点经纬结构以及可操作的小型织机模型。',
        durationMinutes: 4, sources: '馆内教育活动资料；丝绸之路纺织史专题',
        status: 'draft', updatedAt: '2026-09-20T03:00:00.000Z',
        segments: segments('silk-zh', [['序言', '丝绸不只是一种材料，也是交流的媒介。'], ['互动', '请试着推动梭子，观察经纬线如何交会。']])
      }]
    }
  ]
  return {
    halls,
    exhibits,
    versions: [],
    selectedHallId: halls[0].id,
    selectedExhibitId: exhibits[0].id,
    selectedLanguageId: 'zh',
    lastSavedAt: new Date().toISOString()
  }
}

export const useScriptStore = defineStore('museum-script', {
  state: () => ({
    halls: [] as Hall[],
    exhibits: [] as Exhibit[],
    versions: [] as VersionSnapshot[],
    selectedHallId: '',
    selectedExhibitId: '',
    selectedLanguageId: 'zh',
    lastSavedAt: '',
    hydrated: false,
    past: [] as string[],
    future: [] as string[],
    notice: '',
    sync: null as SyncState | null
  }),
  getters: {
    selectedHall(state): Hall | undefined {
      return state.halls.find(hall => hall.id === state.selectedHallId)
    },
    hallExhibits(state): Exhibit[] {
      return state.exhibits.filter(exhibit => exhibit.hallId === state.selectedHallId).sort((a, b) => a.order - b.order)
    },
    selectedExhibit(state): Exhibit | undefined {
      return state.exhibits.find(exhibit => exhibit.id === state.selectedExhibitId)
    },
    selectedDraft(): LanguageDraft | undefined {
      return this.selectedExhibit?.drafts.find(draft => draft.languageId === this.selectedLanguageId)
    },
    wordCount(): number {
      return (this.selectedDraft?.narration || '').replace(/\s/g, '').length
    },
    canUndo(state): boolean { return state.past.length > 0 },
    canRedo(state): boolean { return state.future.length > 0 }
  },
  actions: {
    hydrate() {
      if (this.hydrated || typeof localStorage === 'undefined') return
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        try {
          const data = JSON.parse(saved) as PersistedState
          this.halls = data.halls || []
          this.exhibits = data.exhibits || []
          this.versions = data.versions || []
          this.selectedHallId = data.selectedHallId || ''
          this.selectedExhibitId = data.selectedExhibitId || ''
          this.selectedLanguageId = data.selectedLanguageId || 'zh'
          this.lastSavedAt = data.lastSavedAt || ''
          this.sync = data.sync || null
          this.hydrated = true
          if (!this.halls.length || !this.exhibits.length) {
            this.resetDemo()
          } else {
            this.upgradeLegacySync()
          }
        } catch {
          this.resetDemo()
        }
      } else {
        this.resetDemo()
      }
      this.ensureSelection()
      this.hydrated = true
    },
    /** 旧本地数据升级：没有巡展基线时，以当前全库为基线补上，删除记录与回执为空 */
    upgradeLegacySync() {
      if (!this.sync) {
        this.sync = freshSync(this.halls, this.exhibits)
        this.persist()
      }
    },
    resetDemo() {
      const demo = demoState()
      this.halls = demo.halls
      this.exhibits = demo.exhibits
      this.versions = demo.versions
      this.selectedHallId = demo.selectedHallId
      this.selectedExhibitId = demo.selectedExhibitId
      this.selectedLanguageId = demo.selectedLanguageId
      this.lastSavedAt = demo.lastSavedAt
      this.sync = freshSync(demo.halls, demo.exhibits)
      this.hydrated = true
      this.past = []
      this.future = []
      this.persist()
      this.notice = '示例数据已就绪，可直接开始编辑。'
    },
    snapshot(): string {
      return JSON.stringify({
        halls: this.halls, exhibits: this.exhibits, versions: this.versions,
        tombstones: this.sync?.tombstones || {}
      })
    },
    commit(mutator: () => void) {
      this.past.push(this.snapshot())
      if (this.past.length > 50) this.past.shift()
      this.future = []
      mutator()
      this.lastSavedAt = new Date().toISOString()
      this.persist()
    },
    persist() {
      if (typeof localStorage === 'undefined') return
      const data: PersistedState = {
        halls: this.halls, exhibits: this.exhibits, versions: this.versions,
        selectedHallId: this.selectedHallId, selectedExhibitId: this.selectedExhibitId,
        selectedLanguageId: this.selectedLanguageId, lastSavedAt: this.lastSavedAt,
        sync: this.sync || undefined
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    },
    ensureSelection() {
      if (!this.halls.some(hall => hall.id === this.selectedHallId)) this.selectedHallId = this.halls[0]?.id || ''
      const inHall = this.exhibits.filter(exhibit => exhibit.hallId === this.selectedHallId)
      if (!inHall.some(exhibit => exhibit.id === this.selectedExhibitId)) this.selectedExhibitId = inHall[0]?.id || ''
      const exhibit = this.selectedExhibit
      if (!exhibit?.drafts.some(draft => draft.languageId === this.selectedLanguageId)) this.selectedLanguageId = exhibit?.drafts[0]?.languageId || 'zh'
    },
    selectHall(id: string) {
      this.selectedHallId = id
      const exhibit = this.exhibits.find(item => item.hallId === id)
      this.selectedExhibitId = exhibit?.id || ''
      this.ensureSelection()
      this.persist()
    },
    selectExhibit(id: string) {
      this.selectedExhibitId = id
      this.ensureSelection()
      this.persist()
    },
    selectLanguage(id: string) {
      this.selectedLanguageId = id
      this.persist()
    },
    updateDraft(patch: Partial<Pick<LanguageDraft, 'title' | 'narration' | 'accessibility' | 'durationMinutes' | 'sources'>>) {
      const draft = this.selectedDraft
      if (!draft) return
      this.commit(() => Object.assign(draft, patch, { updatedAt: new Date().toISOString() }))
      this.notice = '改动已自动保存到浏览器。'
    },
    updateSegment(id: string, patch: Partial<Pick<Segment, 'label' | 'content'>>) {
      const segment = this.selectedDraft?.segments.find(item => item.id === id)
      if (!segment || segment.locked) return
      this.commit(() => Object.assign(segment, patch))
    },
    toggleLock(id: string) {
      const segment = this.selectedDraft?.segments.find(item => item.id === id)
      if (!segment) return
      this.commit(() => { segment.locked = !segment.locked })
      this.notice = segment.locked ? '段落已锁定，避免误改。' : '段落已解锁。'
    },
    addSegment() {
      const draft = this.selectedDraft
      if (!draft) return
      const order = draft.segments.length + 1
      this.commit(() => draft.segments.push({ id: uid('segment'), label: `新段落 ${order}`, content: '', locked: false }))
    },
    removeSegment(id: string) {
      const draft = this.selectedDraft
      const segment = draft?.segments.find(item => item.id === id)
      if (!draft || !segment || segment.locked) return
      this.commit(() => {
        draft.segments = draft.segments.filter(item => item.id !== id)
        // 记录稳定编号墓碑：旧巡展包不能把它复活（撤销时随快照回退）
        const set = new Set(this.sync?.tombstones[draft.id] || [])
        set.add(id)
        if (this.sync) this.sync.tombstones[draft.id] = [...set]
      })
      this.notice = '段落已删除，旧交接包不会再将其带回。'
    },
    setStatus(status: ScriptStatus) {
      const draft = this.selectedDraft
      if (!draft) return
      this.commit(() => { draft.status = status; draft.updatedAt = new Date().toISOString() })
      this.notice = `状态已更新为“${this.statusLabel(status)}”。`
    },
    statusLabel(status: ScriptStatus) {
      return ({ draft: '草稿', review: '待审', returned: '退回', approved: '已定稿' })[status]
    },
    createVersion(name?: string) {
      const draft = this.selectedDraft
      if (!draft) return
      const version: VersionSnapshot = {
        id: `version-${Date.now()}`,
        exhibitId: this.selectedExhibitId,
        languageId: this.selectedLanguageId,
        name: name || `${new Date().toLocaleString('zh-CN', { hour12: false })} 快照`,
        createdAt: new Date().toISOString(),
        draft: JSON.parse(JSON.stringify(draft))
      }
      this.commit(() => this.versions.unshift(version))
      this.notice = '已保存当前版本，可在版本页比较或恢复。'
    },
    restoreVersion(id: string) {
      const version = this.versions.find(item => item.id === id)
      if (!version) return
      this.commit(() => {
        const exhibit = this.exhibits.find(item => item.id === version.exhibitId)
        if (!exhibit) return
        const index = exhibit.drafts.findIndex(item => item.languageId === version.languageId)
        const restored = JSON.parse(JSON.stringify(version.draft)) as LanguageDraft
        // 已删除段落（墓碑）不会因恢复旧快照而复活
        const dead = new Set(this.sync?.tombstones[restored.id] || [])
        if (dead.size) restored.segments = restored.segments.filter(segment => !dead.has(segment.id))
        if (index >= 0) exhibit.drafts[index] = restored
        else exhibit.drafts.push(restored)
      })
      this.selectedExhibitId = version.exhibitId
      this.selectedLanguageId = version.languageId
      this.notice = '版本已恢复，并作为一次可撤销操作保存。'
    },
    undo() {
      const state = this.past.pop()
      if (!state) return
      this.future.push(this.snapshot())
      const restored = JSON.parse(state)
      this.$patch({ halls: restored.halls, exhibits: restored.exhibits, versions: restored.versions })
      if (this.sync) this.sync.tombstones = restored.tombstones || {}
      this.lastSavedAt = new Date().toISOString()
      this.ensureSelection()
      this.persist()
      this.notice = '已撤销上一步。'
    },
    redo() {
      const state = this.future.pop()
      if (!state) return
      this.past.push(this.snapshot())
      const restored = JSON.parse(state)
      this.$patch({ halls: restored.halls, exhibits: restored.exhibits, versions: restored.versions })
      if (this.sync) this.sync.tombstones = restored.tombstones || {}
      this.lastSavedAt = new Date().toISOString()
      this.ensureSelection()
      this.persist()
      this.notice = '已重做。'
    },
    completionFor(exhibit: Exhibit, languageId: string): number {
      const draft = exhibit.drafts.find(item => item.languageId === languageId)
      if (!draft) return 0
      const checks = [draft.title, draft.narration, draft.accessibility, draft.sources, draft.segments.length > 0 ? 'segments' : '']
      return Math.round(checks.filter(Boolean).length / checks.length * 100)
    },

    /* ================= 巡展交接包 ================= */

    requireSync(): SyncState {
      if (!this.sync) this.sync = freshSync(this.halls, this.exhibits)
      return this.sync
    },
    /** 导出巡展交接包：展厅、展项、每种语言稿携带共同基线与删除记录 */
    exportTourPackage(exportedBy: string): TourPackage {
      const sync = this.requireSync()
      return createTourPackage({
        halls: this.halls,
        exhibits: this.exhibits,
        baselines: sync.baselines,
        tombstones: sync.tombstones,
        exportedBy
      })
    },
    /** 读取并校验交接包，按记录字段对账；重复导入同一包只返回既有回执 */
    prepareImport(raw: unknown): { duplicated: boolean; receipt?: ImportReceipt; report?: { pkg: TourPackage; items: MergeItem[] } } {
      const pkg = validatePackage(raw)
      const sync = this.requireSync()
      const existing = sync.receipts.find(receipt => receipt.packageId === pkg.packageId)
      if (existing) {
        this.notice = `该巡展包已于 ${new Date(existing.importedAt).toLocaleString('zh-CN')} 导入，回执不重复生成。`
        return { duplicated: true, receipt: existing }
      }
      const report = reconcile({
        pkg,
        halls: this.halls,
        exhibits: this.exhibits,
        tombstones: sync.tombstones,
        languageLabel,
        hallName: (id: string) => this.halls.find(hall => hall.id === id)?.name || id
      })
      // 未决冲突现场先落盘：写入失败或刷新后仍可继续裁决
      sync.pending = { pkg, items: report.items, report, createdAt: new Date().toISOString() }
      this.persist()
      return { duplicated: false, report: { pkg, items: report.items } }
    },
    /**
     * 按裁决写入。整笔事务：任何一步失败都恢复到导入前状态，
     * 未决冲突继续保留在 sync.pending。
     */
    commitImport(pkg: TourPackage, items: MergeItem[]): ImportReceipt {
      const sync = this.requireSync()
      const backup = JSON.stringify({
        halls: this.halls,
        exhibits: this.exhibits,
        versions: this.versions,
        sync,
        past: this.past,
        future: this.future
      })
      try {
        const local = { halls: cloneData(this.halls), exhibits: cloneData(this.exhibits) }
        const { tombstones, stats } = applyMerge(local, pkg, items, sync.tombstones)

        // 成功：推进基线、留一张回执、清空未决现场
        this.past.push(this.snapshot())
        if (this.past.length > 50) this.past.shift()
        this.future = []
        this.halls = local.halls
        this.exhibits = local.exhibits
        sync.tombstones = tombstones
        sync.baselines = buildBaselines(this.halls, this.exhibits)
        const receipt = buildReceipt(pkg, items, stats)
        sync.receipts = [...sync.receipts.filter(item => item.packageId !== pkg.packageId), receipt]
        sync.pending = null
        this.lastSavedAt = new Date().toISOString()
        this.ensureSelection()
        this.persist()
        this.notice = receipt.summary
        return receipt
      } catch (error) {
        // 失败：恢复导入前状态，未决冲突继续保留
        const before = JSON.parse(backup)
        this.halls = before.halls
        this.exhibits = before.exhibits
        this.versions = before.versions
        this.past = before.past
        this.future = before.future
        this.sync = before.sync
        this.ensureSelection()
        this.persist()
        this.notice = `导入未完成，已恢复导入前状态：${(error as Error).message} 未决冲突已保留。`
        throw error
      }
    },
    /** 放弃本次未决裁决（不写入），保留数据现状 */
    discardPending() {
      if (this.sync) {
        this.sync.pending = null
        this.persist()
      }
    },
    pendingImport(): SyncState['pending'] {
      return this.sync?.pending || null
    }
  }
})
