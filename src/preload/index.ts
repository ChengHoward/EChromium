import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserBridge, BrowserRequest, BrowserState, UiEvent } from '../shared/model'

const bridge: BrowserBridge = {
  tabPreviews: (request) => ipcRenderer.invoke('browser:tab-previews', request),
  siteInventory: (request) => ipcRenderer.invoke('browser:site-inventory', request),
  browsingData: (request) => ipcRenderer.invoke('browser:browsing-data', request),
  siteData: (request) => ipcRenderer.invoke('browser:site-data', request),
  suggestions: (request) => ipcRenderer.invoke('browser:suggestions', request),
  request: (request: BrowserRequest) => ipcRenderer.invoke('browser:request', request),
  onState: (callback) => {
    const listener = (_event: unknown, state: BrowserState) => callback(state)
    ipcRenderer.on('browser:state', listener)
    return () => ipcRenderer.removeListener('browser:state', listener)
  },
  onUi: (callback) => {
    const listener = (_event: unknown, event: UiEvent) => callback(event)
    ipcRenderer.on('browser:ui', listener)
    return () => ipcRenderer.removeListener('browser:ui', listener)
  },
}
contextBridge.exposeInMainWorld('browser', bridge)
