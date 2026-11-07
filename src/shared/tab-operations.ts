export function closeTargets(
  tabs: readonly { id: string; pinned: boolean }[],
  anchor: string,
  mode: unknown,
) {
  const index = tabs.findIndex((t) => t.id === anchor)
  if (index < 0 || !['others', 'left', 'right'].includes(mode as string)) throw new Error('无效的关闭操作。')
  return tabs
    .filter(
      (t, i) =>
        !t.pinned && t.id !== anchor && (mode === 'others' || (mode === 'left' ? i < index : i > index)),
    )
    .map((t) => t.id)
}
