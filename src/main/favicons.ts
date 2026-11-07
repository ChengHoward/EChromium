import { app, WebContentsView, nativeImage, type WebContents } from 'electron'

let decoder: Promise<WebContentsView> | undefined
async function decodeBrowserImage(bytes: Buffer, contentType: string) {
  // Chromium also decodes ICO/SVG/WebP; nativeImage's buffer API only covers some formats.
  decoder ??= (async () => {
    const window = new WebContentsView({
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        partition: 'favicon-decoder',
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    app.once('will-quit', () => {
      if (!window.webContents.isDestroyed()) window.webContents.close({ waitForBeforeUnload: false })
    })
    window.webContents.once('render-process-gone', () => {
      decoder = undefined
      if (!window.webContents.isDestroyed()) window.webContents.close({ waitForBeforeUnload: false })
    })
    await window.webContents.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; script-src 'none'; object-src 'none'; base-uri 'none'\">",
        ),
    )
    return window
  })().catch((error) => {
    decoder = undefined
    throw error
  })
  const window = await decoder
  const mime = /^image\/[a-z0-9.+-]+$/i.test(contentType) ? contentType : 'image/x-icon'
  return window.webContents.executeJavaScript(`new Promise(resolve => {
    const image = new Image(), timer = setTimeout(() => resolve(undefined), 2000);
    image.onerror = () => { clearTimeout(timer); resolve(undefined) };
    image.onload = () => {
      clearTimeout(timer);
      if (!image.naturalWidth || image.naturalWidth > 2048 || image.naturalHeight > 2048) return resolve(undefined);
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
        canvas.getContext('2d').drawImage(image, 0, 0, 32, 32);
        resolve(canvas.toDataURL('image/png'));
      } catch { resolve(undefined) }
    };
    image.src = ${JSON.stringify('data:' + mime + ';base64,' + bytes.toString('base64'))};
  })`) as Promise<string | undefined>
}

/** Fetch through the page's own session; never load remote images in the shell. */
export async function pageFavicon(wc: WebContents, candidates: string[], signal: AbortSignal) {
  for (const value of candidates.slice(0, 4)) {
    if (signal.aborted || wc.isDestroyed()) return
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const url = new URL(value)
      if (!['https:', 'http:', 'data:'].includes(url.protocol) || url.username || url.password) continue
      if (url.protocol === 'data:' && (!value.startsWith('data:image/') || value.length > 350000)) continue
      const response = await wc.session.fetch(value, { signal, credentials: 'omit', cache: 'reload' })
      if (!response.ok || !response.body) continue
      if (Number(response.headers.get('content-length')) > 256000) {
        await response.body.cancel()
        continue
      }
      reader = response.body.getReader()
      const chunks: Buffer[] = []
      let length = 0
      while (true) {
        const result = await reader.read()
        if (result.done) break
        length += result.value.byteLength
        if (length > 256000) throw new Error('Favicon too large')
        chunks.push(Buffer.from(result.value))
      }
      const bytes = Buffer.concat(chunks)
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) {
        const decoded = await decodeBrowserImage(
          bytes,
          response.headers.get('content-type')?.split(';')[0].trim() || '',
        )
        if (decoded && decoded.length <= 24000 && !signal.aborted) return decoded
        continue
      }
      const { width, height } = image.getSize()
      if (width > 2048 || height > 2048) continue
      const icon = image.resize({ width: 32, height: 32, quality: 'best' }).toPNG()
      if (icon.length <= 16000) return 'data:image/png;base64,' + icon.toString('base64')
    } catch {
      // A missing, invalid or superseded icon keeps the default globe.
    } finally {
      await reader?.cancel().catch(() => {})
    }
  }
}
