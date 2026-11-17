<template>
  <section class="page" data-module="drill">
    <header class="page-head">
      <div>
        <h2>多维下钻管理</h2>
        <p class="page-desc">维护多维下钻路径的输入、执行约束与结果记录，为数据探查提供可验证的数据工程流程。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记下钻路径</button>
        <button class="btn" type="button" @click="exportRows">导出多维下钻清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

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
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无多维下钻数据，可先登记下钻路径</td>
        </tr>
      </tbody>
    </table>

    <section class="drill-link" data-drill-link>
      <header class="drill-link-head">
        <div>
          <h3>下钻结果与筛选结果明细联动</h3>
          <p class="muted">
            选中的下钻路径复用筛选结果明细的命中行；筛选侧重验后，这里保留新版本命中行和来源版本号。
          </p>
        </div>
        <label class="filter-item inline">
          <span>下钻路径</span>
          <select v-model="selectedDrill" @change="loadDrill">
            <option v-for="row in rows" :key="String(row.id)" :value="String(row['路径编号'] ?? '')">
              {{ row['路径编号'] }}
            </option>
          </select>
        </label>
      </header>

      <div v-if="drillSnapshot" class="drill-summary">
        <span class="badge">数据集 {{ drillSnapshot.datasetCode }}</span>
        <span class="badge">命中行 {{ drillSnapshot.hitRows.length }}</span>
        <span class="badge">保留版本 {{ drillSnapshot.retainedVersions.map((v) => `v${v}`).join('、') || '—' }}</span>
        <span class="badge">索引 #{{ drillIndexRevision }}</span>
      </div>

      <table v-if="drillSnapshot" class="data-table compact">
        <thead>
          <tr>
            <th>序号</th>
            <th>行标识</th>
            <th>来源规则</th>
            <th>来源结果版本</th>
            <th>命中值</th>
            <th>保留时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in drillSnapshot.hitRows" :key="`${row.sourceRuleCode}-${row.rowId}`">
            <td>{{ row.position }}</td>
            <td>{{ row.rowId }}</td>
            <td>{{ row.sourceRuleCode }}</td>
            <td>v{{ row.sourceResultVersion }}</td>
            <td>{{ row.matchValue ?? '—' }}</td>
            <td>{{ formatTime(row.retainedAt) }}</td>
          </tr>
          <tr v-if="!drillSnapshot.hitRows.length">
            <td colspan="6" class="empty-state">该下钻路径还没有命中行，可先在数据筛选页提交规则</td>
          </tr>
        </tbody>
      </table>

      <div v-if="linkedResults.length" class="linked-results">
        <FilterResultDetail
          v-for="result in linkedResults"
          :key="result.resultId"
          :result="result"
          :columns="drillColumns"
        />
      </div>
      <p v-else class="empty-state">该数据集还没有可回看的筛选结果明细</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条多维下钻记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import FilterResultDetail from '@/components/FilterResultDetail.vue'
import { loadDrillWorkspace } from '@/api/local-service'
import type { DrillSnapshot, FilterResultDetail as ResultDetail } from '@/data/filter-types'

const meta = moduleMeta('drill')
const columns = ["路径编号", "起点维度", "下钻层数", "层级维度列表", "聚合指标", "默认展开层", "排序方向", "最多展示行数"]
const actions = ["提交校验", "启用路径", "停用路径"]
const statuses = ["草稿", "待校验", "已启用", "已停用"]
const stats = [{"label": "下钻路径总数", "value": 0}, {"label": "已启用路径", "value": 0}, {"label": "待校验路径", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedDrill = ref('')
const drillSnapshot = ref<DrillSnapshot | null>(null)
const linkedResults = ref<ResultDetail[]>([])
const drillIndexRevision = ref(0)
const drillColumns = ref<string[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '下钻路径登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '多维下钻列表读取失败'
  }
}

function loadDrill() {
  if (!selectedDrill.value) {
    drillSnapshot.value = null
    linkedResults.value = []
    return
  }
  const payload = loadDrillWorkspace(selectedDrill.value)
  drillSnapshot.value = payload.snapshot
  linkedResults.value = payload.results
  drillIndexRevision.value = payload.indexRevision
  const first = payload.results[0]?.hitRows[0]
  drillColumns.value = first ? Object.keys(first.values) : []
}

function formatTime(value: string): string {
  return value.replace('T', ' ').replace(/\..*$/, '')
}

onMounted(() => {
  reload()
  if (!selectedDrill.value && rows.value.length) {
    selectedDrill.value = String(rows.value[0]['路径编号'] ?? '')
  }
  loadDrill()
})
</script>

<style scoped>
.drill-link {
  margin-top: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  padding: 12px;
}
.drill-link-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.drill-link-head h3 { margin: 0 0 4px; font-size: 14px; }
.drill-summary { display: flex; gap: 8px; margin: 8px 0; }
.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: var(--muted);
  font-size: 12px;
}
.filter-item.inline { display: flex; align-items: center; gap: 6px; }
.muted { color: var(--muted); font-size: 12px; }
.linked-results { margin-top: 12px; }
.data-table.compact th,
.data-table.compact td { padding: 5px 8px; font-size: 12px; }
</style>
