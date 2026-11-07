<script setup lang="ts">
import Icon from '../Icon.vue'
import type { BrowserState, BrowserRequest } from '../../shared/model'
defineProps<{ state: BrowserState }>()
const emit = defineEmits<{ command: [request: BrowserRequest]; navigate: [url: string] }>()
const dispatch = (request: BrowserRequest) => emit('command', request)
</script>
<template>
  <section class="internal-page list-page">
    <header class="page-heading">
      <h1>下载</h1>
      <p>
        {{ state.private ? '此隐私会话的下载记录将在关闭后清除。' : '下载记录会保留，方便稍后找到文件。' }}
      </p>
      <button
        v-if="state.downloads.some((d) => !d.active)"
        class="secondary-button"
        @click="dispatch({ action: 'clear-downloads' })"
      >
        清除已结束的记录
      </button>
    </header>
    <div v-if="!state.downloads.length" class="empty-page">
      <Icon name="download" :size="38" />
      <h2>下载的文件会显示在这里</h2>
      <p>从网页下载文件后，可在这里查看进度和打开文件所在位置。</p>
    </div>
    <article v-for="item in state.downloads" :key="item.id" class="download-item">
      <Icon name="folder" :size="24" />
      <div>
        <h3>{{ item.name }}</h3>
        <p>
          {{
            {
              progressing: '正在下载',
              paused: '已暂停',
              completed: '下载完成',
              cancelled: '已取消',
              interrupted: '下载中断',
            }[item.status]
          }}
          · {{ (item.received / 1048576).toFixed(1) }} MB<span v-if="item.total">
            / {{ (item.total / 1048576).toFixed(1) }} MB</span
          >
        </p>
        <progress
          v-if="['progressing', 'paused'].includes(item.status)"
          :value="item.total ? item.received : undefined"
          :max="item.total || 1"
        ></progress
        ><small>{{ item.url }}</small>
      </div>
      <button
        v-if="item.status === 'progressing'"
        class="secondary-button"
        @click="dispatch({ action: 'download', id: item.id, value: 'pause' })"
      >
        暂停</button
      ><button
        v-if="item.canResume && (item.status === 'paused' || item.status === 'interrupted')"
        class="secondary-button"
        @click="dispatch({ action: 'download', id: item.id, value: 'resume' })"
      >
        继续</button
      ><button
        v-if="item.active"
        class="icon-button"
        aria-label="取消下载"
        @click="dispatch({ action: 'download', id: item.id, value: 'cancel' })"
      >
        <Icon name="close" /></button
      ><button
        v-if="item.status === 'completed'"
        class="secondary-button"
        @click="dispatch({ action: 'download', id: item.id, value: 'reveal' })"
      >
        在文件夹中显示
      </button>
      <button
        v-if="!item.active"
        class="icon-button"
        aria-label="移除下载记录"
        title="移除记录，保留文件"
        @click="dispatch({ action: 'download', id: item.id, value: 'remove' })"
      >
        <Icon name="close" />
      </button>
    </article>
    <p v-if="state.downloads.length" class="small-note">
      移除记录不会删除文件。重启前未完成的任务会标记为中断，请回原网页重新下载。
    </p>
  </section>
</template>
