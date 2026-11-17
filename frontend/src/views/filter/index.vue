<template>
  <section class="page" data-module="filter">
    <header class="page-head">
      <div>
        <h2>数据筛选管理</h2>
        <p class="page-desc">
          维护筛选规则与结果字段明细：字段变化只重验依赖该字段的规则，排序或输出上限变化整组重排，
          每条规则始终只有一份可回看的结果明细。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记筛选规则</button>
        <button class="btn" type="button" @click="exportRows">导出数据筛选清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">筛选规则总数</span>
        <strong class="stat-value">{{ meta.rules.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">结果明细份数</span>
        <strong class="stat-value">{{ meta.resultCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待重验规则</span>
        <strong class="stat-value">{{ meta.pending.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">依赖索引修订</span>
        <strong class="stat-value">#{{ meta.indexRevision }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">单规则单明细</span>
        <strong class="stat-value">{{ meta.perRuleSingleDetail ? '是' : '否' }}</strong>
      </article>
    </div>

    <nav class="view-tabs" aria-label="筛选视图">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab"
        :class="{ active: activeView === tab.key }"
        @click="switchView(tab.key)"
      >
        {{ tab.label }}
      </button>
      <span class="muted view-hint">切换视图不会丢结果明细，回看位置已记录</span>
    </nav>

    <p v-if="message" class="notice" :class="{ error: messageIsError }">{{ message }}</p>

    <section v-if="activeView === 'rules'" class="panel">
      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>规则编号</th>
            <th>目标数据集</th>
            <th>筛选字段</th>
            <th>比较</th>
            <th>排序</th>
            <th>上限</th>
            <th>规则版本</th>
            <th>结果明细</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in rows"
            :key="item.rule.ruleCode"
            :class="{ 'row-affected': isAffected(item.rule.ruleCode), 'row-selected': selectedRule === item.rule.ruleCode }"
            :data-rule="item.rule.ruleCode"
          >
            <td>{{ item.rule.ruleCode }}</td>
            <td>{{ item.rule.datasetCode }}</td>
            <td>{{ item.rule.filterField }}</td>
            <td>{{ OPERATOR_LABELS[item.rule.operator] }} {{ item.rule.compareValue }}（{{ item.rule.logic }}）</td>
            <td>{{ item.rule.sortField }} {{ item.rule.sortDirection === 'asc' ? '升序' : '降序' }}</td>
            <td>{{ item.rule.rowLimit }}</td>
            <td>v{{ item.ruleVersion.version }}</td>
            <td>
              <button class="link" type="button" @click="selectRule(item.rule.ruleCode)">
                {{ item.result ? `明细 v${item.result.version} · ${item.result.hitRows.length} 行` : '暂无明细' }}
              </button>
            </td>
            <td>
              <span>{{ item.rule.status }}</span>
              <span v-if="item.pending" class="tag-pending">待重验</span>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="submitOne(item.rule.ruleCode)">提交</button>
              <button
                class="link"
                type="button"
                @click="runReorder(item.rule.ruleCode)"
                :disabled="!item.result"
              >
                整组重排
              </button>
              <button
                v-for="action in ruleActions"
                :key="action"
                class="link"
                type="button"
                @click="runRuleAction(action, item)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="10" class="empty-state">没有匹配的筛选规则</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ total }} 条筛选规则 · 高亮行为本次字段变化受影响规则</span>
        <span v-if="lastChange" class="muted">
          最近变化：{{ lastChange.datasetCode }}.{{ lastChange.field }} → 重验
          {{ lastChange.affectedRules.join('、') || '无' }}；沿用
          {{ lastChange.skippedRules.join('、') || '无' }}
        </span>
      </footer>
    </section>

    <section v-else-if="activeView === 'results'" class="panel">
      <p class="muted">
        当前筛选结果明细：{{ selectedResult?.ruleCode ?? '未选择' }}
        {{ selectedResult ? `· ${selectedResult.resultId} · v${selectedResult.version}` : '' }}，
        下方同时列出全部已归档明细，切换视图后仍可回看。
      </p>
      <div class="toolbar">
        <label class="filter-item inline">
          <span>选择规则</span>
          <select v-model="selectedRule" @change="persistSelection">
            <option v-for="item in rows" :key="item.rule.ruleCode" :value="item.rule.ruleCode">
              {{ item.rule.ruleCode }} · {{ item.result ? `v${item.result.version}` : '无明细' }}
            </option>
          </select>
        </label>
        <button class="btn" type="button" @click="submitOne(selectedRule)">重复提交（应只保留一份）</button>
        <button class="btn" type="button" @click="runReorder(selectedRule)">按排序字段整组重排</button>
        <button class="btn" type="button" @click="exportDetail">导出该明细（按规则顺序）</button>
      </div>

      <FilterResultDetail
        v-if="selectedResult"
        :result="selectedResult"
        :columns="selectedColumns"
      />
      <p v-else class="empty-state">该规则还没有结果明细，可先提交一次</p>

      <details class="history" open>
        <summary>已归档结果明细（{{ meta.results.length }} 份，每条规则最多一份）</summary>
        <table class="data-table">
          <thead>
            <tr>
              <th>结果明细</th>
              <th>规则</th>
              <th>版本</th>
              <th>重验版本</th>
              <th>来源</th>
              <th>命中/匹配</th>
              <th>排序</th>
              <th>顺序核对</th>
              <th>发布</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="result in meta.results" :key="result.resultId">
              <td>{{ result.resultId }}</td>
              <td>{{ result.ruleCode }}</td>
              <td>v{{ result.version }}</td>
              <td>v{{ result.revalidationVersion }}</td>
              <td>{{ originLabel(result.origin) }}</td>
              <td>{{ result.hitRows.length }}/{{ result.matchedCount }}</td>
              <td>{{ result.sortField }} {{ result.sortDirection === 'asc' ? '↑' : '↓' }} · {{ result.rowLimit }}</td>
              <td>{{ result.orderVerified ? '一致' : '待核对' }}</td>
              <td>{{ formatTime(result.publishedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>

    <section v-else-if="activeView === 'revalidation'" class="panel">
      <div class="toolbar">
        <button class="btn primary" type="button" @click="simulateNumericChange">
          模拟 DATA-0003 新增折扣率
        </button>
        <button class="btn" type="button" @click="simulateMixedChange">
          模拟同名文本+数值样本
        </button>
        <button class="btn" type="button" @click="simulateAmountChange">
          模拟 DATA-0002 金额变化（2 条规则）
        </button>
        <button class="btn" type="button" @click="simulateInterruptedChange">
          模拟受理即中断
        </button>
        <button class="btn" type="button" @click="interrupt">中断重验</button>
        <button class="btn" type="button" @click="resume">恢复重验（只处理未完成）</button>
        <button class="btn" type="button" @click="resumeInterrupted">恢复并再次中断</button>
      </div>

      <article v-if="meta.run" class="run-card">
        <header>
          <strong>重验批次 {{ meta.run.id }}</strong>
          <span class="badge">{{ runStatusLabel }}</span>
          <span class="badge">{{ runModeLabel(meta.run.mode) }}</span>
          <span class="badge">索引 #{{ meta.run.indexRevision }}</span>
        </header>
        <dl class="run-meta">
          <div><dt>计划规则</dt><dd>{{ meta.run.plannedRules.join('、') || '—' }}</dd></div>
          <div><dt>已处理</dt><dd>{{ meta.run.processedRules.join('、') || '—' }}</dd></div>
          <div><dt>未受影响</dt><dd>{{ meta.run.unaffectedRules.join('、') || '—' }}</dd></div>
          <div><dt>扫描行数</dt><dd>{{ meta.run.scannedRows }} · 命中 {{ meta.run.hitRows }}</dd></div>
          <div><dt>开始</dt><dd>{{ formatTime(meta.run.startedAt) }}</dd></div>
          <div><dt>结束</dt><dd>{{ meta.run.finishedAt ? formatTime(meta.run.finishedAt) : '进行中' }}</dd></div>
        </dl>
      </article>

      <h3 class="section-title">待重验清单</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>规则</th>
            <th>数据集</th>
            <th>变化字段</th>
            <th>原因</th>
            <th>状态</th>
            <th>规则版本</th>
            <th>索引修订</th>
            <th>重排</th>
            <th>尝试</th>
            <th>结果版本</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in meta.pending" :key="item.id">
            <td>{{ item.ruleCode }}</td>
            <td>{{ item.datasetCode }}</td>
            <td>{{ item.changedFields.join('、') }}</td>
            <td>{{ reasonLabel(item.reason) }}</td>
            <td>{{ item.status === 'pending' ? '待重验' : '重验中' }}</td>
            <td>v{{ item.ruleVersion }}</td>
            <td>#{{ item.indexRevision }}</td>
            <td>{{ item.reorderRequired ? '需要' : '不需要' }}</td>
            <td>{{ item.attempts }}</td>
            <td>{{ item.resultVersion ? `v${item.resultVersion}` : '—' }}</td>
          </tr>
          <tr v-if="!meta.pending.length">
            <td colspan="10" class="empty-state">没有待重验规则</td>
          </tr>
        </tbody>
      </table>

      <article v-if="meta.conflict" class="conflict-card" :data-conflict="meta.conflict.id">
        <header>
          <strong>字段口径冲突：{{ meta.conflict.datasetCode }}.{{ meta.conflict.field }}</strong>
          <span class="badge">数值样本 {{ meta.conflict.sampleKinds.numeric }} · 文本样本 {{ meta.conflict.sampleKinds.text }}</span>
        </header>
        <p class="muted">两个路径都只能产生一个结果明细版本。先比较再取舍：</p>
        <table class="data-table">
          <thead>
            <tr><th>取舍</th><th>结果版本影响</th><th>命中行数</th><th>待重验规则</th><th>口径</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>保留当前明细</td>
              <td>{{ meta.conflict.keepCurrent.resultVersionEffect }}</td>
              <td>{{ formatVersions(meta.conflict.keepCurrent.hitCounts) }}</td>
              <td>{{ meta.conflict.keepCurrent.pendingRules.join('、') || '—' }}</td>
              <td>{{ meta.conflict.keepCurrent.semantics === 'numeric-first' ? '数值优先' : '文本兼容' }}</td>
            </tr>
            <tr>
              <td>按新语义重算</td>
              <td>{{ meta.conflict.recompute.resultVersionEffect }}</td>
              <td>{{ formatVersions(meta.conflict.recompute.hitCounts) }}</td>
              <td>{{ meta.conflict.recompute.pendingRules.join('、') || '—' }}</td>
              <td>{{ meta.conflict.recompute.semantics === 'numeric-first' ? '数值优先' : '文本兼容' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="muted">
          当前版本 {{ formatVersions(meta.conflict.currentVersions) }}；保留路径进入待重验，
          重算路径发布单份新版本。
        </p>
        <ul class="compare-notes">
          <li>保留当前明细：{{ meta.conflict.keepCurrent.summary }}</li>
          <li>按新语义重算：{{ meta.conflict.recompute.summary }}</li>
        </ul>
        <div class="toolbar">
          <button class="btn" type="button" @click="decide('keep-current')">保留当前明细 + 待重验清单</button>
          <button class="btn primary" type="button" @click="decide('recompute')">按新语义重算并发布新版本</button>
        </div>
      </article>
    </section>

    <section v-else class="panel">
      <h3 class="section-title">字段依赖索引</h3>
      <p class="muted">
        索引修订 #{{ meta.indexRevision }} · 依赖索引与规则版本同一次落盘，读取时不会新索引配旧版本。
      </p>
      <table class="data-table">
        <thead>
          <tr><th>数据集</th><th>字段</th><th>引用规则</th></tr>
        </thead>
        <tbody>
          <tr v-for="entry in dependencyEntries" :key="`${entry.dataset}-${entry.field}`">
            <td>{{ entry.dataset }}</td>
            <td>{{ entry.field }}</td>
            <td>{{ entry.rules.join('、') || '无' }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="section-title">规则版本与依赖</h3>
      <table class="data-table">
        <thead>
          <tr><th>规则</th><th>版本</th><th>版本原因</th><th>依赖</th><th>依赖指纹</th><th>索引修订</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in meta.rules" :key="item.rule.ruleCode">
            <td>{{ item.rule.ruleCode }}</td>
            <td>v{{ item.ruleVersion.version }}</td>
            <td>{{ item.ruleVersion.reason }}</td>
            <td>{{ item.dependencies.join('、') }}</td>
            <td>{{ item.dependencyFingerprint }}</td>
            <td>#{{ item.ruleVersion.indexRevision }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="section-title">操作审计</h3>
      <table class="data-table">
        <thead><tr><th>时间</th><th>动作</th><th>明细</th><th>索引修订</th></tr></thead>
        <tbody>
          <tr v-for="entry in meta.auditLog" :key="entry.id">
            <td>{{ formatTime(entry.at) }}</td>
            <td>{{ entry.action }}</td>
            <td>{{ entry.detail }}</td>
            <td>#{{ entry.indexRevision }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条筛选规则 · 结果明细按规则归档，可随时回看</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  decideConflict,
  downloadEntries,
  interruptRevalidation,
  loadFilterWorkspace,
  moduleMeta,
  reorderRuleResult,
  runAction as applyAction,
  resumeRevalidation,
  seedAmountChange,
  seedDiscountChange,
  submitRule,
  type ReorderInput,
} from '@/api/local-service'
import FilterResultDetail from '@/components/FilterResultDetail.vue'
import { OPERATOR_LABELS } from '@/data/filter-seed'
import { FILTER_VIEW_KEY, writeView } from '@/data/filter-persistence'
import type {
  FieldChangeResult,
  FilterResultDetail as ResultDetail,
  FilterWorkspace,
  RuleResultView,
} from '@/data/filter-types'

const module = moduleMeta('filter')
const TABS = [
  { key: 'rules', label: '规则列表' },
  { key: 'results', label: '结果字段明细' },
  { key: 'revalidation', label: '重验与依赖' },
  { key: 'index', label: '依赖索引与审计' },
] as const
type ViewKey = (typeof TABS)[number]['key']

const workspace = ref<FilterWorkspace | null>(null)
const activeView = ref<ViewKey>('rules')
const rows = ref<RuleResultView[]>([])
const total = ref(0)
const errorMessage = ref('')
const message = ref('')
const messageIsError = ref(false)
const filters = ref<Record<string, string>>({})
const selectedRule = ref('')
const selectedColumns = ref<string[]>([])
const filterFields = ["规则编号", "目标数据集", "筛选字段"]
const ruleActions = ['提交校验', '启用规则', '停用规则']
const tabs = TABS

const meta = computed(() => workspace.value ?? emptyWorkspace())

const dependencyEntries = computed(() => {
  const list: { dataset: string; field: string; rules: string[] }[] = []
  const datasets = meta.value.datasets
  for (const dataset of datasets) {
    for (const field of dataset.fields) {
      const rules = meta.value.rules
        .filter((item) => item.rule.datasetCode === dataset.code && item.dependencies.includes(field))
        .map((item) => item.rule.ruleCode)
      if (rules.length) {
        list.push({ dataset: dataset.code, field, rules })
      }
    }
  }
  return list
})

const selectedResult = computed<ResultDetail | null>(() => {
  const item = meta.value.rules.find((row) => row.rule.ruleCode === selectedRule.value)
  return item?.result ?? null
})

const lastChange = computed(() => meta.value.lastChange)

const runStatusLabel = computed(() => {
  const run = meta.value.run
  if (!run) {
    return '无批次'
  }
  return run.status === 'completed' ? '已完成' : run.status === 'interrupted' ? '已中断' : '进行中'
})

function emptyWorkspace(): FilterWorkspace {
  return {
    revision: 0,
    indexRevision: 0,
    updatedAt: '',
    datasetFields: {},
    datasets: [],
    rules: [],
    results: [],
    resultCount: 0,
    pending: [],
    run: null,
    conflict: null,
    conflicts: [],
    lastChange: null,
    drillSnapshots: [],
    auditLog: [],
    perRuleSingleDetail: true,
  }
}

function reload() {
  errorMessage.value = ''
  try {
    workspace.value = loadFilterWorkspace()
    const ruleRows = workspace.value.rules.filter((item) => {
      const keyword = filters.value['规则编号']?.trim()
      const dataset = filters.value['目标数据集']?.trim()
      const field = filters.value['筛选字段']?.trim()
      return (
        (!keyword || item.rule.ruleCode.includes(keyword)) &&
        (!dataset || item.rule.datasetCode.includes(dataset)) &&
        (!field || item.rule.filterField.includes(field))
      )
    })
    rows.value = ruleRows
    total.value = ruleRows.length
    if (!rows.value.some((item) => item.rule.ruleCode === selectedRule.value)) {
      selectedRule.value = rows.value[0]?.rule.ruleCode ?? workspace.value.rules[0]?.rule.ruleCode ?? ''
    }
    syncSelectedColumns()
    persistSelection()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据筛选列表读取失败'
  }
}

function switchView(view: ViewKey) {
  activeView.value = view
  writeView(`${view}|${selectedRule.value}`)
}

function persistSelection() {
  writeView(`${activeView.value}|${selectedRule.value}`)
}

function syncSelectedColumns() {
  const result = selectedResult.value
  const dataset = workspace.value?.datasets.find((item) => item.code === result?.datasetCode)
  selectedColumns.value = dataset?.fields ?? (result?.hitRows[0] ? Object.keys(result.hitRows[0].values) : [])
}

function selectRule(ruleCode: string) {
  selectedRule.value = ruleCode
  activeView.value = 'results'
  syncSelectedColumns()
  persistSelection()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(module.key)
}

function openCreate() {
  errorMessage.value = '筛选规则登记入口尚未接入审批流'
}

function notify(text: string, isError = false) {
  message.value = text
  messageIsError.value = isError
}

function runReorder(ruleCode: string) {
  if (!ruleCode) {
    return
  }
  const input: ReorderInput = { ruleCode }
  const current = meta.value.rules.find((item) => item.rule.ruleCode === ruleCode)
  if (current?.rule.sortDirection === 'desc') {
    input.sortDirection = 'asc'
    input.rowLimit = current.rule.rowLimit
  } else {
    input.sortDirection = 'desc'
    input.rowLimit = Math.max(1, (current?.rule.rowLimit ?? 3) - 1)
  }
  const outcome = reorderRuleResult(input)
  notify(outcome.message, !outcome.ok)
  reload()
}

function runRuleAction(action: string, item: RuleResultView) {
  const outcome = applyAction(module.key, item.rule.id, action)
  notify(outcome.message, !outcome.ok)
  reload()
}

function submitOne(ruleCode: string) {
  if (!ruleCode) {
    return
  }
  const outcome = submitRule(ruleCode)
  notify(outcome.message, !outcome.ok)
  reload()
}

function simulateNumericChange() {
  const outcome = seedDiscountChange()
  afterChange(outcome)
}

function simulateMixedChange() {
  const outcome = seedDiscountChange({ mixed: true })
  afterChange(outcome)
}

function simulateAmountChange() {
  const outcome = seedAmountChange()
  afterChange(outcome)
}

function simulateInterruptedChange() {
  // 计划内第一条完成后中断，剩余规则留在待重验清单，恢复时只处理它们。
  const outcome = seedAmountChange({ stopAfter: 1 })
  afterChange(outcome)
  activeView.value = 'revalidation'
}

function afterChange(outcome: FieldChangeResult) {
  notify(
    `${outcome.message}；受影响 ${outcome.affectedRules.join('、') || '无'}，沿用 ${outcome.skippedRules.join('、') || '无'}`,
    !outcome.ok,
  )
  reload()
}

function decide(strategy: 'keep-current' | 'recompute') {
  const conflict = meta.value.conflict
  if (!conflict) {
    return
  }
  const outcome = decideConflict(conflict.id, strategy)
  notify(outcome.message, !outcome.ok)
  reload()
}

function interrupt() {
  const outcome = interruptRevalidation()
  notify(outcome.message, !outcome.ok)
  reload()
}

function resume() {
  const outcome = resumeRevalidation()
  notify(outcome.message, !outcome.ok)
  reload()
}

function resumeInterrupted() {
  const outcome = resumeRevalidation({ limit: 1 })
  notify(outcome.message, !outcome.ok)
  reload()
}

function isAffected(ruleCode: string): boolean {
  return !!lastChange.value?.affectedRules.includes(ruleCode)
}

function exportDetail() {
  const result = selectedResult.value
  if (!result) {
    return
  }
  const header = ['序号', '行标识', '命中值', ...selectedColumns.value]
  const lines = [header.join(',')]
  for (const row of result.hitRows) {
    lines.push(
      [row.position, row.rowId, row.matchValue ?? '', ...selectedColumns.value.map((field) => row.values[field] ?? '')].join(','),
    )
  }
  const filename = `${result.ruleCode}-结果明细-v${result.version}.csv`
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function originLabel(origin: ResultDetail['origin']): string {
  const labels: Record<ResultDetail['origin'], string> = {
    initial: '首次启用',
    'manual-submit': '规则提交',
    'local-revalidation': '字段局部重验',
    'full-reorder': '整组重排',
    'conflict-recompute': '冲突重算',
    'full-revalidation': '整表重验',
  }
  return labels[origin] ?? origin
}

function runModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    partial: '局部重验',
    full: '整表重验',
    resume: '恢复重验',
    reorder: '整组重排',
  }
  return labels[mode] ?? mode
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    'field-change': '字段变化',
    'conflict-keep-current': '口径冲突保留当前',
    'conflict-recompute': '口径冲突重算',
    reorder: '排序/上限变化',
    'full-scan': '整表重验',
    'definition-change': '数据集定义变化',
  }
  return labels[reason] ?? reason
}

function formatVersions(values: Record<string, number>): string {
  const entries = Object.entries(values)
  if (!entries.length) {
    return '—'
  }
  return entries.map(([rule, version]) => `${rule} v${version}`).join(' · ')
}

function formatTime(value: string): string {
  return value.replace('T', ' ').replace(/\..*$/, '')
}

onMounted(() => {
  const stored = window.localStorage.getItem(FILTER_VIEW_KEY) ?? ''
  const [view, ruleCode] = stored.split('|')
  if (TABS.some((tab) => tab.key === view)) {
    activeView.value = view as ViewKey
  }
  if (ruleCode) {
    selectedRule.value = ruleCode
  }
  reload()
  if (selectedRule.value) {
    persistSelection()
  }
  window.addEventListener('storage', reload)
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', reload)
})
</script>

<style scoped>
.view-tabs { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
.tab {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 999px;
  padding: 4px 14px;
  font-size: 13px;
  cursor: pointer;
}
.tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.view-hint { margin-left: auto; }
.panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; margin-bottom: 12px; }
.filter-item.inline { display: flex; align-items: center; gap: 6px; }
.section-title { font-size: 14px; margin: 16px 0 8px; }
.row-affected { background: #fff8e6; }
.row-selected { outline: 2px solid var(--brand); outline-offset: -2px; }
.tag-pending {
  margin-left: 6px;
  background: #fff4e5;
  color: #9a5b00;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
}
.notice {
  background: #eef6ff;
  border: 1px solid #c8ddf8;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}
.notice.error { background: #fff1f0; border-color: #f3c2bd; color: #b42318; }
.run-card,
.conflict-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fbfcfe;
}
.run-card header,
.conflict-card header { display: flex; gap: 8px; align-items: center; font-size: 13px; }
.run-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 16px;
  margin: 10px 0 0;
  font-size: 12px;
}
.run-meta div { display: flex; gap: 6px; }
.run-meta dt { color: var(--muted); white-space: nowrap; }
.run-meta dd { margin: 0; }
.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: var(--muted);
  font-size: 12px;
}
.muted { color: var(--muted); font-size: 12px; }
.compare-notes { margin: 8px 0; padding-left: 18px; font-size: 12px; color: #334155; }
.compare-notes li { margin-bottom: 4px; }
.history { margin-top: 16px; }
.history summary { cursor: pointer; font-size: 13px; margin-bottom: 8px; }
</style>
