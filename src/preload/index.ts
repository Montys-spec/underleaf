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
  newProjectDialog: (templateId) => ipcRenderer.invoke('project:newDialog', templateId),
  listTemplates: () => ipcRenderer.invoke('project:templates'),
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
  compile: (activeFile?: string) => ipcRenderer.invoke('compile:run', activeFile),
  stopCompile: () => ipcRenderer.invoke('compile:stop'),
  clearCache: () => ipcRenderer.invoke('compile:clearCache'),
  readPdf: () => ipcRenderer.invoke('compile:readPdf'),
  openPdfExternally: () => ipcRenderer.invoke('compile:openPdf'),
  exportPdf: () => ipcRenderer.invoke('compile:exportPdf'),
  syncForward: (file, line, column) => ipcRenderer.invoke('synctex:forward', file, line, column),
  syncInverse: (page, x, y) => ipcRenderer.invoke('synctex:inverse', page, x, y),

  wordCount: () => ipcRenderer.invoke('tools:wordCount'),
  search: (opts) => ipcRenderer.invoke('tools:search', opts),
  replaceAll: (opts, replacement) => ipcRenderer.invoke('tools:replaceAll', opts, replacement),
  getSymbols: () => ipcRenderer.invoke('tools:symbols'),

  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitInit: () => ipcRenderer.invoke('git:init'),
  gitCommit: (message) => ipcRenderer.invoke('git:commit', message),
  gitDiff: (p) => ipcRenderer.invoke('git:diff', p),
  gitPush: () => ipcRenderer.invoke('git:push'),
  gitPull: () => ipcRenderer.invoke('git:pull'),

  lspStart: (opts) => ipcRenderer.invoke('lsp:start', opts),
  lspSend: (message) => ipcRenderer.send('lsp:send', message),
  onLspMessage: (cb) => subscribe<string>('lsp:message', cb),

  spellCheck: (words, lang) => ipcRenderer.invoke('spell:check', words, lang),
  spellSuggest: (word, lang) => ipcRenderer.invoke('spell:suggest', word, lang),
  spellLearn: (word) => ipcRenderer.invoke('spell:learn', word),
  spellDetect: (text) => ipcRenderer.invoke('spell:detect', text),
  spellLanguages: () => ipcRenderer.invoke('spell:languages'),
  setTheme: (theme) => ipcRenderer.send('app:theme', theme),

  onFsChange: (cb) => subscribe<FsChangeEvent>('fs:change', cb),
  onMenu: (cb) => subscribe<MenuCommand>('menu', cb)
}

contextBridge.exposeInMainWorld('underleaf', api)
