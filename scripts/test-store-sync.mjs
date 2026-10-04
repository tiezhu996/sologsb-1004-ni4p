/**
 * store 层巡展导入测试：事务回滚、同包回执去重、未决冲突保留、旧数据升级。
 * 运行：npm run test:store
 */
import { createJiti } from 'jiti'
import { createPinia, setActivePinia } from 'pinia'

// localStorage 桩
class LocalStorageStub {
  constructor() { this.map = new Map() }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) { this.map.set(key, String(value)) }
  removeItem(key) { this.map.delete(key) }
  clear() { this.map.clear() }
}
globalThis.localStorage = new LocalStorageStub()

const jiti = createJiti(import.meta.url, { alias: { '~': '/workspace', '#app': '/workspace/scripts/stubs/app.mjs' } })
await jiti.import('/workspace/scripts/stubs/app.mjs')
const { useScriptStore } = await jiti.import('/workspace/stores/script.ts')
const { createTourPackage, buildBaselines } = await jiti.import('/workspace/stores/sync.ts')

let passed = 0, failed = 0
function assert(condition, message) {
  if (condition) passed++
  else { failed++; console.error('  ✗ ' + message) }
}
function section(title) { console.log('\n■ ' + title) }

function freshStore() {
  localStorage.clear()
  setActivePinia(createPinia())
  const store = useScriptStore()
  store.hydrate()
  return store
}

/* 1. 旧数据升级：无 sync 的持久化数据在 hydrate 后补齐基线 */
section('1. 旧本地数据升级：自动补基线')
{
  setActivePinia(createPinia())
  const store = useScriptStore()
  // 构造旧格式数据（无 sync）
  const oldData = {
    halls: [{ id: 'h-old', name: '旧厅', description: '' }],
    exhibits: [{ id: 'e-old', hallId: 'h-old', code: 'Z-1', title: '旧展项', order: 1, drafts: [] }],
    versions: [],
    selectedHallId: 'h-old', selectedExhibitId: 'e-old', selectedLanguageId: 'zh', lastSavedAt: ''
  }
  localStorage.setItem('museum-script-studio-v1', JSON.stringify(oldData))
  store.hydrate()
  assert(store.sync !== null, '升级后 sync 已建立')
  assert(store.sync.baselines.halls.some(h => h.id === 'h-old'), '基线以当前展厅补齐')
  assert(store.sync.baselines.exhibits.some(e => e.id === 'e-old'), '基线以当前展项补齐')
  assert(Object.keys(store.sync.tombstones).length === 0 && store.sync.receipts.length === 0, '墓碑/回执为空')
  const persisted = JSON.parse(localStorage.getItem('museum-script-studio-v1'))
  assert(persisted.sync && persisted.sync.baselines, '升级结果已持久化')
}

/* 2. 完整导入：单边改动自动写入 + 回执 + 基线推进 */
section('2. 正常导入：自动接收、回执、基线推进')
{
  const store = freshStore()
  const pkg = createTourPackage({
    halls: store.halls, exhibits: store.exhibits,
    baselines: store.sync.baselines, tombstones: store.sync.tombstones,
    exportedBy: '巡展组'
  })
  const target = pkg.current.exhibits[0].drafts[0]
  target.narration = target.narration + '【巡展补充】'

  const result = store.prepareImport(JSON.parse(JSON.stringify(pkg)))
  assert(!result.duplicated && result.report, '首次导入不重复')
  const receipt = store.commitImport(pkg, result.report.items)
  assert(receipt.appliedCount >= 1, '回执记录写入数：' + receipt.summary)
  assert(store.sync.receipts.length === 1, '留存一张回执')
  assert(store.sync.pending === null, '成功后未决现场清空')
  assert(store.exhibits[0].drafts[0].narration.includes('【巡展补充】'), '内容已写入')
  assert(store.sync.baselines.exhibits[0].drafts[0].narration.includes('【巡展补充】'), '基线已推进到新值')
  assert(store.past.length === 1, '导入可撤销（入栈一次）')
}

/* 3. 同包重复导入：只返回既有回执，不重复写入 */
section('3. 同一包重复导入只留一张回执')
{
  const store = freshStore()
  const pkg = createTourPackage({
    halls: store.halls, exhibits: store.exhibits,
    baselines: store.sync.baselines, tombstones: {}, exportedBy: '巡展组'
  })
  pkg.current.exhibits[0].drafts[0].title = '标题A'
  const first = store.prepareImport(JSON.parse(JSON.stringify(pkg)))
  store.commitImport(pkg, first.report.items)
  assert(store.sync.receipts.length === 1, '首次导入 1 张回执')

  // 再拿同一份包文件导入
  const second = store.prepareImport(JSON.parse(JSON.stringify(pkg)))
  assert(second.duplicated === true, '识别为重复包')
  assert(store.sync.receipts.length === 1, '不新增回执')
}

/* 4. 冲突未决：pending 落盘；强行写入失败时回滚且保留 pending */
section('4. 未决冲突保留 + 写入失败回滚导入前状态')
{
  const store = freshStore()
  const beforeTitle = store.exhibits[0].drafts[0].title
  const pkg = createTourPackage({
    halls: store.halls, exhibits: store.exhibits,
    baselines: store.sync.baselines, tombstones: {}, exportedBy: '巡展组'
  })
  // 巡展单边改动 + 双边冲突
  const draft = pkg.current.exhibits[0].drafts[0]
  draft.sources = '巡展改来源'
  draft.narration = '巡展改讲解词'
  store.exhibits[0].drafts[0].narration = '馆内改讲解词'
  store.persist()

  const result = store.prepareImport(JSON.parse(JSON.stringify(pkg)))
  assert(store.sync.pending !== null, '对账后未决现场已持久化（刷新可继续）')
  const conflicts = result.report.items.filter(i => (i.type === 'field' || i.type === 'removed-segment') && i.conflict)
  assert(conflicts.some(i => i.field === 'narration'), '讲解词冲突在列')

  // 直接 commitImport 未解决冲突 → 抛错、回滚、pending 保留
  let threw = false
  try {
    store.commitImport(pkg, result.report.items)
  } catch { threw = true }
  assert(threw, '未裁决时提交抛错')
  assert(store.sync.pending !== null, '失败后未决冲突继续保留')
  assert(store.exhibits[0].drafts[0].sources !== '巡展改来源', '单边改动也随回滚未写入')
  assert(store.exhibits[0].drafts[0].narration === '馆内改讲解词', '馆内值原样保留')
  assert(store.sync.receipts.length === 0, '失败不留回执')
  assert(store.exhibits[0].drafts[0].title === beforeTitle, '其他数据恢复导入前状态')

  // 裁决后重新提交成功
  result.report.items.forEach(i => { if (i.conflict) i.resolution = 'incoming' })
  const receipt = store.commitImport(pkg, result.report.items)
  assert(receipt.conflictCount >= 1, '回执含冲突裁决计数')
  assert(store.exhibits[0].drafts[0].sources === '巡展改来源', '单边改动写入')
  assert(store.exhibits[0].drafts[0].narration === '巡展改讲解词', '冲突按裁决写入')
  assert(store.sync.pending === null, '成功后 pending 清空')
}

/* 5. 段落删除墓碑：本地删除后旧包无法复活；随撤销回退 */
section('5. 段落删除记墓碑，旧包导入不复活；撤销回退墓碑')
{
  const store = freshStore()
  const draft = store.exhibits[0].drafts[0]
  const segId = draft.segments[0].id
  // 先解锁再删（示例第一段可能是锁定的）
  if (draft.segments[0].locked) { draft.segments[0].locked = false }
  store.selectExhibit(store.exhibits[0].id)
  store.selectLanguage(draft.languageId)
  store.removeSegment(segId)
  assert(!store.selectedDraft.segments.find(s => s.id === segId), '段落已删除')
  assert(store.sync.tombstones[draft.id].includes(segId), '稳定编号记入墓碑')

  // 导出一份含旧段落的“旧包”（基于删除前基线不可能，手工构造：基线与当前都含该段）
  const state = { halls: JSON.parse(JSON.stringify(store.halls)), exhibits: JSON.parse(JSON.stringify(store.exhibits)) }
  // 把该段塞回一个旧包
  state.exhibits[0].drafts[0].segments.unshift({ id: segId, label: '幽灵段', content: '复活内容', locked: false })
  const oldPkg = createTourPackage({
    halls: state.halls, exhibits: state.exhibits,
    baselines: buildBaselines(state.halls, state.exhibits),
    tombstones: {}, exportedBy: '旧巡展'
  })
  const result = store.prepareImport(JSON.parse(JSON.stringify(oldPkg)))
  assert(!result.duplicated, '旧包通过校验')
  store.commitImport(oldPkg, result.report.items)
  assert(!store.selectedDraft.segments.find(s => s.id === segId), '旧包不能复活已删段落')

  // 撤销：先撤销导入，再撤销删除，墓碑随快照回退
  store.undo()
  store.undo()
  assert(store.selectedDraft.segments.find(s => s.id === segId), '撤销后段落恢复')
  assert(!(store.sync.tombstones[draft.id] || []).includes(segId), '撤销后墓碑回退')
}

/* 6. 持久化往返：刷新模拟（重新 hydrate）后 pending 仍在 */
section('6. 刷新后未决冲突继续保留')
{
  const store = freshStore()
  const pkg = createTourPackage({
    halls: store.halls, exhibits: store.exhibits,
    baselines: store.sync.baselines, tombstones: {}, exportedBy: '巡展组'
  })
  pkg.current.exhibits[0].drafts[0].narration = '巡展改讲解词'
  store.exhibits[0].drafts[0].narration = '馆内改讲解词'
  store.persist()
  const result = store.prepareImport(JSON.parse(JSON.stringify(pkg)))
  assert(result.report.items.some(i => i.conflict), '制造一处冲突')

  // 模拟刷新：新 pinia + 重新 hydrate
  setActivePinia(createPinia())
  const reborn = useScriptStore()
  reborn.hydrate()
  const pending = reborn.pendingImport()
  assert(pending && pending.pkg.packageId === pkg.packageId, '刷新后未决现场可恢复')
  pending.items.forEach(i => { if (i.conflict) i.resolution = 'local' })
  reborn.commitImport(pending.pkg, pending.items)
  assert(reborn.exhibits[0].drafts[0].narration === '馆内改讲解词', '续裁保留馆内内容')
}

console.log(`\n========================================`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failed) process.exit(1)
