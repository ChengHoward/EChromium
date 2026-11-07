<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import {
  formatStorage,
  storageTypeNames,
  type SiteInventory,
  type SiteDataRow,
} from '../../shared/site-inventory'
const props = defineProps<{ tabId: string; privateMode: boolean }>()
const inventory = ref<SiteInventory>(),
  query = ref(''),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
let generation = 0
async function load(offset = 0) {
  if (busy.value) return
  const current = ++generation
  busy.value = true
  error.value = ''
  try {
    const result = await window.browser.siteInventory({
      action: 'list',
      id: props.tabId,
      query: query.value,
      offset,
    })
    if (current === generation) inventory.value = result.inventory
  } catch (cause) {
    if (current === generation) error.value = String(cause).replace(/^Error:.*?Error: /, '')
  } finally {
    if (current === generation) busy.value = false
  }
}
async function clear(row: SiteDataRow) {
  if (busy.value || !inventory.value) return
  const current = ++generation
  busy.value = true
  error.value = ''
  notice.value = ''
  let refresh = false
  try {
    const result = await window.browser.siteInventory({
      action: 'clear',
      id: props.tabId,
      version: inventory.value.version,
      rowId: row.id,
    })
    if (current !== generation) return
    notice.value = result.cancelled
      ? '已取消，保留网站数据。'
      : `${row.origin || row.hostname} 的${row.origin ? '网站数据' : ' Cookie'}已清除。网站仍打开时可能重新写入。`
    refresh = !!result.cleared
  } catch (cause) {
    if (current === generation) error.value = String(cause).replace(/^Error:.*?Error: /, '')
  } finally {
    if (current === generation) {
      busy.value = false
      if (refresh) void load(inventory.value?.offset || 0)
    }
  }
}
onBeforeUnmount(() => generation++)
</script>
<template>
  <div class="site-data-overview" :aria-busy="busy">
    <p class="small-note">
      {{ privateMode ? '仅查看此隐私会话。' : '查看当前普通资料。' }}列表结合已知网站与 Cookie
      所属域，不代表所有存储来源。读取时不会打开或访问这些网站。
    </p>
    <form class="site-overview-tools" @submit.prevent="load()">
      <input
        v-model="query"
        type="search"
        class="site-overview-search"
        aria-label="搜索网站数据"
        placeholder="搜索网址或域名"
        maxlength="200"
        :disabled="busy"
      />
      <button type="submit" class="secondary-button" :disabled="busy">
        {{ busy ? '正在读取…' : inventory ? '刷新列表' : '查看网站数据' }}
      </button>
    </form>
    <p v-if="inventory" class="small-note site-overview-summary">
      找到 {{ inventory.total }} 项；此会话共 {{ inventory.cookieTotal }} 个 Cookie。用量统计时间
      {{ new Date(inventory.measuredAt).toLocaleTimeString('zh-CN') }}。
    </p>
    <p v-if="!inventory && !busy" class="small-note">点击“查看网站数据”读取最新列表。</p>
    <p v-if="inventory && !inventory.rows.length" class="small-note">
      没有匹配的已知网站。可调整搜索内容后刷新。
    </p>
    <article v-for="row in inventory?.rows" :key="row.id" class="site-overview-row" :data-site-id="row.id">
      <div class="site-overview-heading">
        <strong>{{ row.origin || row.hostname }}</strong
        ><button
          class="text-action"
          :disabled="busy"
          :aria-label="`清除 ${row.origin || row.hostname} 的${row.origin ? '网站数据' : ' Cookie'}`"
          @click="clear(row)"
        >
          {{ row.origin ? '清除网站数据…' : '清除 Cookie…' }}
        </button>
      </div>
      <p class="small-note">
        此主机关联 {{ row.cookieCount }} 个 Cookie<span v-if="row.origin">
          · 已计量存储：{{ row.storage ? formatStorage(row.storage.bytes) : '暂无法统计' }}</span
        ><span v-else> · 仅列出 Cookie 所属域，未推断网址或存储容量</span>
      </p>
      <details v-if="row.storage?.breakdown.some((item) => item.bytes > 0)">
        <summary>查看已计量存储</summary>
        <dl class="site-usage-details">
          <template v-for="item in row.storage.breakdown.filter((item) => item.bytes > 0)" :key="item.type"
            ><dt>{{ storageTypeNames[item.type] }}</dt>
            <dd>{{ formatStorage(item.bytes) }}</dd></template
          >
        </dl>
      </details>
    </article>
    <div v-if="inventory && inventory.total > inventory.limit" class="site-overview-paging">
      <button
        class="secondary-button"
        :disabled="busy || !inventory.offset"
        @click="load(inventory.offset - inventory.limit)"
      >
        上一页</button
      ><span
        >{{ Math.floor(inventory.offset / inventory.limit) + 1 }} /
        {{ Math.ceil(inventory.total / inventory.limit) }}</span
      ><button
        class="secondary-button"
        :disabled="busy || inventory.offset + inventory.limit >= inventory.total"
        @click="load(inventory.offset + inventory.limit)"
      >
        下一页
      </button>
    </div>
    <p v-if="inventory?.truncated" class="small-note">网站过多，本次只列出前 4000 项。</p>
    <p class="small-note">
      已计量存储包括数据库、离线缓存、服务工作线程和文件系统，不含
      Cookie、本地／会话存储或网页网络缓存。第三方分区存储暂未汇总。0 B 仅表示这些项目的用量为零。同域 Cookie
      可能被多行共用，不能将各行数量相加。清除前会确认影响范围，仍打开的网站可能重新写入数据。
    </p>
    <p v-if="notice" role="status" class="small-note site-overview-notice">{{ notice }}</p>
    <p v-if="error" role="alert" class="site-data-error">{{ error }}</p>
  </div>
</template>
