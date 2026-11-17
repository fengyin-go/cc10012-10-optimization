import type { EntryRow } from './types'
import type { DatasetRecord, FieldSample, FilterRuleSpec } from './filter-types'

/**
 * 筛选域示例数据：数据集字段/记录、筛选规则、下钻路径与数据集的关联。
 * 规则页签和结果明细共用这一份定义，避免示例字段散落在多个文件里。
 */

type DatasetDefinition = {
  code: string
  name: string
  sourceTable: string
  fields: string[]
  records: DatasetRecord[]
}

function record(
  rowId: string,
  values: Record<string, string | number>,
): DatasetRecord {
  return { rowId, values }
}

export const DATASETS: DatasetDefinition[] = [
  {
    code: 'DATA-0001',
    name: '销售订单明细',
    sourceTable: 'dwd_sales_order',
    fields: ['订单号', '客户', '区域', '渠道', '数量', '单价', '金额', '评分'],
    records: [
      record('D-1001', { 订单号: 'SO-1001', 客户: 'C001', 区域: '华东', 渠道: '线上', 数量: 10, 单价: 120, 金额: 1200, 评分: 4.5 }),
      record('D-1002', { 订单号: 'SO-1002', 客户: 'C002', 区域: '华东', 渠道: '线下', 数量: 5, 单价: 300, 金额: 1500, 评分: 4.8 }),
      record('D-1003', { 订单号: 'SO-1003', 客户: 'C003', 区域: '华南', 渠道: '线上', 数量: 80, 单价: 50, 金额: 4000, 评分: 3.9 }),
      record('D-1004', { 订单号: 'SO-1004', 客户: 'C004', 区域: '华东', 渠道: '线上', 数量: 20, 单价: 90, 金额: 1800, 评分: 4.2 }),
      record('D-1005', { 订单号: 'SO-1005', 客户: 'C005', 区域: '华北', 渠道: '线下', 数量: 6, 单价: 200, 金额: 1200, 评分: 4.1 }),
      record('D-1006', { 订单号: 'SO-1006', 客户: 'C006', 区域: '华东', 渠道: '线下', 数量: 3, 单价: 500, 金额: 1500, 评分: 4.6 }),
      record('D-1007', { 订单号: 'SO-1007', 客户: 'C007', 区域: '华东', 渠道: '线上', 数量: 12, 单价: 75, 金额: 900, 评分: 3.8 }),
      record('D-1008', { 订单号: 'SO-1008', 客户: 'C008', 区域: '西南', 渠道: '线上', 数量: 40, 单价: 30, 金额: 1200, 评分: 4.0 }),
      record('D-1009', { 订单号: 'SO-1009', 客户: 'C009', 区域: '华东', 渠道: '线上', 数量: 15, 单价: 160, 金额: 2400, 评分: 4.9 }),
      record('D-1010', { 订单号: 'SO-1010', 客户: 'C010', 区域: '华南', 渠道: '线下', 数量: 7, 单价: 210, 金额: 1470, 评分: 4.3 }),
      record('D-1011', { 订单号: 'SO-1011', 客户: 'C011', 区域: '华东', 渠道: '线下', 数量: 9, 单价: 88, 金额: 792, 评分: 4.4 }),
      record('D-1012', { 订单号: 'SO-1012', 客户: 'C012', 区域: '华北', 渠道: '线上', 数量: 100, 单价: 12, 金额: 1200, 评分: 3.5 }),
    ],
  },
  {
    code: 'DATA-0002',
    name: '客户活跃分析',
    sourceTable: 'dws_customer_active',
    fields: ['客户', '区域', '渠道', '数量', '单价', '金额', '评分'],
    records: [
      record('D-2001', { 客户: 'C101', 区域: '华东', 渠道: '线上', 数量: 6, 单价: 100, 金额: 600, 评分: 4.7 }),
      record('D-2002', { 客户: 'C102', 区域: '华南', 渠道: '线上', 数量: 10, 单价: 80, 金额: 800, 评分: 4.1 }),
      record('D-2003', { 客户: 'C103', 区域: '华北', 渠道: '线下', 数量: 2, 单价: 300, 金额: 600, 评分: 4.9 }),
      record('D-2004', { 客户: 'C104', 区域: '华东', 渠道: '线上', 数量: 9, 单价: 120, 金额: 1080, 评分: 4.5 }),
      record('D-2005', { 客户: 'C105', 区域: '西南', 渠道: '线下', 数量: 4, 单价: 150, 金额: 600, 评分: 3.7 }),
      record('D-2006', { 客户: 'C106', 区域: '华东', 渠道: '线上', 数量: 15, 单价: 60, 金额: 900, 评分: 4.2 }),
      record('D-2007', { 客户: 'C107', 区域: '华南', 渠道: '线下', 数量: 3, 单价: 220, 金额: 660, 评分: 4.6 }),
      record('D-2008', { 客户: 'C108', 区域: '华北', 渠道: '线上', 数量: 7, 单价: 90, 金额: 630, 评分: 4.0 }),
      record('D-2009', { 客户: 'C109', 区域: '华东', 渠道: '线下', 数量: 5, 单价: 180, 金额: 900, 评分: 4.8 }),
      record('D-2010', { 客户: 'C110', 区域: '西南', 渠道: '线上', 数量: 11, 单价: 70, 金额: 770, 评分: 3.9 }),
      record('D-2011', { 客户: 'C111', 区域: '华东', 渠道: '线上', 数量: 8, 单价: 110, 金额: 880, 评分: 4.4 }),
      record('D-2012', { 客户: 'C112', 区域: '华南', 渠道: '线上', 数量: 1, 单价: 500, 金额: 500, 评分: 4.3 }),
    ],
  },
  {
    code: 'DATA-0003',
    name: '订单让利明细',
    sourceTable: 'dwd_order_discount',
    fields: ['订单号', '客户', '区域', '渠道', '数量', '单价', '金额', '评分'],
    records: [
      record('D-3001', { 订单号: 'SO-3001', 客户: 'C201', 区域: '华东', 渠道: '线上', 数量: 4, 单价: 400, 金额: 1600, 评分: 4.4 }),
      record('D-3002', { 订单号: 'SO-3002', 客户: 'C202', 区域: '华南', 渠道: '线下', 数量: 6, 单价: 250, 金额: 1500, 评分: 4.1 }),
      record('D-3003', { 订单号: 'SO-3003', 客户: 'C203', 区域: '华东', 渠道: '线上', 数量: 2, 单价: 900, 金额: 1800, 评分: 4.8 }),
      record('D-3004', { 订单号: 'SO-3004', 客户: 'C204', 区域: '华北', 渠道: '线上', 数量: 10, 单价: 120, 金额: 1200, 评分: 3.8 }),
      record('D-3005', { 订单号: 'SO-3005', 客户: 'C205', 区域: '华东', 渠道: '线下', 数量: 8, 单价: 350, 金额: 2800, 评分: 4.6 }),
      record('D-3006', { 订单号: 'SO-3006', 客户: 'C206', 区域: '西南', 渠道: '线上', 数量: 5, 单价: 300, 金额: 1500, 评分: 4.0 }),
      record('D-3007', { 订单号: 'SO-3007', 客户: 'C207', 区域: '华东', 渠道: '线上', 数量: 3, 单价: 700, 金额: 2100, 评分: 4.9 }),
      record('D-3008', { 订单号: 'SO-3008', 客户: 'C208', 区域: '华南', 渠道: '线上', 数量: 12, 单价: 100, 金额: 1200, 评分: 3.9 }),
      record('D-3009', { 订单号: 'SO-3009', 客户: 'C209', 区域: '华北', 渠道: '线下', 数量: 7, 单价: 260, 金额: 1820, 评分: 4.2 }),
      record('D-3010', { 订单号: 'SO-3010', 客户: 'C210', 区域: '华东', 渠道: '线上', 数量: 9, 单价: 210, 金额: 1890, 评分: 4.5 }),
      record('D-3011', { 订单号: 'SO-3011', 客户: 'C211', 区域: '西南', 渠道: '线上', 数量: 1, 单价: 1000, 金额: 1000, 评分: 4.3 }),
      record('D-3012', { 订单号: 'SO-3012', 客户: 'C212', 区域: '华东', 渠道: '线下', 数量: 20, 单价: 90, 金额: 1800, 评分: 3.6 }),
    ],
  },
]

export const FILTER_RULE_SEEDS: FilterRuleSpec[] = [
  {
    id: 1,
    ruleCode: 'FILT-0001',
    datasetCode: 'DATA-0001',
    filterField: '区域',
    operator: 'eq',
    compareValue: '华东',
    logic: 'AND',
    sortField: '金额',
    sortDirection: 'desc',
    rowLimit: 5,
    status: '已启用',
  },
  {
    id: 2,
    ruleCode: 'FILT-0002',
    datasetCode: 'DATA-0002',
    filterField: '评分',
    operator: 'gte',
    compareValue: '4',
    logic: 'AND',
    sortField: '金额',
    sortDirection: 'desc',
    rowLimit: 10,
    status: '已启用',
  },
  {
    id: 3,
    ruleCode: 'FILT-0003',
    datasetCode: 'DATA-0003',
    filterField: '折扣率',
    operator: 'gte',
    compareValue: '0.1',
    logic: 'AND',
    sortField: '金额',
    sortDirection: 'desc',
    rowLimit: 5,
    status: '已启用',
  },
  {
    id: 4,
    ruleCode: 'FILT-0004',
    datasetCode: 'DATA-0003',
    filterField: '金额',
    operator: 'gt',
    compareValue: '1500',
    logic: 'AND',
    sortField: '金额',
    sortDirection: 'desc',
    rowLimit: 3,
    status: '已启用',
  },
  {
    id: 5,
    ruleCode: 'FILT-0005',
    datasetCode: 'DATA-0001',
    filterField: '数量',
    operator: 'lte',
    compareValue: '80',
    logic: 'AND',
    sortField: '数量',
    sortDirection: 'asc',
    rowLimit: 4,
    status: '待校验',
  },
  {
    id: 6,
    ruleCode: 'FILT-0006',
    datasetCode: 'DATA-0002',
    filterField: '渠道',
    operator: 'contains',
    compareValue: '线上',
    logic: 'OR',
    sortField: '金额',
    sortDirection: 'desc',
    rowLimit: 6,
    status: '已启用',
  },
]

export const OPERATOR_LABELS: Record<FilterRuleSpec['operator'], string> = {
  eq: '等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  contains: '包含',
}

export const OPERATOR_BY_LABEL: Record<string, FilterRuleSpec['operator']> = {
  等于: 'eq',
  大于: 'gt',
  大于等于: 'gte',
  小于: 'lt',
  小于等于: 'lte',
  包含: 'contains',
}

/** 下钻路径 -> 数据集：结果重验后按这个关联把命中行同步到下钻快照。 */
export const DRILL_DATASET_LINKS: Record<string, string> = {
  'DRIL-0001': 'DATA-0001',
  'DRIL-0002': 'DATA-0002',
  'DRIL-0003': 'DATA-0003',
}

/** DATA-0003 新增折扣率的数值样本：0 表示未让利，0.1 以上达到重验阈值。 */
export const DISCOUNT_NUMERIC_SAMPLES: FieldSample[] = [
  { rowId: 'D-3001', value: 0.15 },
  { rowId: 'D-3002', value: 0.05 },
  { rowId: 'D-3003', value: 0.2 },
  { rowId: 'D-3004', value: 0 },
  { rowId: 'D-3005', value: 0.25 },
  { rowId: 'D-3006', value: 0.1 },
  { rowId: 'D-3007', value: 0.3 },
  { rowId: 'D-3008', value: 0.08 },
  { rowId: 'D-3009', value: 0.12 },
  { rowId: 'D-3010', value: 0.18 },
  { rowId: 'D-3011', value: 0.02 },
  { rowId: 'D-3012', value: 0.22 },
]

/** 同一字段混入文本样本：用于演示「文本 + 数值」口径冲突的两条处理路径。 */
export const DISCOUNT_MIXED_SAMPLES: FieldSample[] = [
  { rowId: 'D-3001', value: 0.15 },
  { rowId: 'D-3002', value: '15%' },
  { rowId: 'D-3003', value: '无折扣' },
  { rowId: 'D-3004', value: 0.05 },
  { rowId: 'D-3005', value: '高让利' },
  { rowId: 'D-3006', value: 0.1 },
  { rowId: 'D-3007', value: 0.3 },
  { rowId: 'D-3008', value: '0.08' },
  { rowId: 'D-3009', value: 0.12 },
  { rowId: 'D-3010', value: '18%' },
  { rowId: 'D-3011', value: 0.02 },
  { rowId: 'D-3012', value: 0.22 },
]

function fieldSummary(fields: string[]): string {
  return fields.join('、')
}

/** 数据集管理页的示例行，字段列表与筛选域保持一致。 */
export const DATASET_ENTRY_ROWS: EntryRow[] = DATASETS.map((dataset, index) => ({
  id: index + 1,
  status: index === 2 ? '已生效' : index === 1 ? '待审核' : '草稿',
  pending: index !== 2,
  abnormal: index === 1,
  数据集编号: dataset.code,
  数据集名称: dataset.name,
  来源表名: dataset.sourceTable,
  字段列表: fieldSummary(dataset.fields),
  更新策略: index === 2 ? '每日增量' : '按需更新',
  数据采样比例: index === 2 ? '100%' : '20%',
  生命周期天数: 180,
  缓存开关: index === 2,
}))

/** 数据筛选页的示例行：状态与 FILTER_RULE_SEEDS 对齐，动作流转后由服务回写。 */
export const FILTER_RULE_ENTRY_ROWS: EntryRow[] = FILTER_RULE_SEEDS.map((rule) => ({
  id: rule.id,
  status: rule.status,
  pending: rule.status !== '已启用',
  abnormal: rule.status === '待校验',
  规则编号: rule.ruleCode,
  目标数据集: rule.datasetCode,
  筛选字段: rule.filterField,
  比较运算符: OPERATOR_LABELS[rule.operator],
  比较值: rule.compareValue,
  逻辑组合: rule.logic,
  排序字段: rule.sortField,
  输出行数上限: rule.rowLimit,
}))
