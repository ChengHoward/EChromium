import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { shell, type DownloadItem, type Session } from 'electron'
import type { DownloadState } from '../shared/model'
import type { BrowserStore } from './storage'
import { withinInterval } from '../shared/browsing-data'

export class Downloads {
  private items = new Map<string, { state: DownloadState; item?: DownloadItem; owner: string }>()
  constructor(
    private store: BrowserStore,
    private changed: () => void,
  ) {
    for (const state of store.data.downloads)
      this.items.set(state.id, { state: { ...state }, owner: 'default' })
  }
  private publish() {
    const owners = new Set([...this.items.values()].map((row) => row.owner))
    for (const owner of owners) {
      const ended = this.list(owner).filter((row) => !row.active)
      for (const row of ended.slice(500)) this.items.delete(row.id)
    }
    this.store.data.downloads = this.list('default').slice(0, 500)
    this.store.saveSoon()
    this.changed()
  }
  register(session: Session, owner: string) {
    session.on('will-download', (_event, item) => {
      const id = randomUUID()
      const state: DownloadState = {
        id,
        name: item.getFilename(),
        received: 0,
        total: item.getTotalBytes(),
        status: 'progressing',
        path: '',
        url: item.getURL(),
        at: Date.now(),
        active: true,
        canResume: false,
      }
      this.items.set(id, { state, item, owner })
      item.setSaveDialogOptions({ title: '保存下载文件', defaultPath: item.getFilename() })
      const update = () => {
        state.received = item.getReceivedBytes()
        state.total = item.getTotalBytes()
        state.path = item.getSavePath()
        state.canResume = state.active && item.canResume()
        this.publish()
      }
      item.on('updated', (_e, status) => {
        state.status = status === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
        update()
      })
      item.once('done', (_e, status) => {
        state.status = status
        state.active = false
        update()
        const row = this.items.get(id)
        if (row) row.item = undefined
      })
      update()
    })
  }
  list(owner: string) {
    return [...this.items.values()]
      .filter((i) => i.owner === owner)
      .map((i) => ({ ...i.state }))
      .sort((a, b) => b.at - a.at)
  }
  async action(owner: string, id: string, action: unknown) {
    const row = this.items.get(id)
    if (!row || row.owner !== owner) throw new Error('下载任务不可用。')
    if (action === 'pause' && row.item && row.state.status === 'progressing') {
      row.item.pause()
      row.state.status = 'paused'
      row.state.canResume = row.item.canResume()
    } else if (action === 'resume' && row.item?.canResume()) {
      row.item.resume()
      row.state.status = 'progressing'
      row.state.canResume = false
    } else if (action === 'cancel' && row.item && row.state.active) row.item.cancel()
    else if (action === 'reveal' && row.state.status === 'completed' && row.state.path) {
      if (!fs.existsSync(row.state.path)) throw new Error('文件已移动或删除。下载记录仍会保留。')
      shell.showItemInFolder(row.state.path)
    } else if (action === 'remove' && !row.state.active) this.items.delete(id)
    else throw new Error('此下载操作不可用。')
    this.publish()
  }
  clear(owner: string) {
    this.clearRange(owner, { from: 0, to: Infinity })
  }
  clearRange(owner: string, interval: { from: number; to: number }) {
    let removed = 0
    for (const [id, row] of this.items)
      if (row.owner === owner && !row.state.active && withinInterval(row.state.at, interval)) {
        this.items.delete(id)
        removed++
      }
    this.publish()
    return removed
  }
  release(owner: string) {
    for (const [id, row] of this.items)
      if (row.owner === owner) {
        if (row.state.active) row.item?.cancel()
        this.items.delete(id)
      }
  }
}
