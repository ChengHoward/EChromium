/** Ordinary target=_blank links are tabs; explicitly sized/scripted dialogs stay windows. */
export function windowOpenTarget(disposition: string, features: string): 'tab' | 'background' | 'popup' {
  if (disposition === 'background-tab') return 'background'
  if (disposition === 'foreground-tab') return 'tab'
  const values = new Map(
    features
      .toLowerCase()
      .split(',')
      .map((feature) => {
        const [name, value = 'yes'] = feature.trim().split(/\s*=\s*/)
        return [name, value] as const
      }),
  )
  const popup = values.get('popup')
  if (
    disposition === 'new-window' ||
    (popup !== undefined && !['0', 'no', 'false'].includes(popup)) ||
    ['width', 'height', 'left', 'top'].some((name) => values.has(name))
  )
    return 'popup'
  return 'tab'
}
