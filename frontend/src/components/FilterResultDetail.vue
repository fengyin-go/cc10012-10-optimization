<template>
  <article class="result-card" :data-result-id="result.resultId">
    <header class="result-head">
      <div>
        <strong>{{ result.ruleCode }}</strong>
        <span class="badge">结果明细 {{ result.resultId }}</span>
        <span class="badge">v{{ result.version }}</span>
        <span class="badge">重验 v{{ result.revalidationVersion }}</span>
        <span class="badge" :class="statusClass">{{ statusLabel }}</span>
      </div>
      <span class="muted">
        数据集 {{ result.datasetCode }} · {{ result.hitRows.length }}/{{ result.matchedCount }} 行
        <template v-if="result.truncated">（已按上限 {{ result.rowLimit }} 截断）</template>
      </span>
    </header>
    <dl class="result-meta">
      <div><dt>归档规则</dt><dd>规则 v{{ result.archivedRule.ruleVersion }} · {{ result.archivedConditions.note }}</dd></div>
      <div><dt>比较口径</dt><dd>{{ result.archivedConditions.semantics === 'numeric-first' ? '数值优先' : '文本兼容' }}</dd></div>
      <div><dt>排序</dt><dd>{{ result.sortField }} {{ result.sortDirection === 'asc' ? '升序' : '降序' }} · 上限 {{ result.rowLimit }}</dd></div>
      <div><dt>字段依赖</dt><dd>{{ result.archivedRule.filterField }}、{{ result.archivedRule.sortField }}</dd></div>
      <div><dt>发布</dt><dd>{{ formatTime(result.publishedAt) }} · {{ result.publishedBy }} · {{ originLabel }}</dd></div>
      <div><dt>顺序核对</dt><dd>{{ result.orderVerified ? '与规则一致' : '待核对' }}</dd></div>
    </dl>
    <p v-if="result.missingFields.length" class="warn-text">
      缺少字段：{{ result.missingFields.join('、') }}
    </p>
    <table class="data-table compact">
      <thead>
        <tr>
          <th>序号</th>
          <th>行标识</th>
          <th v-for="column in resolvedColumns" :key="column">{{ column }}</th>
          <th>命中值</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in result.hitRows" :key="row.rowId">
          <td>{{ row.position }}</td>
          <td>{{ row.rowId }}</td>
          <td v-for="column in resolvedColumns" :key="column">{{ row.values[column] ?? '—' }}</td>
          <td>{{ row.matchValue ?? '—' }}</td>
        </tr>
        <tr v-if="!result.hitRows.length">
          <td :colspan="resolvedColumns.length + 3" class="empty-state">当前规则没有命中行</td>
        </tr>
      </tbody>
    </table>
    <footer class="result-foot">
      <span>内容指纹 {{ result.contentHash }} · 依赖指纹 {{ result.dependencyFingerprint }}</span>
      <span>幂等键 {{ result.idempotencyKey }}</span>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { FilterResultDetail } from '@/data/filter-types'

/**
 * 筛选结果字段明细的统一展示：筛选页、结果抽屉和多维下钻页共用这一份，
 * 各页面不再各写一遍命中行表格。
 */
const props = defineProps<{
  result: FilterResultDetail
  columns?: string[]
}>()

const ORIGIN_LABELS: Record<FilterResultDetail['origin'], string> = {
  initial: '首次启用',
  'manual-submit': '规则提交',
  'local-revalidation': '字段局部重验',
  'full-reorder': '整组重排',
  'conflict-recompute': '冲突按新语义重算',
  'full-revalidation': '整表重验',
}

const resolvedColumns = computed(() => {
  if (props.columns?.length) {
    return props.columns
  }
  const first = props.result.hitRows[0]
  return first ? Object.keys(first.values) : []
})

const originLabel = computed(() => ORIGIN_LABELS[props.result.origin] ?? props.result.origin)

const statusLabel = computed(() =>
  props.result.status === 'ready' ? '可回看' : props.result.status === 'pending' ? '待重验' : '重验中',
)

const statusClass = computed(() => `badge-${props.result.status}`)

function formatTime(value: string): string {
  return value.replace('T', ' ').replace(/\..*$/, '')
}
</script>

<style scoped>
.result-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  padding: 12px;
  margin-bottom: 12px;
}
.result-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-size: 13px;
}
.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: var(--muted);
  font-size: 12px;
}
.badge-ready { background: #e7f6ec; color: #17663a; }
.badge-pending { background: #fff4e5; color: #9a5b00; }
.badge-revalidating { background: #e8f0fe; color: #1f4fbf; }
.result-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 16px;
  margin: 10px 0;
  font-size: 12px;
}
.result-meta div { display: flex; gap: 6px; }
.result-meta dt { color: var(--muted); white-space: nowrap; }
.result-meta dd { margin: 0; }
.muted { color: var(--muted); font-size: 12px; }
.warn-text { color: #9a5b00; font-size: 12px; }
.result-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}
.data-table.compact th,
.data-table.compact td { padding: 5px 8px; font-size: 12px; }
</style>
