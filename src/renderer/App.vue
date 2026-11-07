<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import TabOverview from './TabOverview.vue'
import HistoryPage from './pages/HistoryPage.vue'
import DownloadsPage from './pages/DownloadsPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import NewTabPage from './pages/NewTabPage.vue'
import BookmarksPage from './pages/BookmarksPage.vue'
import { addressChoices, choiceLabel, type AddressChoice } from '../shared/suggestions'

import type { BrowserRequest, BrowserState } from '../shared/model'

const state = ref<BrowserState>(),
  address = ref<HTMLInputElement>(),
  addressAnchor = ref<HTMLElement>(),
  siteTrigger = ref<HTMLButtonElement>(),
  chrome = ref<HTMLElement>(),
  viewport = ref<HTMLElement>(),
  tabStrip = ref<HTMLElement>(),
  overviewPanel = ref<InstanceType<typeof TabOverview>>()
const stripWidth = ref(1000)
const draft = ref(''),
  editing = ref(false),
  composing = ref(false),
  message = ref(''),
  dragging = ref('')
const selectedSuggestion = ref(-1),
  suggestionsDismissed = ref(false)
const choices = computed(() =>
  state.value
    ? addressChoices(draft.value, {
        tabs: state.value.tabs,
        activeId: state.value.activeId,
        bookmarks: state.value.bookmarks,
        history: state.value.history,
        search: state.value.preferences.search,
      })
    : [],
)
const suggestionsOpen = computed(
  () => editing.value && !composing.value && !suggestionsDismissed.value && choices.value.length > 0,
)
const active = computed(() => state.value?.tabs.find((t) => t.id === state.value?.activeId))
const tabDensity = computed(() => {
  const tabs = state.value?.tabs || [],
    pins = tabs.filter((tab) => tab.pinned).length,
    normal = tabs.length - pins,
    activeNormal = active.value && !active.value.pinned ? 1 : 0
  const remaining = stripWidth.value - 24 - pins * 42 - Math.max(0, tabs.length - 1) * 3 - activeNormal * 112
  const width = normal > activeNormal ? remaining / (normal - activeNormal) : 203
  return width < 56 ? 'icons' : width < 84 ? 'dense' : width < 125 ? 'compressed' : 'comfortable'
})
async function revealActiveTab() {
  await nextTick()
  tabStrip.value?.querySelector('.tab.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
function toggleOverview() {
  void dispatch({ action: 'tab-overview' })
}
function scrollTabs(event: WheelEvent) {
  const strip = tabStrip.value
  if (strip && strip.scrollWidth > strip.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    event.preventDefault()
    strip.scrollLeft +=
      event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? strip.clientWidth : 1)
  }
}
const bookmarked = computed(() => !!state.value?.bookmarks.some((b) => b.url === active.value?.url))
const isError = computed(() => active.value?.kind === 'web' && (active.value.error || active.value.crashed))
const style = computed(() =>
  Object.fromEntries(Object.entries(state.value?.palette || {}).map(([k, v]) => [`--${k}`, v])),
)

let observer: ResizeObserver | undefined,
  unsubscribe: (() => void) | undefined,
  unsubscribeUi: (() => void) | undefined
let messageTimer: ReturnType<typeof setTimeout>,
  frame = 0
let suggestionTimer: ReturnType<typeof setTimeout>
let lastLayout = ''
let overviewScroll: { id?: string; top: number; left: number } | undefined
function update(value: BrowserState) {
  if (!state.value || value.revision >= state.value.revision) state.value = value
}
function notify(text: string) {
  message.value = text.replace(/^Error: (?:Error invoking remote method '[^']+': Error: )?/, '')
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => (message.value = ''), 5000)
}
async function dispatch(request: BrowserRequest) {
  try {
    const value = await window.browser.request(request)
    update(value)
    return value
  } catch (error) {
    notify(String(error))
  }
}
async function focusAddress() {
  await nextTick()
  address.value?.focus()
  address.value?.select()
}
async function navigate(text = draft.value) {
  if (!text.trim() || composing.value) return
  editing.value = false
  address.value?.blur()
  await dispatch({ action: 'navigate', text, id: active.value?.id })
}
function focusAddressInput() {
  editing.value = true
  suggestionsDismissed.value = false
  selectedSuggestion.value = -1
}
function addressInput() {
  suggestionsDismissed.value = false
  selectedSuggestion.value = 0
}
function acceptSuggestion(choice?: AddressChoice) {
  if (composing.value) return
  suggestionsDismissed.value = true
  if (choice?.tabId) {
    address.value?.blur()
    void dispatch({ action: 'activate', id: choice.tabId })
  } else void navigate(choice?.url || draft.value)
}
function addressKey(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (suggestionsOpen.value) suggestionsDismissed.value = true
    else cancelAddress()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    suggestionsDismissed.value = false
    const count = choices.value.length
    if (count) {
      const direction = event.key === 'ArrowDown' ? 1 : -1
      selectedSuggestion.value =
        selectedSuggestion.value < 0 || selectedSuggestion.value >= count
          ? direction > 0
            ? 0
            : count - 1
          : (selectedSuggestion.value + direction + count) % count
    }
  } else if (event.key === 'Enter') {
    event.preventDefault()
    acceptSuggestion(suggestionsOpen.value ? choices.value[selectedSuggestion.value] : undefined)
  }
}
function showSuggestions() {
  clearTimeout(suggestionTimer)
  suggestionTimer = setTimeout(() => {
    const rect = addressAnchor.value?.getBoundingClientRect()
    if (suggestionsOpen.value && state.value?.nativeSuggestions && rect)
      void window.browser
        .suggestions({
          id: active.value?.id,
          text: draft.value,
          value: {
            anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            selected: selectedSuggestion.value,
          },
        })
        .catch((error) => notify(String(error)))
    else void window.browser.suggestions({ value: false }).catch((error) => notify(String(error)))
  }, 35)
}
function open(url: string, event?: MouseEvent) {
  if (event?.ctrlKey || event?.metaKey) void dispatch({ action: 'new-tab', url })
  else void navigate(url)
}
function blurAddress() {
  editing.value = false
  draft.value = active.value?.kind === 'web' ? active.value.pendingUrl || active.value.url : ''
}
function cancelAddress() {
  editing.value = false
  draft.value = active.value?.kind === 'web' ? active.value.url : ''
  address.value?.blur()
}
function reportLayout() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (tabStrip.value) stripWidth.value = tabStrip.value.clientWidth
    const rect = viewport.value?.getBoundingClientRect()
    const id = active.value?.id
    const key = rect && JSON.stringify([id, rect.x, rect.y, rect.width, rect.height])
    if (rect && id && key !== lastLayout) {
      lastLayout = key || ''
      void dispatch({
        action: 'layout',
        id,
        value: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      })
    }
  })
  if (suggestionsOpen.value) showSuggestions()
}
const tabDragType = 'application/x-echromium-tab'
function startTabDrag(event: DragEvent, id: string) {
  dragging.value = id
  event.dataTransfer?.setData(tabDragType, id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function leavingTab(element: Element) {
  const tab = element as HTMLElement
  tab.style.setProperty('--tab-exit-width', `${tab.getBoundingClientRect().width}px`)
  tab.classList.remove('selected')
  tab.setAttribute('aria-selected', 'false')
  tab.setAttribute('aria-hidden', 'true')
  tab.inert = true
}
function dragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes(tabDragType)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}
function drop(event: DragEvent, before?: string) {
  const id = event.dataTransfer?.getData(tabDragType) || dragging.value
  if (!state.value || !id || id === before) return
  event.preventDefault()
  event.stopPropagation()
  if (state.value.tabs.some((t) => t.id === id)) {
    const order = state.value.tabs.map((t) => t.id).filter((tabId) => tabId !== id)
    order.splice(before === undefined ? order.length : order.indexOf(before), 0, id)
    void dispatch({ action: 'reorder', value: order })
  } else void dispatch({ action: 'adopt-tab', id, value: before ? { beforeId: before } : undefined })
  dragging.value = ''
}
function showSiteInfo() {
  const rect = siteTrigger.value?.getBoundingClientRect()
  if (!rect) return
  suggestionsDismissed.value = true
  void dispatch({
    action: 'page-info',
    id: active.value?.id,
    value: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  })
}
watch(
  [
    draft,
    suggestionsOpen,
    selectedSuggestion,
    () => state.value?.nativeSuggestions,
    () => JSON.stringify(choices.value),
  ],
  showSuggestions,
)
watch(
  () => active.value?.id,
  () => {
    editing.value = false
    composing.value = false
    suggestionsDismissed.value = true
    selectedSuggestion.value = -1
    draft.value = active.value?.kind === 'web' ? active.value.pendingUrl || active.value.url : ''
    address.value?.blur()
  },
)
watch(
  () => JSON.stringify([active.value?.id, active.value?.url, active.value?.pendingUrl]),
  () => {
    if (!editing.value)
      draft.value = active.value?.kind === 'web' ? active.value.pendingUrl || active.value.url : ''
    void nextTick(reportLayout)
  },
)
watch(
  () =>
    JSON.stringify([
      state.value?.preferences.bookmarksBar,
      state.value?.fullscreen,
      active.value?.kind,
      suggestionsOpen.value && !state.value?.nativeSuggestions,
    ]),
  () => {
    void nextTick(reportLayout)
  },
)
watch(() => JSON.stringify([active.value?.id, state.value?.tabs.length, tabDensity.value]), revealActiveTab)
watch(
  () => state.value?.overview,
  async (token) => {
    if (token && viewport.value) {
      overviewScroll = {
        id: active.value?.id,
        top: viewport.value.scrollTop,
        left: viewport.value.scrollLeft,
      }
      viewport.value.scrollTop = viewport.value.scrollLeft = 0
    }
    editing.value = false
    suggestionsDismissed.value = true
    address.value?.blur()
    await nextTick()
    if (!token && overviewScroll && viewport.value) {
      viewport.value.scrollTop = overviewScroll.id === active.value?.id ? overviewScroll.top : 0
      viewport.value.scrollLeft = overviewScroll.id === active.value?.id ? overviewScroll.left : 0
      overviewScroll = undefined
    }
    if (token) overviewPanel.value?.focusSearch()
    else if (active.value?.kind !== 'web' && document.activeElement === document.body)
      document.querySelector<HTMLButtonElement>('.tab-overview-toggle')?.focus({ preventScroll: true })
  },
)
onMounted(async () => {
  if (!window.browser) {
    notify('请使用 npm start 在桌面浏览器中打开。')
    return
  }
  unsubscribe = window.browser.onState(update)
  unsubscribeUi = window.browser.onUi(async (event) => {
    if (event.type === 'focus-address') await focusAddress()
    else if (event.type === 'address-dismissed') suggestionsDismissed.value = true
    else if (event.type === 'notice') notify(event.text)
    else if (event.type === 'overview-search') overviewPanel.value?.focusSearch()
  })
  await dispatch({ action: 'state' })
  await nextTick()
  observer = new ResizeObserver(reportLayout)
  if (viewport.value) observer.observe(viewport.value)
  if (chrome.value) observer.observe(chrome.value)
  if (tabStrip.value) observer.observe(tabStrip.value)
  window.addEventListener('resize', reportLayout)
  reportLayout()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', reportLayout)
  unsubscribe?.()
  unsubscribeUi?.()
  cancelAnimationFrame(frame)
  clearTimeout(messageTimer)
  clearTimeout(suggestionTimer)
})
</script>

<template>
  <div
    v-if="state"
    class="browser-shell"
    :class="{
      dark: state.dark,
      private: state.private,
      fullscreen: state.fullscreen,
      'overview-open': !!state.overview,
    }"
    :style="style"
  >
    <header ref="chrome" class="chrome">
      <div class="titlebar">
        <button
          class="icon-button tab-overview-toggle"
          aria-label="标签总览"
          :aria-pressed="!!state.overview"
          title="标签总览 (Ctrl+Shift+A)"
          @click="toggleOverview"
        >
          <Icon name="grid" :size="18" />
        </button>
        <div
          ref="tabStrip"
          class="tabs"
          :class="tabDensity"
          role="tablist"
          @wheel="scrollTabs"
          aria-label="浏览器标签页"
          @dragover="dragOver"
          @drop="drop($event)"
        >
          <TransitionGroup
            name="tab-motion"
            @before-leave="leavingTab"
            @after-enter="revealActiveTab"
            @after-leave="revealActiveTab"
          >
            <div
              v-for="tab in state.tabs"
              :key="tab.id"
              :data-tab-id="tab.id"
              class="tab"
              :class="{ selected: tab.id === state.activeId && !state.overview, pinned: tab.pinned }"
              role="tab"
              :aria-selected="tab.id === state.activeId && !state.overview"
              :tabindex="tab.id === state.activeId ? 0 : -1"
              :title="tab.title"
              draggable="true"
              @dragstart="startTabDrag($event, tab.id)"
              @dragend="dragging = ''"
              @dragover="dragOver"
              @drop="drop($event, tab.id)"
              @click="dispatch({ action: 'activate', id: tab.id })"
              @keydown.enter="dispatch({ action: 'activate', id: tab.id })"
              @contextmenu.prevent="dispatch({ action: 'tab-menu', id: tab.id })"
              @auxclick.middle.prevent="dispatch({ action: 'close-tab', id: tab.id })"
            >
              <span class="tab-background" aria-hidden="true"></span>
              <span v-if="tab.loading" class="spinner"></span
              ><Icon
                v-else
                class="tab-icon"
                :name="
                  tab.pinned
                    ? 'pin'
                    : tab.kind === 'settings'
                      ? 'settings'
                      : tab.kind === 'bookmarks'
                        ? 'star'
                        : tab.kind === 'history'
                          ? 'history'
                          : tab.kind === 'downloads'
                            ? 'download'
                            : 'globe'
                "
                :size="16"
              />
              <span class="tab-title">{{ tab.title }}</span>
              <Icon v-if="tab.audible || tab.muted" class="tab-audio" name="audio" :size="13" />
              <button
                v-if="!tab.pinned"
                class="tab-close"
                aria-label="关闭标签页"
                @click.stop="dispatch({ action: 'close-tab', id: tab.id })"
              >
                <Icon name="close" :size="12" />
              </button>
              <span class="tab-separator" aria-hidden="true"></span>
            </div>
          </TransitionGroup>
        </div>
        <button
          class="icon-button new-tab"
          title="新标签页 (Ctrl+T)"
          aria-label="新标签页"
          @click="dispatch({ action: 'new-tab' })"
        >
          <Icon name="plus" />
        </button>
        <span v-if="state.private" class="private-badge"><Icon name="private" :size="15" /> 隐私</span>
        <div class="window-controls-space"></div>
      </div>
      <div class="toolbar">
        <div class="navigation-actions">
          <button
            class="icon-button"
            title="后退 (Alt+←)"
            aria-label="后退"
            :disabled="!active?.canGoBack"
            @click="dispatch({ action: 'back' })"
          >
            <Icon name="back" />
          </button>
          <button
            class="icon-button"
            title="前进 (Alt+→)"
            aria-label="前进"
            :disabled="!active?.canGoForward"
            @click="dispatch({ action: 'forward' })"
          >
            <Icon name="forward" />
          </button>
          <button
            class="icon-button"
            :title="active?.loading ? '停止加载' : '重新加载 (Ctrl+R)'"
            :aria-label="active?.loading ? '停止加载' : '重新加载'"
            @click="dispatch({ action: active?.loading ? 'stop' : 'reload' })"
          >
            <Icon :name="active?.loading ? 'close' : 'reload'" />
          </button>
        </div>
        <form
          ref="addressAnchor"
          class="address-bar"
          :class="{ focused: editing }"
          @submit.prevent="acceptSuggestion(suggestionsOpen ? choices[selectedSuggestion] : undefined)"
        >
          <button
            v-if="active?.kind === 'web'"
            ref="siteTrigger"
            type="button"
            class="icon-button site-info-button"
            aria-label="网站信息与连接安全"
            title="网站信息与连接安全"
            :disabled="active.loading || !!active.error || active.crashed"
            @click="showSiteInfo"
          >
            <Icon :name="state.private ? 'private' : 'site'" :size="16" />
          </button>
          <Icon v-else :name="state.private ? 'private' : 'search'" :size="16" />
          <input
            ref="address"
            v-model="draft"
            aria-label="地址和搜索栏"
            placeholder="搜索或输入网址"
            autocomplete="off"
            spellcheck="false"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="suggestionsOpen"
            aria-controls="address-choices"
            :aria-activedescendant="
              suggestionsOpen && selectedSuggestion >= 0 ? `address-choice-${selectedSuggestion}` : undefined
            "
            @focus="focusAddressInput"
            @input="addressInput"
            @blur="blurAddress"
            @compositionstart="composing = true"
            @compositionend="composing = false"
            @keydown="addressKey"
          />
          <span v-if="active?.zoom && Math.abs(active.zoom - 1) > 0.02" class="zoom-label"
            >{{ Math.round(active.zoom * 100) }}%</span
          >
          <button
            type="button"
            class="icon-button bookmark-button"
            :class="{ bookmarked }"
            :disabled="active?.kind !== 'web' || !active.url.startsWith('http')"
            :title="bookmarked ? '移除书签' : '添加书签 (Ctrl+D)'"
            aria-label="切换书签"
            @click="dispatch({ action: 'bookmark' })"
          >
            <Icon name="star" :size="17" />
          </button>
        </form>
        <button
          class="icon-button"
          title="下载 (Ctrl+J)"
          aria-label="下载"
          @click="dispatch({ action: 'new-tab', value: 'downloads' })"
        >
          <Icon name="download" /><span
            v-if="state.downloads.some((d) => d.status === 'progressing')"
            class="notification-dot"
          ></span>
        </button>
        <button
          class="icon-button"
          title="设置及更多"
          aria-label="设置及更多"
          @click="dispatch({ action: 'menu' })"
        >
          <Icon name="menu" />
        </button>
      </div>
      <div
        v-if="suggestionsOpen"
        id="address-choices"
        role="listbox"
        aria-label="地址建议"
        :class="state.nativeSuggestions ? 'sr-only' : 'address-choices'"
        @mousedown.prevent
      >
        <button
          v-for="(choice, index) in choices"
          :id="`address-choice-${index}`"
          :key="choice.kind + choice.url"
          type="button"
          role="option"
          :aria-selected="selectedSuggestion === index"
          :class="{ chosen: selectedSuggestion === index }"
          tabindex="-1"
          @click="acceptSuggestion(choice)"
        >
          <Icon
            :name="
              choice.kind === 'bookmark'
                ? 'star'
                : choice.kind === 'history'
                  ? 'history'
                  : choice.kind === 'input'
                    ? 'search'
                    : 'globe'
            "
            :size="16"
          />
          <span
            ><strong>{{ choice.title }}</strong
            ><small>{{ choice.url }}</small></span
          ><small>{{ choiceLabel(choice) }}</small>
        </button>
      </div>
      <div v-if="state.preferences.bookmarksBar" class="bookmarks-bar">
        <button
          class="bookmark-item bookmark-manager"
          title="管理书签 (Ctrl+Shift+O)"
          @click="dispatch({ action: 'new-tab', value: 'bookmarks' })"
        >
          <Icon name="folder" :size="14" /><span>书签</span></button
        ><span class="bookmark-divider"></span>
        <button
          v-for="folder in state.bookmarkFolders.filter((f) => !f.parentId).slice(0, 8)"
          :key="folder.id"
          class="bookmark-item"
          :title="folder.title"
          @click="dispatch({ action: 'folder-menu', id: folder.id })"
        >
          <Icon name="folder" :size="13" /><span>{{ folder.title }}</span>
        </button>
        <button
          v-for="bookmark in state.bookmarks.filter((b) => !b.folderId).slice(0, 15)"
          :key="bookmark.id"
          class="bookmark-item"
          :title="bookmark.url"
          @click="open(bookmark.url, $event)"
        >
          <Icon name="globe" :size="13" /><span>{{ bookmark.title }}</span>
        </button>
        <span v-if="!state.bookmarks.length && !state.bookmarkFolders.length" class="bookmark-hint"
          >在喜欢的网页按 Ctrl+D，添加到这里。</span
        >
        <button
          class="bookmark-item history-entry"
          @click="dispatch({ action: 'new-tab', value: 'history' })"
        >
          <Icon name="history" :size="14" /><span>历史记录</span>
        </button>
      </div>
      <div
        v-if="active?.popupStatus && (active.popupStatus.blocked || active.popupStatus.allowed)"
        class="page-controls popup-controls"
        role="status"
      >
        <Icon name="warning" :size="16" />
        <span>{{
          active.popupStatus.allowed
            ? '本页允许更多弹出窗口，仍有窗口数量限制。'
            : `已拦截 ${active.popupStatus.blocked} 次弹出窗口。允许后请重试网页操作。`
        }}</span>
        <button
          class="text-action"
          @click="dispatch({ action: 'popup-policy', id: active.id, value: !active.popupStatus.allowed })"
        >
          {{ active.popupStatus.allowed ? '恢复弹窗限制' : '允许本页弹窗' }}
        </button>
      </div>
      <div
        v-if="active?.dialogStatus && (active.dialogStatus.blocked || active.dialogStatus.muted)"
        class="page-controls dialog-controls"
        role="status"
      >
        <Icon name="warning" :size="16" />
        <span>{{
          active.dialogStatus.muted
            ? '已暂停本页的网页对话框。'
            : `已阻止 ${active.dialogStatus.blocked} 次网页对话框。`
        }}</span>
        <button
          class="text-action"
          @click="dispatch({ action: 'dialog-policy', id: active.id, value: !active.dialogStatus.muted })"
        >
          {{ active.dialogStatus.muted ? '恢复本页对话框' : '暂停本页对话框' }}
        </button>
      </div>
    </header>
    <div class="content-frame">
      <main
        ref="viewport"
        class="viewport"
        :class="{ 'web-surface': active?.kind === 'web' && !isError, 'overview-surface': !!state.overview }"
      >
        <TabOverview
          v-if="state.overview"
          ref="overviewPanel"
          :key="state.overview"
          :state="state"
          :run="dispatch"
        />
        <div class="page-layer" :inert="!!state.overview" :aria-hidden="state.overview ? 'true' : undefined">
          <NewTabPage
            v-if="active?.kind === 'newtab'"
            v-model:draft="draft"
            v-model:composing="composing"
            :state="state"
            @command="dispatch"
            @navigate="navigate"
          />
          <SettingsPage
            v-else-if="active?.kind === 'settings'"
            :key="active.id"
            :state="state"
            :origin="active.settingsOrigin"
            :section="active.settingsSection"
            @command="dispatch"
            @navigate="navigate"
          />
          <DownloadsPage
            v-else-if="active?.kind === 'downloads'"
            :state="state"
            @command="dispatch"
            @navigate="navigate"
          />
          <HistoryPage
            v-else-if="active?.kind === 'history'"
            :state="state"
            @command="dispatch"
            @navigate="navigate"
          />
          <BookmarksPage
            v-else-if="active?.kind === 'bookmarks'"
            :key="active.id"
            :state="state"
            :run="dispatch"
          />
          <section v-else-if="isError" class="error-page">
            <Icon name="warning" :size="40" />
            <h1>{{ active?.crashed ? '这个标签页意外停止了' : '暂时无法打开这个页面' }}</h1>
            <p>{{ active?.crashed ? '重新加载后继续浏览，其它标签页不受影响。' : active?.error }}</p>
            <small>{{ active?.pendingUrl || active?.url }}</small
            ><button class="primary-button" @click="navigate(active?.pendingUrl || active?.url)">
              重新尝试
            </button>
          </section>
        </div>
      </main>
    </div>
    <div v-if="message" class="toast" role="status">{{ message }}</div>
  </div>
  <div v-else class="boot-page">
    <strong>EChromium</strong>
    <p>{{ message || '正在启动…' }}</p>
  </div>
</template>
