<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { dataRanges, type DataOptions, type DataSummary } from '../../shared/browsing-data'
const props = defineProps<{ tabId: string; privateMode: boolean }>()
const options = ref<DataOptions>({
  range: 'hour',
  history: !props.privateMode,
  downloads: props.privateMode,
  siteData: false,
  cache: false,
})
const busy = ref(false),
  message = ref(''),
  preview = ref<DataSummary>()
const selected = computed(
  () => options.value.history || options.value.downloads || options.value.siteData || options.value.cache,
)
let revision = 0
watch(
  () => options.value.range,
  (range) => {
    if (range !== 'all') {
      options.value.siteData = false
      options.value.cache = false
    }
  },
)
async function inspect() {
  const current = ++revision
  preview.value = undefined
  if (!selected.value || busy.value) return
  try {
    const value = await window.browser.browsingData({
      action: 'preview',
      id: props.tabId,
      options: { ...options.value },
    })
    if (current === revision) preview.value = value
  } catch (error) {
    if (current === revision) message.value = String(error)
  }
}
watch(() => JSON.stringify([props.tabId, options.value]), inspect, { immediate: true })
async function clear() {
  if (busy.value || !selected.value) return
  busy.value = true
  revision++
  message.value = ''
  try {
    const result = await window.browser.browsingData({
      action: 'clear',
      id: props.tabId,
      options: { ...options.value },
    })
    message.value = result.cancelled
      ? '已取消，保留原有数据。'
      : `已清除${result.history}条历史记录、${result.downloads}条下载记录${options.value.siteData ? '，以及 Cookie 和网站存储' : ''}${options.value.cache ? '，以及网页缓存' : ''}。`
  } catch (error) {
    message.value = String(error).replace(/^Error: /, '')
  } finally {
    busy.value = false
    void inspect()
  }
}
</script>
<template>
  <div class="browsing-data-panel">
    <p class="small-note">
      {{
        privateMode ? '仅影响此隐私会话。隐私浏览不保存访问历史。' : '影响所有普通窗口中的此类数据。'
      }}书签、网站权限、已下载文件和进行中的下载会保留。
    </p>
    <fieldset :disabled="busy" class="data-options">
      <label class="setting-line"
        ><strong>时间范围</strong
        ><select v-model="options.range" aria-label="清除数据的时间范围">
          <option v-for="(label, key) in dataRanges" :key="key" :value="key">{{ label }}</option>
        </select></label
      >
      <label class="setting-line"
        ><div>
          <strong>浏览历史</strong>
          <p>移除此期间最近访问过的网址记录。</p>
        </div>
        <input v-model="options.history" type="checkbox" :disabled="privateMode"
      /></label>
      <label class="setting-line"
        ><div>
          <strong>下载记录</strong>
          <p>仅移除已结束的记录，保留文件及进行中的任务。</p>
        </div>
        <input v-model="options.downloads" type="checkbox"
      /></label>
      <label class="setting-line"
        ><div>
          <strong>Cookie 和网站存储</strong>
          <p>所有网站可能退出登录。请选择“全部时间”。</p>
        </div>
        <input v-model="options.siteData" type="checkbox" :disabled="options.range !== 'all'"
      /></label>
      <label class="setting-line"
        ><div>
          <strong>网页缓存</strong>
          <p>下次访问可能需要重新下载。请选择“全部时间”。</p>
        </div>
        <input v-model="options.cache" type="checkbox" :disabled="options.range !== 'all'"
      /></label>
    </fieldset>
    <p class="small-note">
      Cookie、网站存储和缓存暂时只支持全部清除。仍打开的网站可能重新写入数据；嵌入页面的会话存储请关闭网页后重新打开。
    </p>
    <p v-if="preview" class="data-preview">
      本次包括 {{ preview.history }} 条历史记录、{{ preview.downloads }} 条已结束下载记录。
    </p>
    <button class="secondary-button clear-browsing-data" :disabled="busy || !selected" @click="clear">
      {{ busy ? '正在处理…' : '清除所选数据…' }}
    </button>
    <p v-if="message" role="status" class="small-note data-result">{{ message }}</p>
  </div>
</template>
