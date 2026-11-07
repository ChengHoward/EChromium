<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SiteDataSummary } from '../../shared/model'
const props = defineProps<{ origin: string; tabId: string; privateMode: boolean }>()
const summary = ref<SiteDataSummary>(),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
let generation = 0
async function load(action: 'inspect' | 'clear') {
  const current = ++generation
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await window.browser.siteData({ action, id: props.tabId })
    if (current !== generation || result.origin !== props.origin) return
    summary.value = result
    if (result.cancelled) notice.value = '已取消，未清除数据。'
    else if (result.cleared)
      notice.value = result.cookieCount
        ? '已执行清除，仍有 Cookie 存在。网站可能正在重新写入，请刷新检查。'
        : '网站数据已清除。重新加载网页后再查看登录状态。'
  } catch (cause) {
    if (current === generation) error.value = String(cause).replace(/^Error:.*?Error: /, '')
  } finally {
    if (current === generation) busy.value = false
  }
}
watch(
  () => [props.origin, props.tabId],
  () => {
    summary.value = undefined
    void load('inspect')
  },
  { immediate: true },
)
</script>
<template>
  <div class="site-data-panel">
    <div class="setting-line">
      <div>
        <strong>Cookie 与网站数据</strong>
        <p>{{ privateMode ? '只管理此隐私会话的数据。' : '只管理当前浏览资料中的数据。' }}</p>
        <p v-if="summary">
          此主机可使用 {{ summary.cookieCount }} 个 Cookie。存储用量可在<a href="#site-data">网站数据总览</a
          >中查看。
        </p>
        <p v-else-if="busy">正在读取…</p>
      </div>
      <div class="site-data-actions">
        <button class="secondary-button" :disabled="busy" @click="load('inspect')">刷新数据</button
        ><button class="secondary-button" :disabled="busy || !summary" @click="load('clear')">
          清除网站数据
        </button>
      </div>
    </div>
    <p class="small-note">
      网页存储按 {{ origin }} 清除。Cookie
      可跨端口或由同域子站共享，清除后这些站点也可能退出登录。网站仍打开时可能重新写入数据。
    </p>
    <p v-if="notice" role="status" class="small-note">{{ notice }}</p>
    <p v-if="error" role="alert" class="site-data-error">{{ error }}</p>
    <details v-if="summary?.cookies.length">
      <summary>查看 Cookie 信息（不显示内容值）</summary>
      <article v-for="(cookie, index) in summary.cookies" :key="index" class="cookie-row">
        <strong>{{ cookie.name }}</strong
        ><small
          >{{ cookie.domain }} · {{ cookie.path }} · {{ cookie.session ? '会话 Cookie' : '持久 Cookie'
          }}{{ cookie.httpOnly ? ' · HttpOnly' : '' }}{{ cookie.secure ? ' · 安全传输' : '' }}</small
        >
      </article>
      <p v-if="summary.cookieCount > summary.cookies.length" class="small-note">
        仅显示前 200 条，清除会处理此主机适用的全部 Cookie。
      </p>
    </details>
  </div>
</template>
