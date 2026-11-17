import type { FilterState } from './filter-types'

/**
 * 筛选域状态的持久化位置。
 *
 * 和模块列表数据分两个 key：列表走 data-explore-studio:entries，筛选结果明细单独存放，
 * 切换页面/视图后仍可回看，也不会被列表重播种覆盖。
 */
export const FILTER_STATE_KEY = 'data-explore-studio:filter-state'
export const FILTER_VIEW_KEY = 'data-explore-studio:filter-view'
export const MAX_AUDIT_ENTRIES = 60

let filterCache: FilterState | null = null

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasWindow(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

export function readFilterState(): FilterState | null {
  if (filterCache) {
    return filterCache
  }
  if (!hasWindow()) {
    return null
  }
  const raw = window.localStorage.getItem(FILTER_STATE_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as FilterState
    if (!parsed || parsed.schemaVersion !== 1) {
      return null
    }
    filterCache = parsed
    return filterCache
  } catch {
    return null
  }
}

export function writeFilterState(state: FilterState): void {
  filterCache = clone(state)
  if (hasWindow()) {
    window.localStorage.setItem(FILTER_STATE_KEY, JSON.stringify(filterCache))
  }
}

export function clearFilterState(): void {
  filterCache = null
  if (hasWindow()) {
    window.localStorage.removeItem(FILTER_STATE_KEY)
    window.localStorage.removeItem(FILTER_VIEW_KEY)
  }
}

export function readView(): string {
  if (!hasWindow()) {
    return ''
  }
  return window.localStorage.getItem(FILTER_VIEW_KEY) ?? ''
}

export function writeView(view: string): void {
  if (hasWindow()) {
    window.localStorage.setItem(FILTER_VIEW_KEY, view)
  }
}
