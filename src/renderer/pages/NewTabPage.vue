<script setup lang="ts">
import Icon from '../Icon.vue'
import type { BrowserState, BrowserRequest } from '../../shared/model'
defineProps<{ state: BrowserState }>()
const emit = defineEmits<{ command: [request: BrowserRequest]; navigate: [url: string] }>()
const dispatch = (request: BrowserRequest) => emit('command', request)

const open = (url: string, event?: MouseEvent) => {
  if (event?.ctrlKey || event?.metaKey) dispatch({ action: 'new-tab', url })
  else emit('navigate', url)
}
const draft = defineModel<string>('draft', { required: true })
const composing = defineModel<boolean>('composing', { required: true })
const navigate = () => {
  if (!composing.value && draft.value.trim()) emit('navigate', draft.value)
}
const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(
  new Date(),
)
const shortcuts = [
  { name: '必应', url: 'https://www.bing.com', letter: 'b' },
  { name: '百度', url: 'https://www.baidu.com', letter: '百' },
  { name: 'GitHub', url: 'https://github.com', letter: 'G' },
  { name: 'MDN', url: 'https://developer.mozilla.org/zh-CN/', letter: 'M' },
]
</script>
<template>
  <section class="new-tab-page">
    <div class="new-tab-topline">
      <span>{{ date }}</span
      ><span v-if="state.private"><Icon name="private" :size="15" /> 隐私浏览</span
      ><span v-else class="quiet-wordmark">EChromium</span>
    </div>
    <div class="start-content">
      <div class="start-symbol" aria-hidden="true">e<span></span></div>
      <h1>{{ state.private ? '留一点私人空间。' : '打开下一页。' }}</h1>
      <p class="start-subtitle">
        {{
          state.private
            ? '关闭所有隐私窗口后，将清除本次临时浏览会话。'
            : '从一个问题，一个想法，或一个网址开始。'
        }}
      </p>
      <form class="start-search" @submit.prevent="navigate()">
        <Icon name="search" :size="21" /><input
          v-model="draft"
          aria-label="新标签页搜索"
          :placeholder="`使用${{ bing: '必应', baidu: '百度', google: 'Google' }[state.preferences.search]}搜索，或输入网址`"
          @compositionstart="composing = true"
          @compositionend="composing = false"
        /><button aria-label="搜索或访问" type="submit"><Icon name="arrow" :size="20" /></button>
      </form>
      <div class="shortcut-list">
        <button v-for="site in shortcuts" :key="site.url" @click="open(site.url)">
          <span class="site-letter">{{ site.letter }}</span
          ><span>{{ site.name }}</span>
        </button>
      </div>
      <div v-if="!state.private && state.history.length" class="recent-section">
        <div class="section-heading">
          <span>继续浏览</span
          ><button @click="dispatch({ action: 'new-tab', value: 'history' })">查看历史记录</button>
        </div>
        <button
          v-for="visit in state.history.slice(0, 3)"
          :key="visit.url"
          class="recent-item"
          @click="open(visit.url)"
        >
          <Icon name="history" :size="17" /><span
            ><strong>{{ visit.title }}</strong
            ><small>{{ visit.url }}</small></span
          ><Icon name="arrow" :size="15" />
        </button>
      </div>
      <p v-if="state.private" class="privacy-explanation">
        隐私浏览不会保存历史记录。下载的文件和主动添加的书签仍会保留；网站与网络服务提供商仍可能记录访问。
      </p>
    </div>
    <footer class="start-footer">
      <span>让浏览回归专注。</span
      ><button @click="dispatch({ action: 'new-tab', value: 'settings' })">
        <Icon name="settings" :size="15" /> 自定义外观
      </button>
    </footer>
  </section>
</template>
