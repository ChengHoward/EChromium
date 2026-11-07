<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { folderPath } from '../../shared/bookmark-folders'
import { parseBookmarkHtml } from '../bookmark-html'
import Icon from '../Icon.vue'
import type { Bookmark, BookmarkFolder, BrowserRequest, BrowserState } from '../../shared/model'

const props = defineProps<{
  state: BrowserState
  run: (request: BrowserRequest) => Promise<BrowserState | undefined>
}>()
const query = ref(''),
  fileInput = ref<HTMLInputElement>(),
  busy = ref(false),
  notice = ref('')
const currentFolder = ref('')
const editor = ref<{ id?: string; title: string; url: string; folderId?: string } | null>(null)
const folderEditor = ref<{ id?: string; title: string; parentId?: string } | null>(null)
const folders = computed(() => props.state.bookmarkFolders)
const flatFolders = computed(() => {
  const result: { folder: BookmarkFolder; depth: number }[] = []
  const walk = (parentId: string | undefined, depth: number) => {
    if (depth > 12) return
    for (const folder of folders.value.filter((f) => f.parentId === parentId)) {
      result.push({ folder, depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(undefined, 0)
  return result
})
const pathOf = (id?: string) => {
  try {
    return folderPath(id, folders.value)
      .map((f) => f.title)
      .join(' / ')
  } catch {
    return ''
  }
}
const children = computed(() =>
  query.value.trim() ? [] : folders.value.filter((f) => (f.parentId || '') === currentFolder.value),
)
const siblings = computed(() =>
  props.state.bookmarks.filter((b) => (b.folderId || '') === currentFolder.value),
)
const parentOptions = computed(() =>
  flatFolders.value.filter(({ folder }) => {
    try {
      return !folderPath(folder.id, folders.value).some((f) => f.id === folderEditor.value?.id)
    } catch {
      return false
    }
  }),
)
watch(
  () => props.state.bookmarkFolders,
  () => {
    if (currentFolder.value && !folders.value.some((f) => f.id === currentFolder.value))
      currentFolder.value = ''
  },
)
const deleted = ref<Bookmark | null>(null)
const matches = computed(() =>
  props.state.bookmarks.filter((b) =>
    query.value.trim()
      ? `${b.title} ${b.url} ${pathOf(b.folderId)}`
          .toLocaleLowerCase()
          .includes(query.value.trim().toLocaleLowerCase())
      : (b.folderId || '') === currentFolder.value,
  ),
)
function chooseFolder(id: string) {
  currentFolder.value = id
  query.value = ''
}
async function saveFolder() {
  if (!folderEditor.value || busy.value) return
  busy.value = true
  const result = await props.run({
    action: 'save-bookmark-folder',
    id: folderEditor.value.id,
    value: { title: folderEditor.value.title, parentId: folderEditor.value.parentId || '' },
  })
  if (result) folderEditor.value = null
  busy.value = false
}
async function dissolve(folder: BookmarkFolder) {
  if (busy.value) return
  busy.value = true
  const result = await props.run({ action: 'remove-bookmark-folder', id: folder.id })
  if (result) notice.value = '文件夹已解散，书签和子文件夹已移到上一级。'
  busy.value = false
}
async function save() {
  if (!editor.value || busy.value) return
  busy.value = true
  const result = await props.run({
    action: 'save-bookmark',
    id: editor.value.id,
    value: { title: editor.value.title, url: editor.value.url, folderId: editor.value.folderId || '' },
  })
  busy.value = false
  if (result) editor.value = null
}
async function remove(bookmark: Bookmark) {
  if (busy.value) return
  busy.value = true
  const result = await props.run({ action: 'remove-bookmark', id: bookmark.id })
  if (result) {
    deleted.value = { ...bookmark }
    notice.value = `已删除「${bookmark.title}」。`
  }
  busy.value = false
}
async function undo() {
  if (!deleted.value || busy.value) return
  busy.value = true
  const result = await props.run({
    action: 'save-bookmark',
    value: {
      title: deleted.value.title,
      url: deleted.value.url,
      folderId: folders.value.some((f) => f.id === deleted.value?.folderId) ? deleted.value.folderId : '',
    },
  })
  if (result) {
    deleted.value = null
    notice.value = '书签已恢复到列表末尾。'
  }
  busy.value = false
}
async function move(id: string, direction: number) {
  const local = siblings.value.map((b) => b.id),
    index = local.indexOf(id),
    target = index + direction
  if (query.value.trim() || index < 0 || target < 0 || target >= local.length || busy.value) return
  const order = props.state.bookmarks.map((b) => b.id),
    a = order.indexOf(id),
    b = order.indexOf(local[target])
  ;[order[a], order[b]] = [order[b], order[a]]
  busy.value = true
  await props.run({ action: 'reorder-bookmarks', value: order })
  busy.value = false
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (!file) return
  busy.value = true
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('请选择小于 5 MB 的 HTML 书签文件。')
    const nodes = parseBookmarkHtml(await file.text())
    const result = await props.run({
      action: 'import-bookmarks',
      value: { nodes, parentId: currentFolder.value },
    })
    if (result) {
      notice.value = '导入完成，重复网址和不支持的地址会自动跳过。'
      deleted.value = null
    }
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
    busy.value = false
  }
}
</script>
<template>
  <section class="internal-page bookmarks-page bookmark-workspace">
    <nav class="bookmark-folders" aria-label="书签文件夹">
      <h2>书签</h2>
      <button :class="{ chosen: !currentFolder }" @click="chooseFolder('')">
        <Icon name="star" :size="16" />书签栏
      </button>
      <button
        v-for="item in flatFolders"
        :key="item.folder.id"
        :data-folder-id="item.folder.id"
        :class="{ chosen: currentFolder === item.folder.id }"
        :style="{ paddingLeft: `${12 + item.depth * 14}px` }"
        :title="pathOf(item.folder.id)"
        @click="chooseFolder(item.folder.id)"
      >
        <Icon name="folder" :size="16" /><span>{{ item.folder.title }}</span>
      </button>
    </nav>
    <div class="bookmark-main list-page">
      <header class="page-heading">
        <h1>{{ currentFolder ? pathOf(currentFolder) : '书签' }}</h1>
        <p>保存常用的网站，按自己的习惯排列。</p>
      </header>
      <div class="bookmark-tools">
        <label class="manager-search"
          ><Icon name="search" :size="17" /><input
            v-model="query"
            type="search"
            placeholder="搜索书签"
            aria-label="搜索书签"
        /></label>
        <button
          class="primary-button"
          :disabled="busy"
          @click="editor = { title: '', url: 'https://', folderId: currentFolder }"
        >
          添加书签
        </button>
        <button
          class="secondary-button"
          :disabled="busy"
          @click="folderEditor = { title: '', parentId: currentFolder }"
        >
          新建文件夹
        </button>
        <button class="secondary-button" :disabled="busy" @click="fileInput?.click()">导入 HTML</button>
        <button
          class="secondary-button"
          :disabled="busy || (!state.bookmarks.length && !state.bookmarkFolders.length)"
          @click="run({ action: 'export-bookmarks' })"
        >
          导出 HTML
        </button>
        <input
          ref="fileInput"
          type="file"
          hidden
          accept=".html,.htm,text/html"
          class="sr-only"
          aria-label="选择书签文件"
          @change="importFile"
        />
      </div>
      <p class="small-note">
        {{ state.bookmarks.length }} 个书签，{{ state.bookmarkFolders.length }}
        个文件夹。导入和导出保留文件夹层级。
      </p>
      <div v-if="notice" class="bookmark-notice" role="status">
        {{ notice }}
        <button v-if="deleted" class="text-action" :disabled="busy" @click="undo">撤销删除</button>
      </div>
      <form v-if="folderEditor" class="bookmark-editor folder-editor" @submit.prevent="saveFolder">
        <h2>{{ folderEditor.id ? '编辑文件夹' : '新建文件夹' }}</h2>
        <label
          >名称<input v-model="folderEditor.title" aria-label="文件夹名称" required maxlength="500"
        /></label>
        <label
          >位置<select v-model="folderEditor.parentId" aria-label="文件夹位置">
            <option value="">书签栏</option>
            <option v-for="item in parentOptions" :key="item.folder.id" :value="item.folder.id">
              {{ '　'.repeat(item.depth) + item.folder.title }}
            </option>
          </select></label
        >
        <div>
          <button class="primary-button" type="submit" :disabled="busy">保存</button
          ><button class="secondary-button" type="button" :disabled="busy" @click="folderEditor = null">
            取消
          </button>
        </div>
      </form>
      <form v-if="editor" class="bookmark-editor" @submit.prevent="save">
        <h2>{{ editor.id ? '编辑书签' : '添加书签' }}</h2>
        <label
          >名称<input v-model="editor.title" aria-label="书签名称" maxlength="500" autocomplete="off"
        /></label>
        <label
          >网址<input
            v-model="editor.url"
            aria-label="书签网址"
            maxlength="8192"
            required
            autocomplete="off"
            spellcheck="false"
        /></label>
        <label
          >位置<select v-model="editor.folderId" aria-label="书签位置">
            <option value="">书签栏</option>
            <option v-for="item in flatFolders" :key="item.folder.id" :value="item.folder.id">
              {{ '　'.repeat(item.depth) + item.folder.title }}
            </option>
          </select></label
        >
        <div>
          <button class="primary-button" :disabled="busy" type="submit">保存</button
          ><button class="secondary-button" type="button" :disabled="busy" @click="editor = null">
            取消
          </button>
        </div>
      </form>
      <article
        v-for="folder in children"
        :key="folder.id"
        :data-folder-id="folder.id"
        class="bookmark-folder-row bookmark-row"
      >
        <button class="bookmark-open" @click="currentFolder = folder.id">
          <Icon name="folder" :size="19" /><span
            ><strong>{{ folder.title }}</strong
            ><small>文件夹</small></span
          ></button
        ><button
          class="secondary-button"
          @click="folderEditor = { ...folder, parentId: folder.parentId || '' }"
        >
          编辑文件夹</button
        ><button
          class="icon-button"
          :disabled="busy"
          aria-label="解散文件夹"
          title="解散文件夹，内容移到上一级"
          @click="dissolve(folder)"
        >
          <Icon name="trash" :size="16" />
        </button>
      </article>
      <div v-if="!matches.length && !children.length" class="empty-page">
        <Icon name="star" :size="38" />
        <h2>{{ state.bookmarks.length ? '没有匹配的书签' : '把常用的网站留在这里' }}</h2>
        <p>{{ state.bookmarks.length ? '试试其他名称或网址。' : '点击添加书签，或在网页按 Ctrl+D。' }}</p>
      </div>
      <article
        v-for="bookmark in matches"
        :key="bookmark.id"
        :data-bookmark-id="bookmark.id"
        class="bookmark-row bookmark-leaf"
      >
        <button
          class="bookmark-open"
          :title="bookmark.url"
          @click="run({ action: 'new-tab', url: bookmark.url })"
        >
          <Icon name="star" :size="19" /><span
            ><strong>{{ bookmark.title }}</strong
            ><small>{{ bookmark.url }}</small
            ><small v-if="query.trim() && bookmark.folderId">{{ pathOf(bookmark.folderId) }}</small></span
          >
        </button>
        <div class="bookmark-row-actions">
          <button
            class="icon-button"
            :disabled="busy || !!query.trim() || siblings[0]?.id === bookmark.id"
            aria-label="上移书签"
            title="上移书签"
            @click="move(bookmark.id, -1)"
          >
            <Icon name="up" :size="16" />
          </button>
          <button
            class="icon-button"
            :disabled="busy || !!query.trim() || siblings.at(-1)?.id === bookmark.id"
            aria-label="下移书签"
            title="下移书签"
            @click="move(bookmark.id, 1)"
          >
            <Icon name="down" :size="16" />
          </button>
          <button
            class="secondary-button"
            :disabled="busy"
            @click="editor = { ...bookmark, folderId: bookmark.folderId || '' }"
          >
            编辑
          </button>
          <button
            class="icon-button"
            :disabled="busy"
            aria-label="删除书签"
            title="删除书签"
            @click="remove(bookmark)"
          >
            <Icon name="trash" :size="16" />
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
