import type { NativePanelContent } from 'electron'

export interface FindPresentation {
  width: number
  query: string
  matchCase: boolean
  status: 'idle' | 'searching' | 'ready' | 'error'
  total: number
  ordinal: number
  notice?: string
}
/** Only an explicit open seeds the input. Result/theme/geometry updates never supply its value. */
export function findPanelContent(state: FindPresentation, seedInput = false): NativePanelContent {
  const ready = state.status === 'ready' && state.total > 0
  const count =
    state.notice ||
    (state.status === 'searching'
      ? '查找中…'
      : state.status === 'error'
        ? '暂时无法查找'
        : state.total
          ? `${state.ordinal} / ${state.total} 个结果`
          : '没有匹配结果')
  return {
    id: 'page-find',
    type: 'column',
    width: Math.max(200, Math.min(380, state.width)),
    gap: 8,
    padding: 4,
    children: [
      {
        id: 'find-row',
        type: 'row',
        gap: 4,
        height: 30,
        children: [
          {
            id: 'find-query',
            type: 'input',
            placeholder: '在网页中查找',
            accessibleName: '在网页中查找',
            height: 30,
            flex: 1,
            maxLength: 1024,
            invalid: !!state.query && state.status === 'ready' && !state.total,
            ...(state.query && state.status === 'ready' && !state.total
              ? { accessibleDescription: '没有匹配结果' }
              : {}),
            ...(seedInput ? { value: state.query } : {}),
          },
          {
            id: 'find-previous',
            type: 'button',
            text: '↑',
            accessibleName: '上一个匹配项',
            tooltip: '上一个匹配项',
            width: 28,
            height: 28,
            disabled: !ready,
            variant: 'plain',
          },
          {
            id: 'find-next',
            type: 'button',
            text: '↓',
            accessibleName: '下一个匹配项',
            tooltip: '下一个匹配项（Enter）',
            width: 28,
            height: 28,
            disabled: !ready,
            variant: 'plain',
          },
          {
            id: 'find-close',
            type: 'button',
            text: '×',
            accessibleName: '关闭查找',
            tooltip: '关闭查找（Esc）',
            width: 28,
            height: 28,
            variant: 'plain',
          },
        ],
      },
      ...(state.query
        ? [
            {
              id: 'find-footer',
              type: 'row',
              height: 28,
              gap: 8,
              children: [
                {
                  id: 'find-count',
                  type: 'text',
                  role: 'status',
                  text: count,
                  flex: 1,
                  muted: true,
                  singleLine: true,
                },
                { id: 'find-case', type: 'toggle', text: '区分大小写', checked: state.matchCase, width: 130 },
              ],
            },
          ]
        : []),
    ],
  }
}
