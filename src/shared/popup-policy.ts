import { webTarget } from './navigation'

interface Budget {
  epoch: number
  times: number[]
  allowed: boolean
  blocked: number
}
export const popupLimits = { total: 8, perPage: 3, burst: 3, interval: 10000 }
/** Group descendants with their original tab; closing a popup does not replenish a burst. */
export class PopupPolicy {
  private entries = new Map<number, Budget>()
  constructor(private now = () => Date.now()) {}
  private entry(root: number, epoch: number) {
    let item = this.entries.get(root)
    if (!item || item.epoch !== epoch) {
      item = { epoch, times: [], allowed: false, blocked: 0 }
      this.entries.set(root, item)
    }
    return item
  }
  status(root: number, epoch: number) {
    const item = this.entry(root, epoch)
    return { blocked: item.blocked, allowed: item.allowed }
  }
  allow(root: number, epoch: number, allowed: boolean) {
    this.entry(root, epoch).allowed = allowed
  }
  forget(root: number) {
    this.entries.delete(root)
  }
  request(root: number, epoch: number, url: string, foreground: boolean, live: number, total: number) {
    const item = this.entry(root, epoch),
      now = this.now()
    item.times = item.times.filter((time) => now - time < popupLimits.interval)
    if (
      (!webTarget(url) && url !== 'about:blank') ||
      !foreground ||
      total >= popupLimits.total ||
      (!item.allowed && (live >= popupLimits.perPage || item.times.length >= popupLimits.burst))
    ) {
      item.blocked = Math.min(999, item.blocked + 1)
      return false
    }
    item.times.push(now)
    // The override still has a global live cap; do not retain an unbounded creation log.
    item.times = item.times.slice(-popupLimits.burst)
    return true
  }
}
