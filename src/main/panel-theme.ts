import type { NativePanelTheme, MenuAppearance } from 'electron'
import type { Host } from './browser'

export function panelTheme(host: Host): NativePanelTheme {
  const colors = host.appearance.colors
  return {
    mode: host.appearance.dark ? 'dark' : 'light',
    background: colors.surface,
    text: colors.ink,
    muted: colors.muted,
    border: colors.stroke,
    accent: colors.accent,
    fontFamily: 'Segoe UI',
    fontSize: 13,
  }
}

export function menuTheme(host: Host): MenuAppearance {
  const colors = host.appearance.colors
  return {
    theme: host.appearance.dark ? 'dark' : 'light',
    background: colors.surface,
    foreground: colors.ink,
    hover: colors.selection,
    border: colors.stroke,
  }
}
