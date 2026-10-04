<script setup lang="ts">
import type { FieldMergeItem, ImportReceipt, MergeItem, MergeResolution, RemovedSegmentMergeItem, TourPackage } from '~/types'
import { FIELD_LABELS } from '~/stores/sync'
import { useScriptStore } from '~/stores/script'

const store = useScriptStore()

const dialog = ref(false)
const tab = ref<'export' | 'import' | 'receipts'>('export')
const exportedBy = ref('巡展组')
const fileError = ref('')
const lastExportedAt = ref('')

interface ImportSession {
  pkg: TourPackage
  items: MergeItem[]
  duplicated: boolean
  receipt: ImportReceipt | null
}
const session = ref<ImportSession | null>(null)
const pending = computed(() => store.pendingImport())
const receipts = computed(() => (store.sync?.receipts || []).slice().reverse())

const isField = (item: MergeItem): item is FieldMergeItem => item.type === 'field'
const isRemoved = (item: MergeItem): item is RemovedSegmentMergeItem => item.type === 'removed-segment'
const isAdded = (item: MergeItem): item is Extract<MergeItem, { type: 'added' }> => item.type === 'added'

const conflictItems = computed(() =>
  (session.value?.items || []).filter(item =>
    (isField(item) && item.conflict) || (isRemoved(item) && item.conflict)))
const incomingChanges = computed<FieldMergeItem[]>(() =>
  (session.value?.items || []).filter((item): item is FieldMergeItem =>
    isField(item) && !item.conflict && item.changedSide === 'incoming'))
const addedItems = computed(() => (session.value?.items || []).filter(isAdded))
const removedItems = computed(() =>
  (session.value?.items || []).filter((item): item is RemovedSegmentMergeItem => isRemoved(item) && !item.conflict))
const localOnlyCount = computed(() =>
  (session.value?.items || []).filter(item => isField(item) && item.changedSide === 'local' && !item.conflict).length)

watch(dialog, open => {
  if (open) fileError.value = ''
})

function openExport() {
  tab.value = 'export'
  session.value = null
  dialog.value = true
}
function openImport() {
  if (pending.value) {
    resumePending()
    return
  }
  tab.value = 'import'
  session.value = null
  fileError.value = ''
  dialog.value = true
}
function resumePending() {
  if (!pending.value) return
  session.value = { pkg: pending.value.pkg, items: pending.value.items, duplicated: false, receipt: null }
  tab.value = 'import'
  dialog.value = true
}

function doExport() {
  const pkg = store.exportTourPackage(exportedBy.value.trim() || '巡展组')
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const stamp = new Date(pkg.exportedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')
  link.href = url
  link.download = `巡展交接包-${stamp}.json`
  link.click()
  URL.revokeObjectURL(url)
  lastExportedAt.value = pkg.exportedAt
  store.notice = `巡展交接包已导出（编号 ${pkg.packageId.slice(-6)}），含共同基线，可在无网展馆改稿后带回。`
}

function onFileChosen(files: File | File[]) {
  fileError.value = ''
  const file = Array.isArray(files) ? files[0] : files
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result))
      const result = store.prepareImport(raw)
      if (result.duplicated) {
        session.value = { pkg: raw as TourPackage, items: [], duplicated: true, receipt: result.receipt || null }
      } else if (result.report) {
        session.value = { pkg: result.report.pkg, items: result.report.items, duplicated: false, receipt: null }
      }
    } catch (error) {
      fileError.value = (error as Error).message
      session.value = null
    }
  }
  reader.onerror = () => { fileError.value = '读取文件失败，请重试。' }
  reader.readAsText(file)
}

function setResolution(item: MergeItem, resolution: 'local' | 'incoming' | 'skip') {
  item.resolution = resolution
}
function resolveAllConflicts(side: 'local' | 'incoming') {
  for (const item of conflictItems.value) item.resolution = side
}

function confirmImport() {
  if (!session.value) return
  try {
    const receipt = store.commitImport(session.value.pkg, session.value.items)
    session.value = { ...session.value, receipt, items: [] }
    tab.value = 'receipts'
  } catch {
    // 通知已由 store 设置；未决冲突保留，界面仍显示当前裁决
  }
}
function cancelImport() {
  store.discardPending()
  session.value = null
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '（空）'
  if (typeof value === 'boolean') return value ? '锁定' : '未锁定'
  const statusMap: Record<string, string> = { draft: '草稿', review: '待审', returned: '退回', approved: '已定稿' }
  const text = statusMap[String(value)] || String(value)
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}
function targetText(item: MergeItem): string {
  const t = item.target
  const parts = [t.name]
  if (t.languageLabel) parts.push(t.languageLabel)
  if (t.kind === 'segment') parts.unshift('段落')
  return parts.join(' · ')
}
function fieldItem(item: MergeItem): FieldMergeItem | null {
  return item.type === 'field' ? item : null
}
function fieldLabel(item: FieldMergeItem): string {
  return FIELD_LABELS[item.field] || item.field
}
function removedItem(item: MergeItem): RemovedSegmentMergeItem | null {
  return item.type === 'removed-segment' ? item : null
}
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

defineExpose({ resumePending, openImport, openExport })
</script>

<template>
  <v-btn variant="outlined" prepend-icon="mdi-package-variant-closed" @click="openExport">巡展交接</v-btn>

  <!-- 巡展对话框挂载到 body，避免受按钮组布局影响 -->
  <Teleport to="body">
    <v-dialog v-model="dialog" max-width="860" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center ga-2">
          <v-icon icon="mdi-transit-transfer" color="primary" />
          巡展交接包
        </v-card-title>
        <v-card-text>
          <v-tabs v-model="tab" color="primary" density="compact" class="mb-4">
            <v-tab value="export">导出给巡展组</v-tab>
            <v-tab value="import">回馆导入对账</v-tab>
            <v-tab value="receipts">导入回执（{{ receipts.length }}）</v-tab>
          </v-tabs>

          <!-- 导出 -->
          <div v-if="tab === 'export'">
            <p class="text-body-2 text-medium-emphasis mb-4">
              交接包会为<strong>每个展厅、展项和每种语言稿</strong>附带共同基线，并记录已删除段落的稳定编号。
              巡展组在无网展馆离线改稿，回馆后按字段逐一对账，不会覆盖馆内新锁定的段落。
            </p>
            <v-text-field v-model="exportedBy" label="导出人 / 巡展组名" hide-details="auto" class="mb-4" />
            <v-alert v-if="lastExportedAt" type="success" variant="tonal" density="compact" class="mb-4">
              上次导出：{{ formatTime(lastExportedAt) }}。继续在馆内编辑后请重新导出，基线才是最新的。
            </v-alert>
            <v-btn color="primary" prepend-icon="mdi-download-outline" @click="doExport">下载交接包 JSON</v-btn>
          </div>

          <!-- 导入 -->
          <div v-if="tab === 'import'">
            <template v-if="!session">
              <p class="text-body-2 text-medium-emphasis mb-4">
                选择巡展组带回的交接包。系统按“共同基线 / 馆内当前 / 巡展当前”三方对账：
                只有一边改过的字段自动接收；同一字段两边都改过会列为冲突，由你选定后才写入。
              </p>
              <v-file-input
                accept="application/json,.json"
                label="选择巡展交接包"
                prepend-icon="mdi-file-upload-outline"
                :error="Boolean(fileError)"
                :error-messages="fileError"
                @update:model-value="onFileChosen"
              />
            </template>

            <template v-else-if="session.duplicated">
              <v-alert type="info" variant="tonal" class="mb-4">
                这个包已经导入过（编号 {{ session.pkg.packageId }}）。同一个包重复导入只保留一张回执，不会重复写入。
              </v-alert>
              <v-card v-if="session.receipt" variant="tonal" class="pa-4">
                <div class="font-weight-medium mb-1">{{ session.receipt.summary }}</div>
                <div class="text-caption text-medium-emphasis">导入时间：{{ formatTime(session.receipt.importedAt) }}</div>
              </v-card>
            </template>

            <template v-else>
              <div class="d-flex flex-wrap align-center ga-3 mb-4">
                <v-chip color="primary" variant="tonal" size="small">来自：{{ session.pkg.exportedBy }}</v-chip>
                <v-chip variant="tonal" size="small">导出：{{ formatTime(session.pkg.exportedAt) }}</v-chip>
                <v-chip :color="conflictItems.length ? 'error' : 'success'" variant="tonal" size="small">
                  {{ conflictItems.length }} 处冲突
                </v-chip>
                <v-chip variant="tonal" size="small">{{ incomingChanges.length }} 处巡展改动可自动接收</v-chip>
                <v-chip variant="tonal" size="small">{{ addedItems.length }} 条新增</v-chip>
                <v-chip variant="tonal" size="small">{{ removedItems.length }} 段删除</v-chip>
              </div>

              <!-- 冲突 -->
              <div v-if="conflictItems.length" class="mb-5">
                <div class="d-flex align-center justify-space-between mb-2">
                  <div class="section-title text-error">待裁决冲突（{{ conflictItems.length }}）</div>
                  <div>
                    <v-btn size="small" variant="text" @click="resolveAllConflicts('local')">全部保留馆内</v-btn>
                    <v-btn size="small" variant="text" @click="resolveAllConflicts('incoming')">全部采用巡展</v-btn>
                  </div>
                </div>
                <div class="d-flex flex-column ga-3">
                  <v-card v-for="item in conflictItems" :key="item.key" variant="tonal" class="pa-3 conflict-card">
                    <div class="d-flex flex-wrap align-center justify-space-between ga-2 mb-2">
                      <div class="font-weight-medium">{{ targetText(item) }}</div>
                      <v-btn-toggle mandatory mandatory-color="primary" density="compact" :model-value="item.resolution" @update:model-value="setResolution(item, ($event as MergeResolution))">
                        <v-btn value="local" size="small" class="text-caption">保留馆内</v-btn>
                        <v-btn value="incoming" size="small" class="text-caption">采用巡展</v-btn>
                      </v-btn-toggle>
                    </div>
                    <div class="text-caption text-medium-emphasis mb-2">
                      {{ fieldItem(item) ? fieldLabel(fieldItem(item)!) : '段落删除冲突' }}
                    </div>
                    <div v-if="fieldItem(item)" class="d-flex flex-column ga-2">
                      <div class="value-row local"><span class="value-tag">馆内</span>{{ displayValue(fieldItem(item)!.local) }}</div>
                      <div class="value-row incoming"><span class="value-tag">巡展</span>{{ displayValue(fieldItem(item)!.incoming) }}</div>
                    </div>
                    <div v-else-if="removedItem(item)" class="d-flex flex-column ga-2">
                      <div class="value-row local"><span class="value-tag">馆内仍保留</span>{{ displayValue(removedItem(item)!.local) }}</div>
                      <div class="value-row incoming"><span class="value-tag">巡展已删除</span>采用巡展则删除该段并记录编号，旧包无法复活</div>
                    </div>
                  </v-card>
                </div>
              </div>

              <!-- 自动接收 -->
              <v-expansion-panels v-if="incomingChanges.length" class="mb-3 bg-transparent">
                <v-expansion-panel>
                  <v-expansion-panel-title>
                    巡展单边改动（{{ incomingChanges.length }}，自动接收）
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <v-list density="compact" class="bg-transparent">
                      <v-list-item v-for="item in incomingChanges" :key="item.key" :title="targetText(item)" :subtitle="`${fieldLabel(item)}：${displayValue(item.incoming)}`">
                        <template #prepend><v-icon icon="mdi-arrow-collapse-right" color="success" size="small" /></template>
                      </v-list-item>
                    </v-list>
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>

              <!-- 新增 -->
              <div v-if="addedItems.length" class="mb-3">
                <div class="section-title mb-2">新增记录（{{ addedItems.length }}）</div>
                <div class="d-flex flex-column ga-2">
                  <v-card v-for="item in addedItems" :key="item.key" variant="tonal" class="pa-3 d-flex align-center justify-space-between ga-2">
                    <div>
                      <div class="font-weight-medium">{{ targetText(item) }}</div>
                      <div class="text-caption text-medium-emphasis">{{ item.preview }}</div>
                    </div>
                    <v-btn-toggle mandatory mandatory-color="primary" density="compact" :model-value="item.resolution" @update:model-value="setResolution(item, ($event as MergeResolution))">
                      <v-btn value="incoming" size="small" class="text-caption">接收</v-btn>
                      <v-btn value="skip" size="small" class="text-caption">跳过</v-btn>
                    </v-btn-toggle>
                  </v-card>
                </div>
              </div>

              <!-- 删除 -->
              <div v-if="removedItems.length" class="mb-3">
                <div class="section-title mb-2">巡展端删除的段落（{{ removedItems.length }}，按稳定编号对账）</div>
                <div class="d-flex flex-column ga-2">
                  <v-card v-for="item in removedItems" :key="item.key" variant="tonal" class="pa-3 d-flex align-center justify-space-between ga-2">
                    <div>
                      <div class="font-weight-medium">{{ targetText(item) }}</div>
                      <div class="text-caption text-medium-emphasis">删除后旧交接包不能复活</div>
                    </div>
                    <v-btn-toggle mandatory mandatory-color="primary" density="compact" :model-value="item.resolution" @update:model-value="setResolution(item, ($event as MergeResolution))">
                      <v-btn value="incoming" size="small" class="text-caption">确认删除</v-btn>
                      <v-btn value="skip" size="small" class="text-caption">保留该段</v-btn>
                    </v-btn-toggle>
                  </v-card>
                </div>
              </div>

              <v-alert v-if="!session.items.length" type="success" variant="tonal" class="mb-4">
                馆内与巡展内容一致，没有需要写入的改动；确认后仅记录一张回执。
              </v-alert>
              <v-alert v-if="localOnlyCount" type="info" variant="tonal" density="compact" class="mb-4">
                另有 {{ localOnlyCount }} 处仅馆内改过的字段，巡展包未改动，将原样保留。
              </v-alert>

              <div class="d-flex justify-end ga-2 mt-4">
                <v-btn @click="cancelImport">放弃导入</v-btn>
                <v-btn color="primary" variant="tonal" @click="confirmImport">仅写入自动接收项</v-btn>
                <v-btn color="primary" :disabled="Boolean(conflictItems.length)" @click="confirmImport">
                  {{ conflictItems.length ? '先解决全部冲突' : '确认写入' }}
                </v-btn>
              </div>
            </template>
          </div>

          <!-- 回执 -->
          <div v-if="tab === 'receipts'">
            <v-empty-state v-if="!receipts.length" icon="mdi-receipt-text-outline" title="还没有导入回执" text="成功导入巡展包后会在这里留一张回执。" />
            <v-card v-for="receipt in receipts" :key="receipt.packageId" variant="tonal" class="pa-4 mb-3">
              <div class="d-flex align-center justify-space-between mb-1">
                <div class="font-weight-medium">{{ receipt.summary }}</div>
                <v-chip size="x-small" variant="outlined">{{ receipt.packageId.slice(-8) }}</v-chip>
              </div>
              <div class="text-caption text-medium-emphasis">
                来自 {{ receipt.exportedBy }} · 导出 {{ formatTime(receipt.exportedAt) }} · 导入 {{ formatTime(receipt.importedAt) }}
              </div>
            </v-card>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">关闭</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </Teleport>
</template>

<style scoped>
.section-title {
  font-size: 0.85rem;
  letter-spacing: 0.08em;
  color: #7a5c2e;
  font-weight: 600;
}
.conflict-card {
  border-left: 3px solid #b00020;
}
.value-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 0.875rem;
  line-height: 1.6;
  white-space: pre-wrap;
}
.value-row.local {
  background: rgba(176, 0, 32, 0.06);
}
.value-row.incoming {
  background: rgba(47, 107, 69, 0.08);
}
.value-tag {
  flex: none;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.08);
}
</style>
