<template>
  <svg
    :width="size || 18"
    :height="size || 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <g v-if="name === 'newtab'">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 7h10" />
      <circle v-for="x in [8, 12, 16]" :key="x" :cx="x" cy="13" r="0.8" fill="currentColor" stroke="none" />
    </g>
    <g v-else-if="name === 'globe' || !paths[name]">
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </g>
    <path v-else :d="paths[name]" />
  </svg>
</template>
<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  site: 'M4 7h16M4 17h16M9 4v6M15 14v6',
  back: 'm14 6-6 6 6 6',
  forward: 'm10 6 6 6-6 6',
  reload: 'M20 10a8 8 0 1 0-1 7M20 4v6h-6',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 5v14M5 12h14',
  'tab-add': 'M12 1.5v21M1.5 12h21',
  globe: '',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5',
  star: 'm12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z',
  menu: 'M5 6h14M5 12h14M5 18h14',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  history: 'M3 11a9 9 0 1 1 2.3 7M3 4v7h7m2-4v6l4 2',
  settings:
    'm9 3-.6 3-2 1.2-2.9-.9L1 10l2.3 2-.1 2L1 16l2.5 4 3-.8 1.8 1.2L9 23h5l.7-2.7 2-1.2 2.8.9 2.5-4-2.3-2 .1-2L22 10l-2.5-4-3 .8-1.8-1.2L14 3ZM15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M20.8 14A9 9 0 0 1 10 3.2 9 9 0 1 0 20.8 14Z',
  folder: 'M3 7h7l2 2h9v11H3ZM3 7V4h6l3 3h8v2',
  private: 'M3 10h18M5 10l2-6h10l2 6M4 15a4 4 0 1 0 8 0H4Zm8 0h8a4 4 0 1 1-8 0Z',
  audio: 'm11 5-5 4H3v6h3l5 4Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  pin: 'm8 3 8 0-1 6 4 4v2h-6v6l-2-2v-4H5v-2l4-4Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  chevron: 'm8 10 4 4 4-4',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  monitor: 'M3 4h18v13H3Zm5 17h8m-4-4v4',
  check: 'm5 12 4 4 10-10',
  warning: 'm12 3 10 18H2Zm0 6v5m0 3h.01',
  pause: 'M8 5v14M16 5v14',
  play: 'm8 4 12 8-12 8Z',
  trash: 'M4 6h16M9 3h6M6 6l1 15h10l1-15M10 10v7m4-7v7',
}
</script>
