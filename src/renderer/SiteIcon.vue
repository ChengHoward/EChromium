<script setup lang="ts">
import { ref, watch } from 'vue'
import Icon from './Icon.vue'
const props = withDefaults(defineProps<{ src?: string; size?: number }>(), { size: 16 })
const failed = ref(false)
const artwork = ref('')
watch(
  () => props.src,
  () => {
    failed.value = false
    artwork.value = ''
  },
)
function loaded(event: Event) {
  const image = event.target as HTMLImageElement
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 16
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0, 16, 16)
    const pixels = context.getImageData(0, 0, 16, 16).data
    let sum = 0,
      weight = 0
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] / 255
      sum += (pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) * alpha
      weight += alpha
    }
    artwork.value =
      weight && sum / weight < 65 ? 'dark-artwork' : weight && sum / weight > 220 ? 'light-artwork' : ''
  } catch {
    artwork.value = ''
  }
}
</script>
<template>
  <span class="site-icon" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <img
      v-if="src && !failed"
      :src="src"
      :class="artwork"
      alt=""
      draggable="false"
      @load="loaded"
      @error="failed = true"
    />
    <Icon v-else name="globe" :size="size" />
  </span>
</template>
<style scoped>
.site-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  vertical-align: middle;
}
.site-icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
:global(.browser-shell.dark .site-icon .dark-artwork) {
  background: #edf2f6;
  border-radius: 3px;
}
:global(.browser-shell:not(.dark) .site-icon .light-artwork) {
  background: #344353;
  border-radius: 3px;
}
</style>
