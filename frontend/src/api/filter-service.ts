import type {
  DatasetChange,
  DatasetFieldChangeInput,
  DatasetRecord,
  DrillHitRow,
  DrillSnapshot,
  FieldChangeResult,
  FieldConflict,
  FieldConflictComparison,
  FieldSample,
  FilterResultDetail,
  FilterRuleSpec,
  FilterState,
  FilterWorkspace,
  PendingRevalidation,
  RevalidationRun,
  RuleVersionState,
  SortDirection,
} from '@/data/filter-types'
import {
  DATASETS,
  DISCOUNT_MIXED_SAMPLES,
  DISCOUNT_NUMERIC_SAMPLES,
  DRILL_DATASET_LINKS,
  FILTER_RULE_SEEDS,
  OPERATOR_BY_LABEL,
  OPERATOR_LABELS,
} from '@/data/filter-seed'
import {
  MAX_AUDIT_ENTRIES,
  clearFilterState,
  readFilterState,
  writeFilterState,
} from '@/data/filter-persistence'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import {
  archivedConditions,
  evaluateRule,
  fieldKindOf,
  semanticsFor,
} from './filter-engine'

/**
 * 筛选域服务：字段依赖索引、局部重验、结果明细归档、冲突取舍。
 *
 * 硬约束：
 * 1. 一条规则最多一份结果明细，所有写入统一走 publishResult；
 * 2. 依赖索引与规则版本在同一次 saveState 落盘，不会出现索引新版本旧的中间态；
 * 3. 字段变化只重验引用该字段的规则，其余规则沿用已启用结果；
 * 4. 排序字段或输出上限变化必须整组重排；
 * 5. 重验中断后未完成规则保留 pending，恢复时只处理这些规则。
 */

const SCHEMA_VERSION = 1

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function fingerprint(values: string[]): string {
  const list = unique(values.filter((value) => value !== ''))
  return list.length ? list.join('|') : '∅'
}

function findDataset(state: FilterState, datasetCode: string) {
  return {
    fields: state.datasetFields[datasetCode] ?? [],
    records: state.datasetRecords[datasetCode] ?? [],
  }
}

function findRule(state: FilterState, ruleCode: string): FilterRuleSpec | null {
  return state.rules[ruleCode] ?? null
}

function fieldDependencies(rule: FilterRuleSpec): string[] {
  // 规则只依赖筛选字段和排序字段；两侧任一变化都必须重验。
  return unique([rule.filterField, rule.sortField])
}

function dependencyFingerprint(state: FilterState, rule: FilterRuleSpec): string {
  return fingerprint(fieldDependencies(rule))
}

function datasetFingerprint(state: FilterState, datasetCode: string): string {
  return fingerprint(state.datasetFields[datasetCode] ?? [])
}

function primaryResultId(ruleCode: string): string {
  return `RESULT-${ruleCode}`
}

function allRuleCodes(state: FilterState): string[] {
  return Object.keys(state.rules).sort((left, right) => left.localeCompare(right))
}

function recordAudit(
  state: FilterState,
  action: string,
  detail: string,
  ruleCodes?: string[],
): void {
  state.auditLog.unshift({
    id: `AUD-${state.revision}-${state.auditLog.length + 1}`,
    at: nowIso(),
    action,
    detail,
    ruleCodes: ruleCodes ? [...ruleCodes] : undefined,
    indexRevision: state.indexRevision,
  })
  state.auditLog = state.auditLog.slice(0, MAX_AUDIT_ENTRIES)
}

function rebuildDependencyIndex(state: FilterState): void {
  const index: FilterState['dependencyIndex'] = {}
  for (const rule of Object.values(state.rules)) {
    const datasetIndex = index[rule.datasetCode] ?? {}
    for (const field of fieldDependencies(rule)) {
      datasetIndex[field] = unique([...(datasetIndex[field] ?? []), rule.ruleCode])
    }
    index[rule.datasetCode] = datasetIndex
  }
  state.dependencyIndex = index
}

function rulesDependOn(state: FilterState, datasetCode: string, field: string): string[] {
  return [...(state.dependencyIndex[datasetCode]?.[field] ?? [])].sort((left, right) =>
    left.localeCompare(right),
  )
}

/**
 * 唯一落盘口：依赖索引、规则版本号版本线、审计一起写入。
 * 读取方要么读到旧的一整套，要么读到新的一整套。
 */
function saveState(
  state: FilterState,
  action: string,
  detail: string,
  ruleCodes?: string[],
): void {
  state.revision += 1
  state.indexRevision += 1
  state.updatedAt = nowIso()
  rebuildDependencyIndex(state)
  if (state.run) {
    state.run.indexRevision = state.indexRevision
  }
  for (const rule of Object.values(state.rules)) {
    const version = state.ruleVersions[rule.ruleCode]
    if (version) {
      version.indexRevision = state.indexRevision
    }
  }
  recordAudit(state, action, detail, ruleCodes)
  // 先镜像列表行（顺带更新行签名），再整体落盘，快照与状态保持同一次写入。
  mirrorEntries(state)
  writeFilterState(state)
}

/** 规则状态与结果明细同源：每次落盘后把列表行镜像成最新规则。 */
function mirrorEntries(state: FilterState): void {
  const entries = renderEntries(state)
  saveRows('filter', entries)
  for (const row of entries) {
    state.entrySnapshots[String(row['规则编号'])] = entrySignature(row)
  }
}

/** 规则版本随字段依赖变化递增；结果明细里归档的是当时那一版。 */
function bumpRuleVersion(
  state: FilterState,
  ruleCode: string,
  reason: string,
): RuleVersionState {
  const rule = findRule(state, ruleCode)
  const current = state.ruleVersions[ruleCode]
  const next: RuleVersionState = {
    version: (current?.version ?? 0) + 1,
    reason,
    updatedAt: nowIso(),
    dependencyFingerprint: rule ? dependencyFingerprint(state, rule) : current?.dependencyFingerprint ?? '',
    indexRevision: state.indexRevision + 1,
  }
  state.ruleVersions[ruleCode] = next
  return next
}

type PublishInput = {
  origin: FilterResultDetail['origin']
  note: string
  revalidationVersion: number
  status?: FilterResultDetail['status']
  /** 用于跳过重复提交：内容未变化时不产生新版本。 */
  skipIfUnchanged?: boolean
}

type PublishOutcome = {
  result: FilterResultDetail
  created: boolean
  unchanged: boolean
  scannedRows: number
}

/**
 * 结果明细的唯一写入口。局部重验、整组重排、冲突重算、手工提交全部走这里，
 * resultId 固定为 `RESULT-<规则编号>`，因此同一规则永远只有一份字段明细。
 */
function publishResult(
  state: FilterState,
  rule: FilterRuleSpec,
  input: PublishInput,
): PublishOutcome {
  const { fields, records } = findDataset(state, rule.datasetCode)
  const semantics = semanticsFor(records, rule)
  const evaluated = evaluateRule(records, fields, rule, semantics)
  const existing = state.results[rule.ruleCode] ?? null
  const fieldFp = datasetFingerprint(state, rule.datasetCode)
  if (
    input.skipIfUnchanged &&
    existing &&
    existing.contentHash === evaluated.contentHash &&
    existing.fieldFingerprint === fieldFp
  ) {
    return { result: existing, created: false, unchanged: true, scannedRows: evaluated.scannedRows }
  }
  const ruleVersion = state.ruleVersions[rule.ruleCode]?.version ?? 1
  const result: FilterResultDetail = {
    resultId: existing?.resultId ?? primaryResultId(rule.ruleCode),
    ruleCode: rule.ruleCode,
    datasetCode: rule.datasetCode,
    version: existing ? existing.version + 1 : 1,
    revalidationVersion: existing
      ? Math.max(existing.revalidationVersion, input.revalidationVersion)
      : input.revalidationVersion,
    status: input.status ?? 'ready',
    origin: input.origin,
    archivedRule: {
      ...clone(rule),
      ruleVersion,
      dependencyFingerprint: dependencyFingerprint(state, rule),
    },
    archivedConditions: archivedConditions(rule, semantics),
    hitRows: evaluated.hitRows,
    matchedCount: evaluated.matchedCount,
    truncated: evaluated.truncated,
    rowLimit: rule.rowLimit,
    sortField: rule.sortField,
    sortDirection: rule.sortDirection,
    fieldFingerprint: fieldFp,
    dependencyFingerprint: dependencyFingerprint(state, rule),
    contentHash: evaluated.contentHash,
    idempotencyKey: `${rule.ruleCode}@${ruleVersion}:${evaluated.contentHash}`,
    missingFields: evaluated.missingFields,
    orderVerified: evaluated.orderVerified,
    publishedAt: nowIso(),
    publishedBy: '值班管理员',
    previousVersion: existing ? existing.version : null,
    note: input.note,
  }
  state.results[rule.ruleCode] = result
  syncDrillSnapshots(state, rule, result)
  return { result, created: existing === null, unchanged: false, scannedRows: evaluated.scannedRows }
}

/** 重验后的命中行同步到关联下钻快照，未重验规则的原命中行原样保留。 */
function syncDrillSnapshots(
  state: FilterState,
  rule: FilterRuleSpec,
  result: FilterResultDetail,
): void {
  for (const [drillCode, datasetCode] of Object.entries(DRILL_DATASET_LINKS)) {
    if (datasetCode !== rule.datasetCode) {
      continue
    }
    const existing: DrillSnapshot = state.drillSnapshots[drillCode] ?? {
      drillCode,
      datasetCode,
      hitRows: [],
      linkedResults: {},
      retainedVersions: [],
      updatedAt: nowIso(),
    }
    const ours: DrillHitRow[] = result.hitRows.map((row) => ({
      ...row,
      values: { ...row.values },
      sourceRuleCode: rule.ruleCode,
      sourceResultVersion: result.version,
      retainedAt: nowIso(),
    }))
    const kept = existing.hitRows.filter((row) => row.sourceRuleCode !== rule.ruleCode)
    const merged = [...kept, ...ours].sort((left, right) => {
      if (left.sourceRuleCode !== right.sourceRuleCode) {
        return left.sourceRuleCode.localeCompare(right.sourceRuleCode)
      }
      return left.position - right.position
    })
    const linkedResults = {
      ...existing.linkedResults,
      [rule.ruleCode]: {
        ruleCode: rule.ruleCode,
        resultVersion: result.version,
        hitCount: result.hitRows.length,
        updatedAt: nowIso(),
      },
    }
    state.drillSnapshots[drillCode] = {
      drillCode,
      datasetCode,
      hitRows: merged,
      linkedResults,
      retainedVersions: unique([...existing.retainedVersions, result.version]).sort(
        (left, right) => left - right,
      ),
      updatedAt: nowIso(),
    }
  }
}

function markPending(
  state: FilterState,
  rule: FilterRuleSpec,
  options: {
    changedFields: string[]
    reason: PendingRevalidation['reason']
    origin: PendingRevalidation['origin']
    reorderRequired: boolean
    changeId: string | null
    note?: string
  },
): PendingRevalidation {
  const active = state.pending.find(
    (item) =>
      item.ruleCode === rule.ruleCode &&
      (item.status === 'pending' || item.status === 'running'),
  )
  if (active) {
    active.changedFields = unique([...active.changedFields, ...options.changedFields])
    active.status = 'pending'
    active.reorderRequired = active.reorderRequired || options.reorderRequired
    active.ruleVersion = state.ruleVersions[rule.ruleCode]?.version ?? active.ruleVersion
    active.indexRevision = state.indexRevision
    return active
  }
  const entry: PendingRevalidation = {
    id: `PEND-${state.revision}-${state.pending.length + 1}-${rule.ruleCode}`,
    ruleCode: rule.ruleCode,
    datasetCode: rule.datasetCode,
    changedFields: [...options.changedFields],
    reason: options.reason,
    origin: options.origin,
    status: 'pending',
    ruleVersion: state.ruleVersions[rule.ruleCode]?.version ?? 1,
    indexRevision: state.indexRevision,
    reorderRequired: options.reorderRequired,
    versionBefore: state.results[rule.ruleCode]?.version ?? 0,
    resultVersion: null,
    attempts: 0,
    createdAt: nowIso(),
    completedAt: null,
    note: options.note ?? (options.changeId ? `字段变化 ${options.changeId}` : '等待重验'),
  }
  state.pending.push(entry)
  return entry
}

function createRun(
  state: FilterState,
  mode: RevalidationRun['mode'],
  plannedRules: string[],
  unaffectedRules: string[],
  changeId: string | null,
): RevalidationRun {
  const run: RevalidationRun = {
    id: `RUN-${state.revision + 1}-${Date.now().toString(36)}`,
    mode,
    status: 'running',
    startedAt: nowIso(),
    finishedAt: null,
    plannedRules: [...plannedRules],
    processedRules: [],
    skippedRules: [],
    unaffectedRules: [...unaffectedRules],
    interruptedAfter: null,
    scannedRows: 0,
    hitRows: 0,
    indexRevision: state.indexRevision,
    changeId,
  }
  state.run = run
  return run
}

function completeRun(state: FilterState, run: RevalidationRun): void {
  run.status = 'completed'
  run.finishedAt = nowIso()
  run.indexRevision = state.indexRevision
}

/**
 * 按计划只读取计划内规则；每条规则只读一次数据集，其他规则不扫描。
 * stopAfter 模拟中途中断：未处理规则保持 pending。
 */
function processPending(
  state: FilterState,
  run: RevalidationRun,
  stopAfter: number | null,
): void {
  const seen = new Set<string>()
  for (const ruleCode of run.plannedRules) {
    if (seen.has(ruleCode)) {
      continue
    }
    seen.add(ruleCode)
    if (stopAfter !== null && run.processedRules.length >= stopAfter) {
      break
    }
    const item = state.pending.find(
      (entry) =>
        entry.ruleCode === ruleCode &&
        (entry.status === 'pending' || entry.status === 'running'),
    )
    const rule = findRule(state, ruleCode)
    if (!item || !rule) {
      run.skippedRules.push(ruleCode)
      continue
    }
    item.status = 'running'
    item.ruleVersion = state.ruleVersions[ruleCode]?.version ?? item.ruleVersion
    item.indexRevision = state.indexRevision
    item.attempts += 1
    const outcome = publishResult(state, rule, {
      origin: item.origin,
      note: item.note,
      revalidationVersion: item.attempts,
    })
    item.status = 'done'
    item.completedAt = nowIso()
    item.resultVersion = outcome.result.version
    run.processedRules.push(ruleCode)
    run.scannedRows += outcome.scannedRows
    run.hitRows += outcome.result.hitRows.length
  }
  const plannedCompleted = run.plannedRules.every(
    (ruleCode) =>
      run.processedRules.includes(ruleCode) || run.skippedRules.includes(ruleCode),
  )
  if (plannedCompleted) {
    completeRun(state, run)
    return
  }
  run.status = 'interrupted'
  run.interruptedAfter = run.processedRules.length
  run.finishedAt = nowIso()
  for (const item of state.pending) {
    if (item.status === 'running') {
      item.status = 'pending'
      item.note = `重验中断，等待恢复（已尝试 ${item.attempts} 次）`
    }
  }
}

function bootstrapState(): FilterState {
  const state: FilterState = {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    indexRevision: 1,
    updatedAt: nowIso(),
    datasetFields: {},
    datasetRecords: {},
    rules: {},
    ruleVersions: {},
    dependencyIndex: {},
    results: {},
    pending: [],
    run: null,
    conflicts: [],
    appliedChanges: {},
    processedSubmissions: {},
    entrySnapshots: {},
    drillSnapshots: {},
    auditLog: [],
    lastChange: null,
  }
  for (const dataset of DATASETS) {
    state.datasetFields[dataset.code] = [...dataset.fields]
    state.datasetRecords[dataset.code] = clone(dataset.records)
  }
  for (const rule of FILTER_RULE_SEEDS) {
    state.rules[rule.ruleCode] = clone(rule)
    state.ruleVersions[rule.ruleCode] = {
      version: 1,
      reason: '规则初始登记',
      updatedAt: nowIso(),
      dependencyFingerprint: fingerprint(fieldDependencies(rule)),
      indexRevision: 1,
    }
  }
  rebuildDependencyIndex(state)
  for (const rule of Object.values(state.rules)) {
    if (rule.status !== '已启用') {
      continue
    }
    publishResult(state, rule, {
      origin: 'initial',
      note: '首次启用的基线结果',
      revalidationVersion: 0,
    })
  }
  recordAudit(
    state,
    '初始化筛选结果',
    `已生成 ${Object.keys(state.results).length} 条规则的字段明细`,
    Object.keys(state.results),
  )
  mirrorEntries(state)
  writeFilterState(state)
  return state
}

function renderEntries(state: FilterState): EntryRow[] {
  return allRuleCodes(state).map((ruleCode) => {
    const rule = state.rules[ruleCode]
    return {
      id: rule.id,
      status: rule.status,
      pending: rule.status !== '已启用',
      abnormal: state.pending.some(
        (item) =>
          item.ruleCode === ruleCode &&
          (item.status === 'pending' || item.status === 'running'),
      ),
      规则编号: rule.ruleCode,
      目标数据集: rule.datasetCode,
      筛选字段: rule.filterField,
      比较运算符: OPERATOR_LABELS[rule.operator],
      比较值: rule.compareValue,
      逻辑组合: rule.logic,
      排序字段: rule.sortField,
      输出行数上限: rule.rowLimit,
    }
  })
}

function entrySignature(row: EntryRow): string {
  return [
    String(row['目标数据集'] ?? ''),
    String(row['筛选字段'] ?? ''),
    String(row['比较运算符'] ?? ''),
    String(row['比较值'] ?? ''),
    String(row['逻辑组合'] ?? ''),
    String(row['排序字段'] ?? ''),
    String(row['输出行数上限'] ?? ''),
    String(row.status ?? ''),
  ].join('|')
}

function submissionKey(rule: FilterRuleSpec): string {
  return [
    rule.ruleCode,
    rule.datasetCode,
    rule.filterField,
    rule.operator,
    rule.compareValue,
    rule.logic,
    rule.sortField,
    rule.sortDirection,
    rule.rowLimit,
  ].join('|')
}

/**
 * 读取筛选模块列表行，把页面上的提交同步到筛选域。
 * 只处理「列表行签名相对上次镜像发生变化」的行，重复读取同一份列表不会再次生成结果。
 */
function syncSubmissionsFromEntries(state: FilterState): boolean {
  let changed = false
  const rows = listRows('filter')
  for (const row of rows) {
    const ruleCode = String(row['规则编号'] ?? '')
    const rule = state.rules[ruleCode]
    if (!rule) {
      continue
    }
    const signature = entrySignature(row)
    if (state.entrySnapshots[ruleCode] === signature) {
      continue
    }
    const operator = OPERATOR_BY_LABEL[String(row['比较运算符'] ?? '')] ?? rule.operator
    const logic = String(row['逻辑组合'] ?? rule.logic) === 'OR' ? 'OR' : 'AND'
    const rowLimit = Number(row['输出行数上限'])
    const next: FilterRuleSpec = {
      ...rule,
      datasetCode: String(row['目标数据集'] ?? rule.datasetCode),
      filterField: String(row['筛选字段'] ?? rule.filterField),
      operator,
      compareValue: String(row['比较值'] ?? rule.compareValue),
      logic,
      sortField: String(row['排序字段'] ?? rule.sortField),
      rowLimit: Number.isFinite(rowLimit) && rowLimit > 0 ? rowLimit : rule.rowLimit,
      status: String(row.status ?? rule.status),
    }
    state.entrySnapshots[ruleCode] = signature
    const key = submissionKey(next)
    if (state.processedSubmissions[key]) {
      if (processStatusChange(state, ruleCode, rule, next.status)) {
        changed = true
      }
      continue
    }
    state.processedSubmissions[key] = {
      ruleCode,
      resultVersion: state.results[ruleCode]?.version ?? 0,
      at: nowIso(),
    }
    const configChanged =
      next.datasetCode !== rule.datasetCode ||
      next.filterField !== rule.filterField ||
      next.operator !== rule.operator ||
      next.compareValue !== rule.compareValue ||
      next.logic !== rule.logic ||
      next.sortField !== rule.sortField ||
      next.rowLimit !== rule.rowLimit
    if (configChanged) {
      const sortOrLimitChanged = next.sortField !== rule.sortField || next.rowLimit !== rule.rowLimit
      state.rules[ruleCode] = next
      bumpRuleVersion(state, ruleCode, sortOrLimitChanged ? '排序/上限调整' : '规则内容提交')
      const result = state.results[ruleCode]
      publishResult(state, next, {
        origin: sortOrLimitChanged ? 'full-reorder' : 'manual-submit',
        note: sortOrLimitChanged ? '排序字段或输出上限变化，整组重排' : '规则提交后重新读取',
        revalidationVersion: (result?.revalidationVersion ?? 0) + 1,
      })
      recordAudit(
        state,
        sortOrLimitChanged ? '整组重排' : '规则提交',
        `${ruleCode} 结果明细更新到 v${state.results[ruleCode]?.version ?? 0}`,
        [ruleCode],
      )
      changed = true
      continue
    }
    if (processStatusChange(state, ruleCode, rule, next.status)) {
      changed = true
    }
  }
  return changed
}

/** 规则启用/停用：启用时补齐结果明细，停用时保留可回看的结果，不新增版本。 */
function processStatusChange(
  state: FilterState,
  ruleCode: string,
  rule: FilterRuleSpec,
  nextStatus: string,
): boolean {
  if (rule.status === nextStatus) {
    return false
  }
  const enabling = nextStatus === '已启用' && rule.status !== '已启用'
  state.rules[ruleCode] = { ...rule, status: nextStatus }
  if (enabling) {
    bumpRuleVersion(state, ruleCode, '规则启用')
    const existing = state.results[ruleCode]
    publishResult(state, state.rules[ruleCode], {
      origin: existing ? 'manual-submit' : 'initial',
      note: existing ? '规则重新启用，沿用同一份结果明细' : '规则启用后首次生成结果明细',
      revalidationVersion: (existing?.revalidationVersion ?? 0) + (existing ? 0 : 1),
      skipIfUnchanged: !!existing,
    })
  }
  return true
}

export function ensureFilterState(): FilterState {
  const existing = readFilterState()
  if (!existing) {
    return bootstrapState()
  }
  const changed = syncSubmissionsFromEntries(existing)
  if (changed) {
    saveState(existing, '同步筛选规则提交', '规则列表与结果明细已对齐')
  }
  return existing
}

/** 只读排干列表提交：在变更/重排前执行，避免提交被同一份快照覆盖回去。 */
function drainSubmissions(state: FilterState): void {
  if (syncSubmissionsFromEntries(state)) {
    saveState(state, '同步筛选规则提交', '规则列表与结果明细已对齐')
  }
}

export function resetFilterState(): FilterState {
  clearFilterState()
  return bootstrapState()
}

export function loadFilterWorkspace(): FilterWorkspace {
  const state = ensureFilterState()
  const results = Object.values(state.results)
  const rules = allRuleCodes(state).map((ruleCode) => {
    const rule = state.rules[ruleCode]
    return {
      rule: clone(rule),
      ruleVersion: clone(state.ruleVersions[ruleCode]),
      dependencies: fieldDependencies(rule),
      dependencyFingerprint: dependencyFingerprint(state, rule),
      result: state.results[ruleCode] ? clone(state.results[ruleCode]) : null,
      pending: clone(
        state.pending.find(
          (item) =>
            item.ruleCode === ruleCode &&
            (item.status === 'pending' || item.status === 'running'),
        ) ?? null,
      ),
    }
  })
  const openConflicts = state.conflicts.filter((item) => item.decision === null)
  const datasets = DATASETS.map((dataset) => {
    const records = state.datasetRecords[dataset.code] ?? []
    const fields = state.datasetFields[dataset.code] ?? []
    const fieldKinds: Record<string, 'numeric' | 'text' | 'mixed' | 'empty'> = {}
    for (const field of fields) {
      fieldKinds[field] = fieldKindOf(records, field)
    }
    return {
      code: dataset.code,
      name: dataset.name,
      sourceTable: dataset.sourceTable,
      fields,
      recordCount: records.length,
      fieldKinds,
    }
  })
  return {
    revision: state.revision,
    indexRevision: state.indexRevision,
    updatedAt: state.updatedAt,
    datasetFields: clone(state.datasetFields),
    datasets,
    rules,
    results: results.map((item) => clone(item)),
    resultCount: results.length,
    pending: state.pending
      .filter((item) => item.status === 'pending' || item.status === 'running')
      .map((item) => clone(item)),
    run: state.run ? clone(state.run) : null,
    conflict: openConflicts.length ? clone(openConflicts[openConflicts.length - 1]) : null,
    conflicts: state.conflicts.map((item) => clone(item)),
    lastChange: state.lastChange ? clone(state.lastChange) : null,
    drillSnapshots: Object.values(state.drillSnapshots).map((item) => clone(item)),
    auditLog: state.auditLog.map((item) => clone(item)),
    perRuleSingleDetail:
      new Set(results.map((item) => item.ruleCode)).size === results.length,
  }
}

function classifySamples(samples: FieldSample[]): { numeric: number; text: number } {
  let numeric = 0
  let text = 0
  for (const sample of samples) {
    if (typeof sample.value === 'number') {
      numeric += 1
      continue
    }
    const trimmed = String(sample.value).trim()
    if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
      numeric += 1
    } else {
      text += 1
    }
  }
  return { numeric, text }
}

function withSamples(
  records: DatasetRecord[],
  samples: FieldSample[],
  field: string,
): DatasetRecord[] {
  const byRow = new Map(samples.map((sample) => [sample.rowId, sample.value]))
  return records.map((record) => {
    if (!byRow.has(record.rowId)) {
      return record
    }
    return {
      ...record,
      values: { ...record.values, [field]: byRow.get(record.rowId) as string | number },
    }
  })
}

function applySamples(
  state: FilterState,
  datasetCode: string,
  field: string,
  samples: FieldSample[],
): void {
  state.datasetRecords[datasetCode] = withSamples(
    state.datasetRecords[datasetCode] ?? [],
    samples,
    field,
  )
  const fields = state.datasetFields[datasetCode] ?? []
  if (!fields.includes(field)) {
    state.datasetFields[datasetCode] = [...fields, field]
  }
}

/**
 * 冲突两条路径的可比较测算：结果版本影响、命中行数、待重验规则。
 * 取舍时按这份对照决定，不再靠感觉。
 */
function comparisonFor(
  state: FilterState,
  datasetCode: string,
  field: string,
  affectedRules: string[],
  samples: FieldSample[],
  strategy: 'keep-current' | 'recompute',
): FieldConflictComparison {
  const fields = state.datasetFields[datasetCode] ?? []
  const currentRecords = state.datasetRecords[datasetCode] ?? []
  const recomputeRecords = withSamples(currentRecords, samples, field)
  const resultVersions: Record<string, number> = {}
  const hitCounts: Record<string, number> = {}
  for (const ruleCode of affectedRules) {
    const rule = findRule(state, ruleCode)
    if (!rule) {
      continue
    }
    const current = state.results[ruleCode]
    if (strategy === 'keep-current') {
      resultVersions[ruleCode] = current?.version ?? 0
      hitCounts[ruleCode] = current?.hitRows.length ?? 0
      continue
    }
    resultVersions[ruleCode] = (current?.version ?? 0) + 1
    const semantics = semanticsFor(recomputeRecords, rule)
    hitCounts[ruleCode] = evaluateRule(recomputeRecords, fields, rule, semantics).hitRows.length
  }
  return {
    resultVersionEffect: strategy === 'keep-current' ? 'unchanged' : 'single-new-version',
    resultVersions,
    hitCounts,
    pendingRules: strategy === 'keep-current' ? [...affectedRules] : [],
    semantics: strategy === 'keep-current' ? 'numeric-first' : 'compat-text',
    summary:
      strategy === 'keep-current'
        ? '保留当前筛选结果明细；受影响规则进入待重验清单，本次不新增结果版本。'
        : '按文本兼容语义重算受影响规则，每条规则发布一个新版本；结果明细仍只有一份。',
  }
}

function buildConflict(
  state: FilterState,
  input: DatasetFieldChangeInput,
  kinds: { numeric: number; text: number },
  affectedRules: string[],
): FieldConflict {
  return {
    id: `CONF-${state.revision + 1}-${input.changeId}`,
    datasetCode: input.datasetCode,
    field: input.field,
    changeId: input.changeId,
    detectedAt: nowIso(),
    sampleKinds: kinds,
    affectedRules,
    currentVersions: Object.fromEntries(
      affectedRules.map((ruleCode) => [ruleCode, state.results[ruleCode]?.version ?? 0]),
    ),
    keepCurrent: comparisonFor(
      state,
      input.datasetCode,
      input.field,
      affectedRules,
      input.samples,
      'keep-current',
    ),
    recompute: comparisonFor(
      state,
      input.datasetCode,
      input.field,
      affectedRules,
      input.samples,
      'recompute',
    ),
    candidate: clone(input),
    decision: null,
    decidedAt: null,
  }
}

function emptyChangeResult(
  state: FilterState,
  message: string,
  strategy: 'keep-current' | 'recompute',
): FieldChangeResult {
  return {
    ok: false,
    duplicate: false,
    message,
    changeId: '',
    strategy,
    affectedRules: [],
    skippedRules: [],
    conflict: null,
    run: state.run ? clone(state.run) : null,
    resultVersions: {},
    indexRevision: state.indexRevision,
    ruleVersions: Object.fromEntries(
      Object.entries(state.ruleVersions).map(([code, version]) => [code, version.version]),
    ),
  }
}

export function applyDatasetFieldChange(input: DatasetFieldChangeInput): FieldChangeResult {
  const state = ensureFilterState()
  drainSubmissions(state)
  const priorConflict = state.conflicts.find((item) => item.changeId === input.changeId)
  const priorStrategy = state.appliedChanges[input.changeId]
  if (priorStrategy !== undefined || priorConflict) {
    const affected = priorConflict?.affectedRules ?? rulesDependOn(state, input.datasetCode, input.field)
    return {
      ok: true,
      duplicate: true,
      message: `变化 ${input.changeId} 已受理，不会重复写入或重复生成结果明细`,
      changeId: input.changeId,
      strategy: priorConflict?.decision ?? priorStrategy ?? 'keep-current',
      affectedRules: affected,
      skippedRules: allRuleCodes(state).filter((code) => !affected.includes(code)),
      conflict: priorConflict ? clone(priorConflict) : null,
      run: state.run ? clone(state.run) : null,
      resultVersions: Object.fromEntries(
        affected.map((ruleCode) => [ruleCode, state.results[ruleCode]?.version ?? 0]),
      ),
      indexRevision: state.indexRevision,
      ruleVersions: Object.fromEntries(
        Object.entries(state.ruleVersions).map(([code, version]) => [code, version.version]),
      ),
    }
  }

  const affectedRules = rulesDependOn(state, input.datasetCode, input.field)
  const untouchedRules = allRuleCodes(state).filter((code) => !affectedRules.includes(code))
  const kinds = classifySamples(input.samples)
  const mixed = kinds.numeric > 0 && kinds.text > 0

  // 同名字段同时有文本和数值样本：先不覆盖当前明细，只生成待重验清单与冲突对照。
  if (mixed && !input.strategy) {
    const fields = state.datasetFields[input.datasetCode] ?? []
    if (!fields.includes(input.field)) {
      state.datasetFields[input.datasetCode] = [...fields, input.field]
    }
    for (const ruleCode of affectedRules) {
      const rule = findRule(state, ruleCode)
      if (!rule) {
        continue
      }
      bumpRuleVersion(state, ruleCode, '字段口径冲突待取舍')
      markPending(state, rule, {
        changedFields: [input.field],
        reason: 'conflict-keep-current',
        origin: 'local-revalidation',
        reorderRequired: rule.sortField === input.field,
        changeId: input.changeId,
        note: `口径冲突待取舍：${input.field}`,
      })
    }
    const conflict = buildConflict(state, input, kinds, affectedRules)
    state.conflicts.push(conflict)
    saveState(
      state,
      '检测到字段口径冲突',
      `${input.datasetCode}.${input.field} 同时包含文本与数值样本，保留当前明细并生成待重验清单`,
      affectedRules,
    )
    return {
      ok: true,
      duplicate: false,
      message: '字段同时包含文本与数值样本：已保留当前明细并生成待重验清单，等待口径取舍',
      changeId: input.changeId,
      strategy: 'keep-current',
      affectedRules,
      skippedRules: untouchedRules,
      conflict: clone(conflict),
      run: null,
      resultVersions: Object.fromEntries(
        affectedRules.map((ruleCode) => [ruleCode, state.results[ruleCode]?.version ?? 0]),
      ),
      indexRevision: state.indexRevision,
      ruleVersions: Object.fromEntries(
        Object.entries(state.ruleVersions).map(([code, version]) => [code, version.version]),
      ),
    }
  }

  const strategy: 'keep-current' | 'recompute' = input.strategy ?? 'recompute'
  if (strategy === 'recompute') {
    applySamples(state, input.datasetCode, input.field, input.samples)
  } else {
    const fields = state.datasetFields[input.datasetCode] ?? []
    if (!fields.includes(input.field)) {
      state.datasetFields[input.datasetCode] = [...fields, input.field]
    }
  }
  state.appliedChanges[input.changeId] = strategy

  const beforeVersions: Record<string, number> = {}
  for (const ruleCode of affectedRules) {
    const rule = findRule(state, ruleCode)
    if (!rule) {
      continue
    }
    beforeVersions[ruleCode] = state.results[ruleCode]?.version ?? 0
    bumpRuleVersion(state, ruleCode, '字段依赖更新')
    const reorder = rule.sortField === input.field
    markPending(state, rule, {
      changedFields: [input.field],
      reason: reorder ? 'reorder' : 'field-change',
      origin: reorder ? 'full-reorder' : 'local-revalidation',
      reorderRequired: reorder,
      changeId: input.changeId,
    })
  }

  const run = createRun(state, 'partial', affectedRules, untouchedRules, input.changeId)
  if (strategy === 'recompute') {
    processPending(state, run, input.stopAfter ?? null)
  } else {
    run.status = 'interrupted'
    run.interruptedAfter = 0
    run.finishedAt = nowIso()
  }
  const afterVersions = Object.fromEntries(
    affectedRules.map((ruleCode) => [ruleCode, state.results[ruleCode]?.version ?? 0]),
  )
  const change: DatasetChange = {
    changeId: input.changeId,
    datasetCode: input.datasetCode,
    field: input.field,
    samples: input.samples.map((sample) => sample.value),
    appliedAt: nowIso(),
    strategy,
    affectedRules,
    skippedRules: untouchedRules,
    beforeVersions,
    afterVersions,
    conflictId: null,
  }
  state.lastChange = change
  saveState(
    state,
    strategy === 'recompute' ? '字段变化后局部重验' : '字段变化受理',
    `${input.datasetCode}.${input.field} 仅重验 ${affectedRules.join('、') || '无规则'}；${
      untouchedRules.join('、') || '无'
    } 沿用已启用结果`,
    affectedRules,
  )
  return {
    ok: true,
    duplicate: false,
    message: `已受理 ${input.datasetCode}.${input.field} 变化，重验 ${affectedRules.length} 条规则`,
    changeId: input.changeId,
    strategy,
    affectedRules,
    skippedRules: untouchedRules,
    conflict: null,
    run: state.run ? clone(state.run) : null,
    resultVersions: afterVersions,
    indexRevision: state.indexRevision,
    ruleVersions: Object.fromEntries(
      Object.entries(state.ruleVersions).map(([code, version]) => [code, version.version]),
    ),
  }
}

export function decideConflict(
  conflictId: string,
  strategy: 'keep-current' | 'recompute',
): FieldChangeResult {
  const state = ensureFilterState()
  drainSubmissions(state)
  const conflict = state.conflicts.find((item) => item.id === conflictId)
  if (!conflict) {
    return emptyChangeResult(state, `没有找到 ${conflictId} 这个口径冲突`, strategy)
  }
  if (conflict.decision !== null) {
    return {
      ...emptyChangeResult(state, `冲突 ${conflictId} 已按${conflict.decision}处理，不重复生成版本`, conflict.decision),
      ok: true,
      duplicate: true,
      changeId: conflict.changeId,
      conflict: clone(conflict),
      affectedRules: conflict.affectedRules,
      resultVersions: Object.fromEntries(
        conflict.affectedRules.map((ruleCode) => [ruleCode, state.results[ruleCode]?.version ?? 0]),
      ),
    }
  }
  conflict.decision = strategy
  conflict.decidedAt = nowIso()
  const affectedRules = conflict.affectedRules
  const untouchedRules = allRuleCodes(state).filter((code) => !affectedRules.includes(code))
  const beforeVersions: Record<string, number> = { ...conflict.currentVersions }

  if (strategy === 'keep-current') {
    // 保留当前明细：结果版本不动，规则继续留在待重验清单，等下一次显式重验。
    state.appliedChanges[conflict.changeId] = 'keep-current'
    saveState(
      state,
      '冲突取舍：保留当前明细',
      `${conflict.field} 计算口径不覆盖当前结果，${affectedRules.join('、')} 留在待重验清单`,
      affectedRules,
    )
    return {
      ok: true,
      duplicate: false,
      message: '已保留当前筛选结果明细，受影响规则列入待重验清单',
      changeId: conflict.changeId,
      strategy,
      affectedRules,
      skippedRules: untouchedRules,
      conflict: clone(conflict),
      run: null,
      resultVersions: { ...beforeVersions },
      indexRevision: state.indexRevision,
      ruleVersions: Object.fromEntries(
        Object.entries(state.ruleVersions).map(([code, version]) => [code, version.version]),
      ),
    }
  }

  applySamples(state, conflict.datasetCode, conflict.field, conflict.candidate.samples)
  state.appliedChanges[conflict.changeId] = 'recompute'
  for (const ruleCode of affectedRules) {
    const rule = findRule(state, ruleCode)
    if (!rule) {
      continue
    }
    bumpRuleVersion(state, ruleCode, '冲突按新语义重算')
    const pending = state.pending.find(
      (entry) =>
        entry.ruleCode === ruleCode &&
        (entry.status === 'pending' || entry.status === 'running'),
    )
    if (pending) {
      pending.reason = 'conflict-recompute'
      pending.origin = 'conflict-recompute'
      pending.status = 'pending'
      pending.note = `按新语义重算 ${conflict.field}`
    } else {
      markPending(state, rule, {
        changedFields: [conflict.field],
        reason: 'conflict-recompute',
        origin: 'conflict-recompute',
        reorderRequired: rule.sortField === conflict.field,
        changeId: conflict.changeId,
        note: `按新语义重算 ${conflict.field}`,
      })
    }
  }
  const run = createRun(state, 'partial', affectedRules, untouchedRules, conflict.changeId)
  processPending(state, run, null)
  const change: DatasetChange = {
    changeId: conflict.changeId,
    datasetCode: conflict.datasetCode,
    field: conflict.field,
    samples: conflict.candidate.samples.map((sample) => sample.value),
    appliedAt: nowIso(),
    strategy,
    affectedRules,
    skippedRules: untouchedRules,
    beforeVersions,
    afterVersions: Object.fromEntries(
      affectedRules.map((ruleCode) => [ruleCode, state.results[ruleCode]?.version ?? 0]),
    ),
    conflictId: conflict.id,
  }
  state.lastChange = change
  saveState(
    state,
    '冲突取舍：按新语义重算',
    `${conflict.field} 按 ${conflict.recompute.semantics} 重算，发布新版本`,
    affectedRules,
  )
  return {
    ok: true,
    duplicate: false,
    message: '已按新语义重算受影响规则并发布新版本',
    changeId: conflict.changeId,
    strategy,
    affectedRules,
    skippedRules: untouchedRules,
    conflict: clone(conflict),
    run: state.run ? clone(state.run) : null,
    resultVersions: change.afterVersions,
    indexRevision: state.indexRevision,
    ruleVersions: Object.fromEntries(
      Object.entries(state.ruleVersions).map(([code, version]) => [code, version.version]),
    ),
  }
}

export function interruptRevalidation(): {
  ok: boolean
  message: string
  run: RevalidationRun | null
} {
  const state = ensureFilterState()
  drainSubmissions(state)
  if (!state.run || state.run.status === 'completed') {
    return {
      ok: false,
      message: '当前没有进行中的重验批次',
      run: state.run ? clone(state.run) : null,
    }
  }
  state.run.status = 'interrupted'
  state.run.interruptedAfter = state.run.processedRules.length
  state.run.finishedAt = nowIso()
  for (const item of state.pending) {
    if (item.status === 'running') {
      item.status = 'pending'
      item.note = '重验中断，等待恢复'
    }
  }
  saveState(
    state,
    '重验中断',
    `已处理 ${state.run.processedRules.length} 条，剩余规则保留在待重验清单`,
  )
  return { ok: true, message: '重验已中断，未完成规则仍在待重验清单', run: clone(state.run) }
}

/**
 * 恢复重验：只挑未完成（pending/running）的规则，已完成规则不重复扫描。
 * limit 用于演示恢复后再次中断。
 */
export function resumeRevalidation(options: { limit?: number } = {}): {
  ok: boolean
  message: string
  run: RevalidationRun | null
} {
  const state = ensureFilterState()
  drainSubmissions(state)
  const unfinished = state.pending.filter(
    (item) => item.status === 'pending' || item.status === 'running',
  )
  if (!unfinished.length) {
    return {
      ok: false,
      message: '没有未完成的规则需要重验',
      run: state.run ? clone(state.run) : null,
    }
  }
  for (const item of unfinished) {
    item.status = 'pending'
  }
  const plannedRules = unique(unfinished.map((item) => item.ruleCode)).sort((left, right) =>
    left.localeCompare(right),
  )
  const unaffectedRules = allRuleCodes(state).filter((code) => !plannedRules.includes(code))
  const run = createRun(
    state,
    state.run && state.run.status === 'interrupted' ? 'resume' : 'partial',
    plannedRules,
    unaffectedRules,
    state.run?.changeId ?? null,
  )
  processPending(state, run, options.limit ?? null)
  saveState(
    state,
    run.status === 'completed' ? '恢复重验并完成' : '恢复重验后再次中断',
    run.status === 'completed'
      ? `仅处理未完成规则 ${plannedRules.join('、')}，其余规则沿用已启用结果`
      : `已处理 ${run.processedRules.join('、') || '0 条'}，其余保留待重验`,
    run.processedRules,
  )
  return {
    ok: true,
    message:
      run.status === 'completed'
        ? `重验完成，处理 ${run.processedRules.length} 条未完成规则`
        : `本轮处理 ${run.processedRules.length} 条后中断，剩余规则仍待重验`,
    run: clone(run),
  }
}

export type ReorderInput = {
  ruleCode: string
  sortField?: string
  sortDirection?: SortDirection
  rowLimit?: number
  note?: string
}

/** 排序字段/输出上限变化：整组重排后发布，导出顺序与规则一致。 */
export function reorderRuleResult(input: ReorderInput): {
  ok: boolean
  message: string
  result: FilterResultDetail | null
  ruleVersion: number
} {
  const state = ensureFilterState()
  drainSubmissions(state)
  const rule = findRule(state, input.ruleCode)
  if (!rule) {
    return { ok: false, message: `没有找到规则 ${input.ruleCode}`, result: null, ruleVersion: 0 }
  }
  const next: FilterRuleSpec = {
    ...rule,
    sortField: input.sortField ?? rule.sortField,
    sortDirection: input.sortDirection ?? rule.sortDirection,
    rowLimit: input.rowLimit ?? rule.rowLimit,
  }
  const changed =
    next.sortField !== rule.sortField ||
    next.sortDirection !== rule.sortDirection ||
    next.rowLimit !== rule.rowLimit
  if (!changed) {
    return {
      ok: false,
      message: '排序字段与输出上限未变化，无需整组重排',
      result: state.results[input.ruleCode] ? clone(state.results[input.ruleCode]) : null,
      ruleVersion: state.ruleVersions[input.ruleCode]?.version ?? 0,
    }
  }
  state.rules[input.ruleCode] = next
  bumpRuleVersion(state, input.ruleCode, '整组重排')
  const run = createRun(
    state,
    'reorder',
    [input.ruleCode],
    allRuleCodes(state).filter((code) => code !== input.ruleCode),
    null,
  )
  const current = state.results[input.ruleCode]
  const outcome = publishResult(state, next, {
    origin: 'full-reorder',
    note: input.note ?? '排序字段或输出上限变化，整组重排',
    revalidationVersion: (current?.revalidationVersion ?? 0) + 1,
  })
  run.processedRules.push(input.ruleCode)
  run.scannedRows += outcome.scannedRows
  run.hitRows += outcome.result.hitRows.length
  completeRun(state, run)
  saveState(
    state,
    '整组结果重排',
    `${input.ruleCode} 排序字段 ${next.sortField} ${next.sortDirection}，上限 ${next.rowLimit}`,
    [input.ruleCode],
  )
  return {
    ok: true,
    message: `已按 ${next.sortField} ${
      next.sortDirection === 'asc' ? '升序' : '降序'
    }整组重排，输出上限 ${next.rowLimit}`,
    result: clone(state.results[input.ruleCode]),
    ruleVersion: state.ruleVersions[input.ruleCode]?.version ?? 0,
  }
}

/** 手工提交：内容一致就沿用同一份明细，不新增第二份。 */
export function submitRule(ruleCode: string): {
  ok: boolean
  message: string
  result: FilterResultDetail | null
  duplicated: boolean
} {
  const state = ensureFilterState()
  drainSubmissions(state)
  const rule = findRule(state, ruleCode)
  if (!rule) {
    return { ok: false, message: `没有找到规则 ${ruleCode}`, result: null, duplicated: false }
  }
  const current = state.results[ruleCode]
  const outcome = publishResult(state, rule, {
    origin: 'manual-submit',
    note: '手工提交，更新同一份结果明细',
    revalidationVersion: current?.revalidationVersion ?? 0,
    skipIfUnchanged: true,
  })
  if (outcome.unchanged) {
    saveState(
      state,
      '重复提交未新增明细',
      `${ruleCode} 内容一致，沿用结果 v${outcome.result.version}`,
      [ruleCode],
    )
    return {
      ok: true,
      message: `${ruleCode} 重复提交，沿用结果明细 v${outcome.result.version}`,
      result: clone(outcome.result),
      duplicated: true,
    }
  }
  saveState(
    state,
    '提交并更新结果明细',
    `${ruleCode} 结果明细更新到 v${outcome.result.version}`,
    [ruleCode],
  )
  return {
    ok: true,
    message: `${ruleCode} 结果明细更新到 v${outcome.result.version}`,
    result: clone(outcome.result),
    duplicated: false,
  }
}

export function loadDrillWorkspace(drillCode: string): {
  snapshot: DrillSnapshot | null
  results: FilterResultDetail[]
  indexRevision: number
  pending: PendingRevalidation[]
} {
  const state = ensureFilterState()
  const snapshot = state.drillSnapshots[drillCode]
  const datasetCode = DRILL_DATASET_LINKS[drillCode]
  const results = Object.values(state.results)
    .filter((result) => result.datasetCode === datasetCode)
    .map((result) => clone(result))
  return {
    snapshot: snapshot ? clone(snapshot) : null,
    results,
    indexRevision: state.indexRevision,
    pending: state.pending
      .filter((item) => item.status === 'pending' || item.status === 'running')
      .map((item) => clone(item)),
  }
}

/**
 * 演示多规则字段变化：DATA-0002 的金额变化同时影响 FILT-0002 与 FILT-0006。
 * stopAfter 用于模拟批处理中途中断，验证恢复时只处理未完成规则。
 */
export function seedAmountChange(options: { stopAfter?: number } = {}): FieldChangeResult {
  const state = ensureFilterState()
  drainSubmissions(state)
  const samples = (state.datasetRecords['DATA-0002'] ?? []).map((record, index) => {
    const current = Number(record.values['金额'] ?? 0)
    return { rowId: record.rowId, value: Math.round(current * 1.1) + index }
  })
  return applyDatasetFieldChange({
    changeId: 'CHG-AMOUNT-DATA2',
    datasetCode: 'DATA-0002',
    field: '金额',
    samples,
    stopAfter: options.stopAfter,
    note: 'DATA-0002 金额口径更新',
  })
}

/** 预置 DATA-0003 新增折扣率：只应命中 FILT-0003，FILT-0001/0002 沿用结果。 */
export function seedDiscountChange(options: { mixed?: boolean; strategy?: 'keep-current' | 'recompute' } = {}): FieldChangeResult {
  return applyDatasetFieldChange({
    changeId: options.mixed ? 'CHG-DISCOUNT-MIXED' : 'CHG-DISCOUNT',
    datasetCode: 'DATA-0003',
    field: '折扣率',
    samples: options.mixed ? DISCOUNT_MIXED_SAMPLES : DISCOUNT_NUMERIC_SAMPLES,
    strategy: options.strategy,
    note: options.mixed ? 'DATA-0003 折扣率混入文本样本' : 'DATA-0003 新增折扣率字段',
  })
}

/** 把筛选域规则镜像成筛选模块的列表行，保持列表页与结果明细同源。 */
export function filterRuleEntries(): EntryRow[] {
  return renderEntries(ensureFilterState())
}

/**
 * 把筛选域的规则状态镜像回筛选模块列表行。
 * 页面只读列表时不调用；状态流转/重置后调用一次，保证列表和结果明细同源。
 */
export function syncFilterRuleEntries(): EntryRow[] {
  const state = ensureFilterState()
  saveState(state, '同步筛选规则状态', '规则状态与结果明细已对齐')
  return renderEntries(state)
}
