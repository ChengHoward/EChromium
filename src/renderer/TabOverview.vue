<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { overviewTabs, tabLocation, tabIcon, type TabPreview } from '../shared/tab-overview'
import type { BrowserRequest, BrowserState } from '../shared/model'
const props = defineProps<{
  state: BrowserState
  run: (request: BrowserRequest) => Promise<BrowserState | undefined>
}>()
const search = ref<HTMLInputElement>(),
  grid = ref<HTMLElement>(),
  query = ref(''),
  pinned = ref(false),
  composing = ref(false),
  previews = ref<Record<string, TabPreview>>({}),
  waiting = ref(new Set<string>()),
  failed = ref('')
const filtered = computed(() => overviewTabs(props.state.tabs, query.value, pinned.value))
let observer: IntersectionObserver | undefined,
  alive = true,
  batchTimer: ReturnType<typeof setTimeout> | undefined,
  inFlight = false
const pending = new Set<string>()
function focusSearch() {
  search.value?.focus()
  search.value?.select()
}
function resetFilter() {
  query.value = ''
  pinned.value = false
}
defineExpose({ focusSearch })
function enqueue(id: string) {
  const tab = props.state.tabs.find((tab) => tab.id === id)
  if (
    !tab ||
    tab.loading ||
    previews.value[id]?.version === (tab.previewVersion || 0) ||
    waiting.value.has(id)
  )
    return
  pending.add(id)
  schedule()
}
function schedule() {
  if (!inFlight && !batchTimer && alive && pending.size)
    batchTimer = setTimeout(() => {
      batchTimer = undefined
      void load()
    }, 30)
}
async function load() {
  const token = props.state.overview
  if (!alive || !token || inFlight) return
  const ids = [...pending].slice(0, 8)
  ids.forEach((id) => {
    pending.delete(id)
    waiting.value.add(id)
  })
  if (!ids.length) return
  inFlight = true
  try {
    const result = await window.browser.tabPreviews({ token, ids })
    if (!alive || props.state.overview !== token) return
    for (const preview of result)
      if (
        props.state.tabs.some((tab) => tab.id === preview.id && (tab.previewVersion || 0) === preview.version)
      )
        previews.value[preview.id] = preview
  } catch (cause) {
    if (alive) failed.value = '部分预览暂不可用，仍可选择标签继续浏览。'
  } finally {
    inFlight = false
    ids.forEach((id) => waiting.value.delete(id))
    schedule()
    if (alive) void observe()
  }
}
async function observe() {
  await nextTick()
  if (!alive || !grid.value) return
  observer?.disconnect()
  for (const card of grid.value.querySelectorAll<HTMLElement>('[data-overview-id]')) observer?.observe(card)
}
function choose(id: string) {
  if (!composing.value) void props.run({ action: 'activate', id })
}
function first(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) return
  event.preventDefault()
  if (filtered.value[0]) choose(filtered.value[0].id)
}
function key(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void props.run({ action: 'tab-overview', value: false })
  }
  if (
    ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
    (event.target as HTMLElement).classList.contains('overview-select')
  ) {
    const cards = [...grid.value!.querySelectorAll<HTMLButtonElement>('.overview-select')],
      at = cards.indexOf(event.target as HTMLButtonElement),
      columns = Math.max(
        1,
        Math.round(
          grid.value!.clientWidth / (cards[0]?.closest('article')?.getBoundingClientRect().width || 250),
        ),
      )
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? cards.length - 1
          : at +
            (event.key === 'ArrowLeft'
              ? -1
              : event.key === 'ArrowRight'
                ? 1
                : event.key === 'ArrowUp'
                  ? -columns
                  : columns)
    event.preventDefault()
    cards[Math.max(0, Math.min(cards.length - 1, next))]?.focus()
  }
}
watch(
  () =>
    JSON.stringify([
      filtered.value.map((tab) => [tab.id, tab.previewVersion, tab.loading]),
      props.state.overview,
    ]),
  observe,
)
onMounted(async () => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) enqueue((entry.target as HTMLElement).dataset.overviewId!)
    },
    { root: grid.value, rootMargin: '180px' },
  )
  await observe()
  focusSearch()
})
onBeforeUnmount(() => {
  alive = false
  clearTimeout(batchTimer)
  observer?.disconnect()
  pending.clear()
})
</script>
<template>
  <section class="tab-overview" aria-label="标签总览" @keydown="key">
    <header class="overview-header">
      <div>
        <h1>标签总览</h1>
        <p>
          {{ state.tabs.length }} 个标签<span v-if="state.private"> · 隐私窗口</span
          ><span v-else> · 当前窗口</span>
        </p>
      </div>
      <label class="overview-search"
        ><Icon name="search" /><input
          ref="search"
          v-model="query"
          placeholder="搜索标题或网址"
          aria-label="搜索标签"
          @compositionstart="composing = true"
          @compositionend="composing = false"
          @keydown.enter="first" /></label
      ><button
        class="icon-button overview-dismiss"
        aria-label="退出标签总览"
        title="返回当前标签 (Esc)"
        @click="run({ action: 'tab-overview', value: false })"
      >
        <Icon name="close" />
      </button>
    </header>
    <div class="overview-filter">
      <button :class="{ chosen: !pinned }" :aria-pressed="!pinned" @click="pinned = false">
        全部 {{ state.tabs.length }}</button
      ><button :class="{ chosen: pinned }" :aria-pressed="pinned" @click="pinned = true">
        <Icon name="pin" :size="13" />已固定 {{ state.tabs.filter((tab) => tab.pinned).length }}</button
      ><span>{{ query.trim() ? `${filtered.length} 个匹配标签` : '选择标签，继续浏览' }}</span>
    </div>
    <div ref="grid" class="overview-grid" role="list" aria-label="打开的标签">
      <article
        v-for="tab in filtered"
        :key="tab.id"
        class="overview-card"
        :class="{ current: tab.id === state.activeId }"
        :data-overview-id="tab.id"
        role="listitem"
      >
        <button
          class="overview-select"
          :aria-label="`切换到 ${tab.title}`"
          :aria-current="tab.id === state.activeId ? 'page' : undefined"
          @click="choose(tab.id)"
        >
          <div class="overview-preview">
            <img
              v-if="previews[tab.id]?.image && previews[tab.id].version === (tab.previewVersion || 0)"
              :src="previews[tab.id].image"
              alt=""
              draggable="false"
            />
            <div v-else class="overview-placeholder">
              <Icon :name="tab.error || tab.crashed ? 'warning' : tabIcon(tab)" :size="34" /><span>{{
                tab.error || tab.crashed
                  ? '页面暂不可用'
                  : tab.kind !== 'web'
                    ? tabLocation(tab)
                    : tab.loading
                      ? '正在加载网页…'
                      : previews[tab.id]?.status === 'unloaded'
                        ? '选中后载入网页'
                        : waiting.has(tab.id)
                          ? '正在获取预览…'
                          : '暂无网页预览'
              }}</span>
            </div>
            <span v-if="tab.id === state.activeId" class="overview-current">当前标签</span
            ><span v-if="tab.pinned" class="overview-pin" aria-label="已固定"
              ><Icon name="pin" :size="13"
            /></span>
          </div>
          <div class="overview-meta">
            <Icon :name="tabIcon(tab)" :size="16" />
            <div>
              <strong>{{ tab.title }}</strong
              ><small>{{ tabLocation(tab) }}</small>
            </div>
            <Icon
              v-if="tab.muted || tab.audible"
              name="audio"
              :size="15"
              :aria-label="tab.muted ? '已静音' : '正在播放声音'"
            />
          </div></button
        ><button
          class="overview-card-close icon-button"
          :aria-label="`关闭 ${tab.title}`"
          title="关闭标签"
          @click="run({ action: 'close-tab', id: tab.id })"
        >
          <Icon name="close" :size="15" />
        </button>
      </article>
      <div v-if="!filtered.length" class="overview-empty">
        <Icon name="search" :size="30" />
        <h2>{{ pinned && !query ? '没有固定的标签' : '没有找到匹配的标签' }}</h2>
        <p>试试其它标题或网址。</p>
        <button class="secondary-button" @click="resetFilter">查看全部标签</button>
      </div>
    </div>
    <footer class="overview-footer">
      <span>{{ failed || '预览为最近画面' }}</span
      ><button class="text-action" @click="run({ action: 'new-tab' })">
        <Icon name="plus" :size="14" />新建标签页
      </button>
    </footer>
  </section>
</template>
