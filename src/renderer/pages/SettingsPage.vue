<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'
import SiteDataPanel from './SiteDataPanel.vue'
import BrowsingDataPanel from './BrowsingDataPanel.vue'
import SiteDataOverview from './SiteDataOverview.vue'
import type { BrowserState, BrowserRequest, Preferences, ThemeId } from '../../shared/model'
import { themes, palette, transparencyLimits, themeDepthLimits } from '../../shared/appearance'
import { capabilityNames } from '../../shared/site-policy'
import type { SiteRule, SiteCapability } from '../../shared/model'
const props = defineProps<{ state: BrowserState; origin?: string; section?: string }>()
const focusedOrigin = ref(''),
  permissionSection = ref<HTMLElement>()
const privacySection = ref<HTMLElement>()
const content = ref<HTMLElement>(),
  activeSection = ref('appearance')
const sections = [
  { id: 'appearance', label: '外观', icon: 'sun' },
  { id: 'browsing', label: '浏览', icon: 'globe' },
  { id: 'privacy', label: '隐私与数据', icon: 'private' },
  { id: 'site-data', label: '网站数据', icon: 'folder' },
  { id: 'permissions', label: '网站权限', icon: 'site' },
  { id: 'about', label: '关于', icon: 'monitor' },
]
let sectionFrame = 0
function syncSection() {
  cancelAnimationFrame(sectionFrame)
  sectionFrame = requestAnimationFrame(() => {
    const root = content.value
    if (!root) return
    if (root.scrollTop > 0 && root.scrollHeight - root.scrollTop - root.clientHeight < 2) {
      activeSection.value = 'about'
      return
    }
    const top = root.getBoundingClientRect().top + 72
    const visible = [...root.querySelectorAll<HTMLElement>(':scope > section[id]')]
    activeSection.value =
      visible.filter((section) => section.getBoundingClientRect().top <= top).at(-1)?.id || 'appearance'
  })
}
onMounted(syncSection)
onBeforeUnmount(() => cancelAnimationFrame(sectionFrame))
const transparency = ref(props.state.preferences.transparency)
const themeDepth = ref(props.state.preferences.themeDepth)
const themePreviews = computed(() =>
  Object.fromEntries(
    Object.keys(themes).map((theme) => [
      theme,
      palette({ ...props.state.preferences, theme: theme as ThemeId }, props.state.dark).colors,
    ]),
  ),
)
watch(
  () => props.state.preferences.themeDepth,
  (value) => {
    themeDepth.value = value
  },
)
watch(
  () => props.state.preferences.transparency,
  (value) => {
    transparency.value = value
  },
)
watch(
  () => props.section,
  async (section) => {
    if (section === 'privacy') {
      await nextTick()
      privacySection.value?.scrollIntoView({ block: 'start' })
    }
  },
  { immediate: true },
)
type EditableRule = Omit<SiteRule, 'decision'> & { decision: SiteRule['decision'] | 'ask' }
const visibleRules = computed<EditableRule[]>(() =>
  focusedOrigin.value
    ? (Object.keys(capabilityNames) as SiteCapability[]).map((capability) => ({
        origin: focusedOrigin.value,
        capability,
        decision:
          props.state.permissions.find((r) => r.origin === focusedOrigin.value && r.capability === capability)
            ?.decision || 'ask',
      }))
    : props.state.permissions,
)
watch(
  () => props.origin,
  async (origin) => {
    focusedOrigin.value = origin || ''
    if (origin) {
      await nextTick()
      permissionSection.value?.scrollIntoView({ block: 'start' })
    }
  },
  { immediate: true },
)
const emit = defineEmits<{ command: [request: BrowserRequest]; navigate: [url: string] }>()
const dispatch = (request: BrowserRequest) => emit('command', request)
const patch = (value: Partial<Preferences>) => dispatch({ action: 'preferences', value })
const modes = [
  { id: 'auto', label: '跟随系统', icon: 'monitor', detail: '随系统自动切换' },
  { id: 'light', label: '浅色', icon: 'sun', detail: '清亮、柔和的界面' },
  { id: 'dark', label: '深色', icon: 'moon', detail: '适合昏暗的环境' },
] as const
const changeRule = (rule: EditableRule, event: Event) =>
  dispatch({
    action: 'site-permission',
    value: { ...rule, decision: (event.target as HTMLSelectElement).value },
  })
</script>
<template>
  <section class="internal-page settings-page">
    <aside class="settings-nav">
      <h2>设置</h2>
      <nav aria-label="设置分类">
        <a
          v-for="section in sections"
          :key="section.id"
          :href="`#${section.id}`"
          :class="{ active: activeSection === section.id }"
          :aria-current="activeSection === section.id ? 'location' : undefined"
        >
          <Icon :name="section.icon" :size="17" />{{ section.label }}
        </a>
      </nav>
    </aside>
    <div ref="content" class="settings-content" @scroll.passive="syncSection">
      <header class="page-heading">
        <h1>让浏览器适合你</h1>
        <p>选择熟悉的色彩，保留自己的习惯。</p>
      </header>
      <section id="appearance" class="settings-section">
        <h2>外观</h2>
        <div class="setting-line">
          <div>
            <strong>色彩主题</strong>
            <p>窗口框架、标签和浏览器页面的配色。</p>
          </div>
        </div>
        <div class="theme-grid" role="group" aria-label="色彩主题">
          <button
            v-for="(theme, id) in themes"
            :key="id"
            :class="{ chosen: state.preferences.theme === id }"
            :aria-pressed="state.preferences.theme === id"
            @click="patch({ theme: id as ThemeId })"
          >
            <span
              class="theme-preview"
              :style="{
                '--preview-shell': themePreviews[id].shell,
                '--preview-page': themePreviews[id].surface,
                '--preview-header': themePreviews[id]['bar-surface'],
                '--preview-stroke': themePreviews[id].stroke,
                '--preview-accent': themePreviews[id].accent,
              }"
              aria-hidden="true"
              ><span class="theme-preview-tab"></span
              ><span class="theme-preview-page">
                <span class="theme-preview-sidebar"></span><span class="theme-preview-lines"></span> </span
            ></span>
            <span class="theme-caption"
              ><strong>{{ theme.name }}</strong>
              <Icon v-if="state.preferences.theme === id" name="check" :size="15" />
              <span v-else class="theme-swatch" :style="{ background: themePreviews[id].accent }"></span>
            </span>
          </button>
        </div>
        <div class="setting-line theme-depth-setting">
          <div>
            <strong><label for="theme-depth">主题色深浅</label></strong>
            <p id="theme-depth-description">让当前配色更浅或更深。松开滑块后生效，适用于浅色和深色模式。</p>
            <button
              class="text-action"
              :disabled="themeDepth === themeDepthLimits.default"
              @click="patch({ themeDepth: themeDepthLimits.default })"
            >
              恢复默认深浅
            </button>
          </div>
          <div class="appearance-range-control">
            <div class="appearance-range-scale">
              <span>浅</span><output for="theme-depth">{{ themeDepth }}%</output><span>深</span>
            </div>
            <input
              id="theme-depth"
              v-model.number="themeDepth"
              type="range"
              :min="themeDepthLimits.min"
              :max="themeDepthLimits.max"
              step="1"
              :aria-valuetext="`${themeDepth}%，${themeDepth === themeDepthLimits.default ? '默认深浅' : themeDepth < themeDepthLimits.default ? '较浅' : '较深'}`"
              aria-describedby="theme-depth-description"
              @change="patch({ themeDepth })"
            />
          </div>
        </div>
        <div class="setting-line mode-heading">
          <div>
            <strong>明暗模式</strong>
            <p>跟随系统时自动切换浅色与深色。仅调整浏览器界面。</p>
          </div>
        </div>
        <div class="mode-grid" role="group" aria-label="明暗模式">
          <button
            v-for="mode in modes"
            :key="mode.id"
            :data-mode="mode.id"
            :class="{ chosen: state.preferences.mode === mode.id }"
            :aria-pressed="state.preferences.mode === mode.id"
            @click="patch({ mode: mode.id })"
          >
            <Icon :name="mode.icon" :size="22" />
            <strong>{{ mode.label }}</strong>
            <small>{{ mode.detail }}</small>
            <Icon v-if="state.preferences.mode === mode.id" class="mode-check" name="check" :size="14" />
          </button>
        </div>
        <label class="setting-line"
          ><div>
            <strong>半透明窗口材质</strong>
            <p>标题栏透出模糊背景，标签、地址栏与书签栏保留更柔和的透色。网页内容保持清晰。</p>
            <p v-if="state.preferences.acrylic && state.material === 'solid'">当前系统使用实色外观。</p>
          </div>
          <input
            type="checkbox"
            :checked="state.preferences.acrylic"
            @change="patch({ acrylic: ($event.target as HTMLInputElement).checked })"
        /></label>
        <div class="setting-line transparency-setting">
          <div>
            <strong><label for="window-transparency">窗口透明度</label></strong>
            <p id="transparency-description">
              范围 {{ transparencyLimits.min }}%–{{
                transparencyLimits.max
              }}%，保持文字清晰。松开滑块后生效，网页内容不受影响。
            </p>
          </div>
          <div class="appearance-range-control">
            <div class="appearance-range-scale">
              <span>较实</span><output for="window-transparency">{{ transparency }}%</output><span>较透</span>
            </div>
            <input
              id="window-transparency"
              v-model.number="transparency"
              type="range"
              :min="transparencyLimits.min"
              :max="transparencyLimits.max"
              step="1"
              :disabled="!state.preferences.acrylic || state.material !== 'acrylic'"
              :aria-valuetext="`${transparency}%`"
              aria-describedby="transparency-description"
              @change="patch({ transparency })"
            />
          </div>
        </div>
        <label class="setting-line"
          ><div>
            <strong>显示书签栏</strong>
            <p>在地址栏下方快速访问收藏的网站。</p>
          </div>
          <input
            type="checkbox"
            :checked="state.preferences.bookmarksBar"
            @change="patch({ bookmarksBar: ($event.target as HTMLInputElement).checked })"
        /></label>
      </section>
      <section id="browsing" class="settings-section">
        <h2>浏览</h2>
        <div class="setting-line">
          <div>
            <strong>默认搜索引擎</strong>
            <p>用于地址栏和新标签页搜索。</p>
          </div>
          <select
            :value="state.preferences.search"
            aria-label="默认搜索引擎"
            @change="patch({ search: ($event.target as HTMLSelectElement).value as Preferences['search'] })"
          >
            <option value="bing">必应</option>
            <option value="baidu">百度</option>
            <option value="google">Google</option>
          </select>
        </div>
        <label class="setting-line"
          ><div>
            <strong>启动时恢复网页</strong>
            <p>恢复普通窗口的位置、标签顺序和选中项；其它网页标签在选中时加载。隐私窗口不保存。</p>
          </div>
          <input
            type="checkbox"
            :checked="state.preferences.restore"
            @change="patch({ restore: ($event.target as HTMLInputElement).checked })"
        /></label>
        <div class="setting-line">
          <div>
            <strong>隐私窗口</strong>
            <p>使用独立的临时 Cookie 和网页存储。</p>
          </div>
          <button class="secondary-button" @click="dispatch({ action: 'new-window', private: true })">
            打开隐私窗口
          </button>
        </div>
      </section>
      <section id="privacy" ref="privacySection" class="settings-section">
        <h2>清除浏览数据{{ state.private ? ' · 隐私会话' : '' }}</h2>
        <BrowsingDataPanel :tab-id="state.activeId" :private-mode="state.private" />
      </section>
      <section id="site-data" class="settings-section">
        <h2>网站数据{{ state.private ? ' · 隐私会话' : '' }}</h2>
        <SiteDataOverview :tab-id="state.activeId" :private-mode="state.private" />
      </section>
      <section id="permissions" ref="permissionSection" class="settings-section">
        <h2>网站权限{{ state.private ? ' · 隐私会话' : '' }}</h2>
        <div v-if="focusedOrigin" class="focused-site">
          <strong>{{ focusedOrigin }}</strong
          ><button class="text-action" @click="focusedOrigin = ''">查看全部网站</button>
        </div>
        <p class="small-note">
          网站首次请求使用摄像头、麦克风、位置或通知时会询问你。权限按完整来源区分，跨来源嵌入请求暂不允许。
        </p>
        <p v-if="state.private" class="small-note">
          这里的选择只用于此隐私会话，关闭最后一个关联窗口后清除。
        </p>
        <p v-if="!visibleRules.length" class="permission-empty">
          尚未保存网站权限。网站发起请求后，可选择允许本页、始终允许或始终阻止。
        </p>
        <div
          v-for="rule in visibleRules"
          :key="rule.origin + rule.capability"
          class="setting-line permission-line"
        >
          <div>
            <strong>{{ focusedOrigin ? capabilityNames[rule.capability] : rule.origin }}</strong>
            <p v-if="!focusedOrigin">{{ capabilityNames[rule.capability] }}</p>
          </div>
          <select
            :value="rule.decision"
            :aria-label="rule.origin + ' ' + capabilityNames[rule.capability]"
            @change="changeRule(rule, $event)"
          >
            <option value="ask">每次询问</option>
            <option value="allow">允许</option>
            <option value="block">阻止</option>
          </select>
        </div>
        <p class="small-note">
          更改用于后续请求。若网站已在使用设备，请关闭或重新加载该网页来停止本次使用。系统的隐私设置仍可能阻止访问。
        </p>
      </section>
      <section v-if="focusedOrigin" class="settings-section">
        <h2>网站数据</h2>
        <SiteDataPanel
          :key="focusedOrigin"
          :origin="focusedOrigin"
          :tab-id="state.activeId"
          :private-mode="state.private"
        />
      </section>
      <section id="about" class="settings-section about-section">
        <div class="about-logo">e</div>
        <h2>EChromium</h2>
        <p>一个正在成长的桌面浏览器。</p>
        <dl>
          <div>
            <dt>应用版本</dt>
            <dd>0.1.0</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{{ state.runtime.electron }}</dd>
          </div>
          <div>
            <dt>Chromium</dt>
            <dd>{{ state.runtime.chrome }}</dd>
          </div>
        </dl>
        <p class="small-note">开发预览版。当前已接通基础浏览，更多功能将按规划逐步加入。</p>
      </section>
    </div>
  </section>
</template>
