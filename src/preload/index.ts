import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { FsChangeEvent, MenuCommand, UnderleafApi } from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: UnderleafApi = {
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  openProjectDialog: () => ipcRenderer.invoke('project:openDialog'),
  newProjectDialog: () => ipcRenderer.invoke('project:newDialog'),
  openProject: (root) => ipcRenderer.invoke('project:open', root),
  getInitialProject: () => ipcRenderer.invoke('project:initial'),
  closeProject: () => ipcRenderer.invoke('project:close'),
  refreshProject: () => ipcRenderer.invoke('project:refresh'),

  readFile: (p) => ipcRenderer.invoke('fs:read', p),
  readBinary: (p) => ipcRenderer.invoke('fs:readBinary', p),
  writeFile: (p, content) => ipcRenderer.invoke('fs:write', p, content),
  createFile: (p) => ipcRenderer.invoke('fs:createFile', p),
  createFolder: (p) => ipcRenderer.invoke('fs:createFolder', p),
  renamePath: (from, to) => ipcRenderer.invoke('fs:rename', from, to),
  trashPath: (p) => ipcRenderer.invoke('fs:trash', p),
  importFiles: (dir, sources) => ipcRenderer.invoke('fs:import', dir, sources),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  revealInFinder: (p) => ipcRenderer.invoke('fs:reveal', p),

  saveSettings: (s) => ipcRenderer.invoke('project:saveSettings', s),
  compile: () => ipcRenderer.invoke('compile:run'),
  stopCompile: () => ipcRenderer.invoke('compile:stop'),
  readPdf: () => ipcRenderer.invoke('compile:readPdf'),
  openPdfExternally: () => ipcRenderer.invoke('compile:openPdf'),

  onFsChange: (cb) => subscribe<FsChangeEvent>('fs:change', cb),
  onMenu: (cb) => subscribe<MenuCommand>('menu', cb)
}

contextBridge.exposeInMainWorld('underleaf', api)
