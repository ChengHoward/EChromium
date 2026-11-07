import { nativeTheme, type BrowserWindow } from 'electron'
import os from 'node:os'
import { chromePalette, palette } from '../shared/appearance'
import type { Preferences } from '../shared/model'

const applied = new WeakMap<BrowserWindow, { material: string; background: string; overlay: string }>()
const transitions = new WeakMap<BrowserWindow, Promise<void>>()

function useAcrylic(window: BrowserWindow, preferences: Preferences) {
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(os.release())
  return (
    process.platform === 'win32' &&
    version?.[1] === '10' &&
    Number(version[3]) >= 22621 &&
    typeof window.setBackgroundMaterial === 'function' &&
    preferences.acrylic &&
    nativeTheme.shouldUseHighContrastColors === false &&
    nativeTheme.inForcedColorsMode === false &&
    nativeTheme.prefersReducedTransparency === false
  )
}

/** Native Acrylic + host tint, adapted from Navora window-material (MIT). */
export function applyMaterial(window: BrowserWindow, preferences: Preferences, force = false) {
  const { colors, dark } = palette(preferences, nativeTheme.shouldUseDarkColors)
  let material: 'acrylic' | 'solid' = 'solid'
  const previous = applied.get(window)
  if (useAcrylic(window, preferences)) {
    try {
      if (force || previous?.material !== 'acrylic') window.setBackgroundMaterial('acrylic')
      if (force || previous?.material !== 'acrylic' || previous.background !== '#00000000')
        window.setBackgroundColor('#00000000')
      material = 'acrylic'
    } catch {
      /* Restore the opaque surface below. */
    }
  }
  if (material === 'solid') {
    if (process.platform === 'win32' && (force || previous?.material !== 'solid')) {
      try {
        window.setBackgroundMaterial('none')
      } catch {
        /* Older runtime. */
      }
    }
    if (force || previous?.material !== 'solid' || previous.background !== colors.shell)
      window.setBackgroundColor(colors.shell)
  }
  const overlay = JSON.stringify([material, colors.shell, colors.ink])
  if (process.platform === 'win32' && (force || previous?.overlay !== overlay))
    window.setTitleBarOverlay({
      color: material === 'acrylic' ? '#00000000' : colors.shell,
      symbolColor: colors.ink,
      height: 42,
    })
  applied.set(window, {
    material,
    background: material === 'acrylic' ? '#00000000' : colors.shell,
    overlay,
  })
  return {
    material,
    colors: {
      ...colors,
      ...chromePalette(
        colors,
        dark,
        nativeTheme.shouldUseDarkColors,
        material === 'acrylic',
        preferences.transparency,
      ),
    } as Record<string, string>,
    dark,
  }
}

/** Paint an opaque chrome frame before the runtime resets the native clear color.
 * Only the owned shell is styled; guest pages and their focus remain untouched. */
export function updateMaterial(
  window: BrowserWindow,
  preferences: () => Preferences,
  commit: (appearance: ReturnType<typeof applyMaterial>) => void,
) {
  const previous = transitions.get(window) || Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      if (window.isDestroyed()) return
      const wc = window.webContents
      const { colors } = palette(preferences(), nativeTheme.shouldUseDarkColors)
      const desired = useAcrylic(window, preferences())
      const switching = applied.get(window)?.material !== (desired ? 'acrylic' : 'solid')
      let key: string | undefined
      const paint = async () => {
        if (wc.isDestroyed()) return
        // A minimized or closing shell must never stall the preference queue.
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            (async () => {
              await wc.executeJavaScript(`new Promise(resolve => {
        const timeout = setTimeout(resolve, 120);
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve(); }));
      })`)
              if (!wc.isDestroyed() && !window.isDestroyed() && window.isVisible() && !window.isMinimized())
                await wc.capturePage()
            })(),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 500)
            }),
          ])
        } catch {
          // No copyable frame during destruction/reload; still restore the native clear color.
        } finally {
          clearTimeout(timer)
        }
      }
      try {
        if (switching && !wc.isLoadingMainFrame()) {
          key = await wc.insertCSS(`.browser-shell { --chrome: ${colors.shell} !important;
          --chrome-content: ${colors['bar-surface']} !important; --chrome-field: ${colors['field-surface']} !important; }`)
          await paint()
        }
        if (window.isDestroyed()) return
        commit(applyMaterial(window, preferences()))
        if (key) await paint()
      } finally {
        if (key && !wc.isDestroyed()) await wc.removeInsertedCSS(key)
      }
    })
  transitions.set(window, next)
  return next
}
