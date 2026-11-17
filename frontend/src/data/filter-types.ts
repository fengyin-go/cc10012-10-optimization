/**
 * 数据筛选结果明细的领域类型。
 *
 * 这些类型只描述「筛选规则 -> 字段依赖 -> 局部重验 -> 结果明细」这条链路，
 * 与页面无关；筛选页和多维下钻页共用同一份结构，避免两个模块各写一套明细格式。
 */

export type FieldValue = string | number

export type DatasetRecord = {
  rowId: string
  values: Record<string, FieldValue>
}

export type FilterOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'

export type SortDirection = 'asc' | 'desc'

export type LogicOp = 'AND' | 'OR'

export type ResultOrigin =
  | 'initial'
  | 'manual-submit'
  | 'local-revalidation'
  | 'full-reorder'
  | 'conflict-recompute'
  | 'full-revalidation'

export type ResultStatus = 'ready' | 'pending' | 'revalidating'

export type PendingStatus = 'pending' | 'running' | 'done' | 'skipped'

export type RevalidationReason =
  | 'field-change'
  | 'conflict-keep-current'
  | 'conflict-recompute'
  | 'reorder'
  | 'full-scan'
  | 'definition-change'

export type ConflictStrategy = 'keep-current' | 'recompute'

export type ComparisonSemantics = 'numeric-first' | 'compat-text'

export type FilterRuleSpec = {
  id: number
  ruleCode: string
  datasetCode: string
  filterField: string
  operator: FilterOperator
  compareValue: string
  logic: LogicOp
  sortField: string
  sortDirection: SortDirection
  rowLimit: number
  status: string
}

export type RuleVersionState = {
  version: number
  reason: string
  updatedAt: string
  dependencyFingerprint: string
  indexRevision: number
}

/** 数据集 -> 字段 -> 引用该字段的规则编号。 */
export type DependencyIndex = Record<string, Record<string, string[]>>

export type ArchivedRule = FilterRuleSpec & {
  ruleVersion: number
  dependencyFingerprint: string
}

export type ArchivedConditions = {
  field: string
  operator: FilterOperator
  value: string
  logic: LogicOp
  semantics: ComparisonSemantics
  note: string
}

export type HitRow = {
  rowId: string
  position: number
  matchValue: FieldValue | null
  values: Record<string, FieldValue>
}

export type FilterResultDetail = {
  /** 每条规则固定一个结果明细 id，重复提交不会新增第二份。 */
  resultId: string
  ruleCode: string
  datasetCode: string
  version: number
  revalidationVersion: number
  status: ResultStatus
  origin: ResultOrigin
  archivedRule: ArchivedRule
  archivedConditions: ArchivedConditions
  hitRows: HitRow[]
  matchedCount: number
  truncated: boolean
  rowLimit: number
  sortField: string
  sortDirection: SortDirection
  fieldFingerprint: string
  dependencyFingerprint: string
  contentHash: string
  idempotencyKey: string
  missingFields: string[]
  orderVerified: boolean
  publishedAt: string
  publishedBy: string
  previousVersion: number | null
  note: string
}

export type PendingRevalidation = {
  id: string
  ruleCode: string
  datasetCode: string
  changedFields: string[]
  reason: RevalidationReason
  origin: ResultOrigin
  status: PendingStatus
  ruleVersion: number
  indexRevision: number
  reorderRequired: boolean
  versionBefore: number
  resultVersion: number | null
  /** 同一规则在上一轮中断后未被处理的批次会保留这里的次数，重验时继续累加。 */
  attempts: number
  createdAt: string
  completedAt: string | null
  note: string
}

export type RevalidationRun = {
  id: string
  mode: 'partial' | 'full' | 'resume' | 'reorder'
  status: 'running' | 'interrupted' | 'completed'
  startedAt: string
  finishedAt: string | null
  plannedRules: string[]
  processedRules: string[]
  skippedRules: string[]
  unaffectedRules: string[]
  interruptedAfter: number | null
  scannedRows: number
  hitRows: number
  indexRevision: number
  changeId: string | null
}

export type FieldConflictComparison = {
  resultVersionEffect: 'unchanged' | 'single-new-version'
  resultVersions: Record<string, number>
  hitCounts: Record<string, number>
  pendingRules: string[]
  semantics: ComparisonSemantics
  summary: string
}

export type FieldSample = {
  rowId: string
  value: FieldValue
}

export type DatasetFieldChangeInput = {
  changeId: string
  datasetCode: string
  field: string
  fieldLabel?: string
  samples: FieldSample[]
  strategy?: ConflictStrategy
  /** 演示用：只处理前 N 条规则即中断，未处理规则留在待重验清单。 */
  stopAfter?: number
  note?: string
}

export type FieldConflict = {
  id: string
  datasetCode: string
  field: string
  changeId: string
  detectedAt: string
  sampleKinds: { numeric: number; text: number }
  affectedRules: string[]
  currentVersions: Record<string, number>
  keepCurrent: FieldConflictComparison
  recompute: FieldConflictComparison
  candidate: DatasetFieldChangeInput
  decision: ConflictStrategy | null
  decidedAt: string | null
}

export type DatasetChange = {
  changeId: string
  datasetCode: string
  field: string
  samples: FieldValue[]
  appliedAt: string
  strategy: ConflictStrategy
  affectedRules: string[]
  skippedRules: string[]
  beforeVersions: Record<string, number>
  afterVersions: Record<string, number>
  conflictId: string | null
}

export type DrillHitRow = HitRow & {
  sourceRuleCode: string
  sourceResultVersion: number
  retainedAt: string
}

export type DrillSnapshot = {
  drillCode: string
  datasetCode: string
  hitRows: DrillHitRow[]
  linkedResults: Record<
    string,
    { ruleCode: string; resultVersion: number; hitCount: number; updatedAt: string }
  >
  retainedVersions: number[]
  updatedAt: string
}

export type AuditEntry = {
  id: string
  at: string
  action: string
  detail: string
  ruleCodes?: string[]
  indexRevision?: number
}

export type FilterState = {
  schemaVersion: number
  revision: number
  indexRevision: number
  updatedAt: string
  datasetFields: Record<string, string[]>
  datasetRecords: Record<string, DatasetRecord[]>
  rules: Record<string, FilterRuleSpec>
  ruleVersions: Record<string, RuleVersionState>
  dependencyIndex: DependencyIndex
  results: Record<string, FilterResultDetail>
  pending: PendingRevalidation[]
  run: RevalidationRun | null
  conflicts: FieldConflict[]
  appliedChanges: Record<string, ConflictStrategy>
  processedSubmissions: Record<
    string,
    { ruleCode: string; resultVersion: number; at: string }
  >
  /** 上一次与列表行对齐时的行签名：只有签名变化才算新的用户提交。 */
  entrySnapshots: Record<string, string>
  drillSnapshots: Record<string, DrillSnapshot>
  auditLog: AuditEntry[]
  lastChange: DatasetChange | null
}

export type RuleResultView = {
  rule: FilterRuleSpec
  ruleVersion: RuleVersionState
  dependencies: string[]
  dependencyFingerprint: string
  result: FilterResultDetail | null
  pending: PendingRevalidation | null
}

export type DatasetSummary = {
  code: string
  name: string
  sourceTable: string
  fields: string[]
  recordCount: number
  fieldKinds: Record<string, 'numeric' | 'text' | 'mixed' | 'empty'>
}

export type FilterWorkspace = {
  revision: number
  indexRevision: number
  updatedAt: string
  datasetFields: Record<string, string[]>
  datasets: DatasetSummary[]
  rules: RuleResultView[]
  results: FilterResultDetail[]
  resultCount: number
  pending: PendingRevalidation[]
  run: RevalidationRun | null
  conflict: FieldConflict | null
  conflicts: FieldConflict[]
  lastChange: DatasetChange | null
  drillSnapshots: DrillSnapshot[]
  auditLog: AuditEntry[]
  perRuleSingleDetail: boolean
}

export type FieldChangeResult = {
  ok: boolean
  duplicate: boolean
  message: string
  changeId: string
  strategy: ConflictStrategy
  affectedRules: string[]
  skippedRules: string[]
  conflict: FieldConflict | null
  run: RevalidationRun | null
  resultVersions: Record<string, number>
  indexRevision: number
  ruleVersions: Record<string, number>
}
