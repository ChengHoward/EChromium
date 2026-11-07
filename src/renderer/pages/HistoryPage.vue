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
</script>
<template>
  <section class="internal-page list-page">
    <header class="page-heading">
      <h1>历史记录</h1>
      <p>回到你看过的页面。</p>
      <button v-if="state.history.length" class="secondary-button" @click="dispatch({ action: 'open-data' })">
        清除浏览数据…
      </button>
    </header>
    <div v-if="!state.history.length" class="empty-page">
      <Icon name="history" :size="38" />
      <h2>{{ state.private ? '隐私浏览不记录访问历史' : '还没有浏览记录' }}</h2>
      <p>普通窗口中访问过的网页会显示在这里。</p>
    </div>
    <button v-for="visit in state.history" :key="visit.url" class="history-item" @click="open(visit.url)">
      <time>{{
        new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(visit.at)
      }}</time
      ><Icon name="globe" :size="17" /><span
        ><strong>{{ visit.title }}</strong
        ><small>{{ visit.url }}</small></span
      ><Icon name="arrow" :size="16" />
    </button>
  </section>
</template>
