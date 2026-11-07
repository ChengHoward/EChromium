import { WebContentsView, type Session } from 'electron'
import { storageUsage, type StorageUsage } from '../shared/site-inventory'

function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('网站用量统计超时。')), milliseconds)
    }),
  ]).finally(() => clearTimeout(timer))
}
/** A session-scoped blank target keeps the user's page, debugger and network untouched. */
export async function measureStorage(session: Session, origins: string[], valid: () => boolean) {
  const results = new Map<string, StorageUsage>()
  if (!origins.length || !valid()) return results
  const view = new WebContentsView({
      webPreferences: {
        session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    }),
    wc = view.webContents
  const expires = Date.now() + 15000
  const watchdog = setTimeout(() => {
    if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false })
  }, 16000)
  try {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (event, url) => {
      if (url !== 'about:blank') event.preventDefault()
    })
    await deadline(wc.loadURL('about:blank'), 4000)
    if (!valid()) return results
    wc.debugger.attach('1.3')
    let index = 0
    await Promise.all(
      Array.from({ length: Math.min(4, origins.length) }, async () => {
        while (index < origins.length && valid() && !wc.isDestroyed() && Date.now() < expires) {
          const origin = origins[index++]
          try {
            const measured = storageUsage(
              await deadline(
                wc.debugger.sendCommand('Storage.getUsageAndQuota', { origin }),
                Math.min(1800, expires - Date.now()),
              ),
            )
            if (measured) results.set(origin, measured)
          } catch {
            /* Missing/failed readings stay unavailable, never zero. */
          }
        }
      }),
    )
    return results
  } catch {
    return results
  } finally {
    clearTimeout(watchdog)
    if (!wc.isDestroyed()) {
      if (wc.debugger.isAttached()) wc.debugger.detach()
      wc.close({ waitForBeforeUnload: false })
    }
  }
}
