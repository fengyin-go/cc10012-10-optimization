import type {
  ArchivedConditions,
  ComparisonSemantics,
  DatasetRecord,
  FieldValue,
  FilterOperator,
  FilterRuleSpec,
  HitRow,
  SortDirection,
} from '@/data/filter-types'
import { OPERATOR_LABELS } from '@/data/filter-seed'

/**
 * 筛选匹配与排序的唯一实现：局部重验、整组重排、冲突重算都调用这里，
 * 页面和下钻模块不重复写比较逻辑。
 */

function toNumeric(value: FieldValue | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** 规则比较值是否解释为数值：比较值本身是数字时走数值口径。 */
export function compareValueIsNumeric(rule: FilterRuleSpec): boolean {
  return toNumeric(rule.compareValue) !== null
}

export function fieldKindOf(records: DatasetRecord[], field: string): 'numeric' | 'text' | 'mixed' | 'empty' {
  let numeric = 0
  let text = 0
  for (const record of records) {
    const value = record.values[field]
    if (value === undefined || value === '') {
      continue
    }
    if (typeof value === 'number') {
      numeric += 1
      continue
    }
    if (toNumeric(value) !== null) {
      numeric += 1
    } else {
      text += 1
    }
  }
  if (numeric === 0 && text === 0) {
    return 'empty'
  }
  if (numeric > 0 && text > 0) {
    return 'mixed'
  }
  return numeric > 0 ? 'numeric' : 'text'
}

export function semanticsFor(
  records: DatasetRecord[],
  rule: FilterRuleSpec,
): ComparisonSemantics {
  const kind = fieldKindOf(records, rule.filterField)
  if (kind === 'mixed') {
    return 'compat-text'
  }
  if (kind === 'numeric' || compareValueIsNumeric(rule)) {
    return 'numeric-first'
  }
  return 'compat-text'
}

/**
 * 单个字段值是否命中规则。
 * numeric-first：比较值与字段都可转数值时按数值比较，否则退回文本包含/相等；
 * compat-text：字段混入文本样本，统一按文本口径比较，保证可重复。
 */
export function matchesValue(
  value: FieldValue | undefined,
  rule: Pick<FilterRuleSpec, 'operator' | 'compareValue'>,
  semantics: ComparisonSemantics,
): boolean {
  if (value === undefined) {
    return false
  }
  const expected = rule.compareValue.trim()
  if (semantics === 'compat-text') {
    const left = String(value)
    switch (rule.operator) {
      case 'eq':
        return left === expected
      case 'contains':
        return left.includes(expected)
      case 'gt':
        return left.localeCompare(expected) > 0
      case 'gte':
        return left.localeCompare(expected) >= 0
      case 'lt':
        return left.localeCompare(expected) < 0
      case 'lte':
        return left.localeCompare(expected) <= 0
      default:
        return false
    }
  }
  const numericLeft = toNumeric(value)
  const numericRight = toNumeric(expected)
  if (rule.operator === 'contains') {
    return String(value).includes(expected)
  }
  if (numericLeft !== null && numericRight !== null) {
    switch (rule.operator) {
      case 'eq':
        return numericLeft === numericRight
      case 'gt':
        return numericLeft > numericRight
      case 'gte':
        return numericLeft >= numericRight
      case 'lt':
        return numericLeft < numericRight
      case 'lte':
        return numericLeft <= numericRight
      default:
        return false
    }
  }
  const left = String(value)
  switch (rule.operator) {
    case 'eq':
      return left === expected
    case 'lt':
      return left < expected
    case 'lte':
      return left <= expected
    case 'gt':
      return left > expected
    case 'gte':
      return left >= expected
    default:
      return false
  }
}

export function compareRecords(
  left: DatasetRecord,
  right: DatasetRecord,
  field: string,
  direction: SortDirection,
): number {
  const leftValue = left.values[field]
  const rightValue = right.values[field]
  const leftNumeric = toNumeric(leftValue)
  const rightNumeric = toNumeric(rightValue)
  let diff = 0
  if (leftNumeric !== null && rightNumeric !== null) {
    diff = leftNumeric - rightNumeric
  } else {
    diff = String(leftValue ?? '').localeCompare(String(rightValue ?? ''))
  }
  if (diff === 0) {
    diff = left.rowId.localeCompare(right.rowId)
  }
  return direction === 'asc' ? diff : -diff
}

export type EvaluatedRows = {
  hitRows: HitRow[]
  scannedRows: number
  matchedCount: number
  truncated: boolean
  missingFields: string[]
  orderVerified: boolean
  contentHash: string
}

function hashText(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 按规则读取目标数据集并生成命中行。
 * 排序字段或输出上限变化时同样走这里，保证结果顺序与规则完全一致。
 */
export function evaluateRule(
  records: DatasetRecord[],
  datasetFields: string[],
  rule: FilterRuleSpec,
  semantics: ComparisonSemantics,
): EvaluatedRows {
  const missingFields: string[] = []
  if (!datasetFields.includes(rule.filterField)) {
    missingFields.push(rule.filterField)
  }
  if (!datasetFields.includes(rule.sortField)) {
    missingFields.push(rule.sortField)
  }
  const matched: DatasetRecord[] = []
  let scannedRows = 0
  for (const record of records) {
    scannedRows += 1
    // 一条规则只有一个比较条件，逻辑组合用于将来多条件扩展，不影响单条件判定。
    if (matchesValue(record.values[rule.filterField], rule, semantics)) {
      matched.push(record)
    }
  }
  const sorted = [...matched].sort((left, right) =>
    compareRecords(left, right, rule.sortField, rule.sortDirection),
  )
  const limit = Number.isFinite(rule.rowLimit) && rule.rowLimit > 0 ? Math.floor(rule.rowLimit) : sorted.length
  const limited = sorted.slice(0, limit)
  const hitRows: HitRow[] = limited.map((record, index) => ({
    rowId: record.rowId,
    position: index + 1,
    matchValue: record.values[rule.filterField] ?? null,
    values: { ...record.values },
  }))
  // 顺序核对：命中行必须按规则排序字段单调排列，且不超输出上限。
  let sortedCorrectly = true
  for (let index = 1; index < limited.length; index += 1) {
    if (
      compareRecords(limited[index - 1], limited[index], rule.sortField, rule.sortDirection) > 0
    ) {
      sortedCorrectly = false
      break
    }
  }
  const orderVerified = missingFields.length === 0 && sortedCorrectly && limited.length <= limit
  const contentHash = hashText(
    hitRows.map((row) => `${row.rowId}:${JSON.stringify(row.values)}`).join('|') +
      `#${rule.ruleCode}#${rule.sortField}#${rule.sortDirection}#${limit}`,
  )
  return {
    hitRows,
    scannedRows,
    matchedCount: matched.length,
    truncated: matched.length > limited.length,
    missingFields: [...new Set(missingFields)],
    orderVerified,
    contentHash,
  }
}

export function archivedConditions(
  rule: FilterRuleSpec,
  semantics: ComparisonSemantics,
): ArchivedConditions {
  return {
    field: rule.filterField,
    operator: rule.operator,
    value: rule.compareValue,
    logic: rule.logic,
    semantics,
    note: `${rule.filterField} ${OPERATOR_LABELS[rule.operator]} ${rule.compareValue}（${rule.logic}）`,
  }
}
