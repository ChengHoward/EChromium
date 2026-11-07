<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
const props = defineProps<{ text: string }>()
const label = ref<HTMLElement>(),
  overflowing = ref(false)
let observer: ResizeObserver | undefined
const measure = () => {
  const element = label.value
  overflowing.value = !!element && element.scrollWidth > element.clientWidth + 0.5
}
onMounted(() => {
  observer = new ResizeObserver(measure)
  if (label.value) observer.observe(label.value)
  measure()
})
watch(
  () => props.text,
  async () => {
    await nextTick()
    measure()
  },
)
onBeforeUnmount(() => observer?.disconnect())
</script>
<template>
  <span ref="label" class="tab-title" :class="{ overflowing }">{{ text }}</span>
</template>
