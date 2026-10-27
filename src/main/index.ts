import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron'
import { promises as fs, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { LspOptions, MenuCommand, ProjectInfo, ProjectSettings, RecentProject, SearchOptions, ThemePreference } from '@shared/types'
import { CompileRunner } from './compiler'
import { gitCommit, gitDiff, gitInit, gitPull, gitPush, gitStatus } from './git'
import { TexlabBridge } from './lsp'
import { Project } from './project'
import { projectSymbols, replaceInProject, searchProject, wordCount } from './projectTools'
import { SpellService } from './spell'
import { forwardSearch, inverseSearch } from './synctex'
import { getTemplate, listTemplates } from './templates'

let win: BrowserWindow | null = null
let project: Project | null = null
let pendingOpen: string | null = initialProjectFromArgs()
const runner = new CompileRunner()
// Helper binaries ship in the app bundle; in development they live in resources/bin.
const bundledBin = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(app.getAppPath(), 'resources', 'bin')
// A texlab binary shipped inside the app bundle takes precedence over a Homebrew install.
const texlab = new TexlabBridge(bundledBin, (msg) => win?.webContents.send('lsp:message', msg))
const spell = new SpellService(bundledBin)

const recentFile = (): string => path.join(app.getPath('userData'), 'recent-projects.json')

function initialProjectFromArgs(): string | null {
  const candidates = [process.env.UNDERLEAF_OPEN, ...process.argv.slice(1)]
  for (const c of candidates) {
    if (!c || c.startsWith('-')) continue
    const full = path.resolve(c)
    try {
      if (statSync(full).isDirectory() && !full.endsWith('.app') && full !== process.cwd()) return full
    } catch {
      // Not a path; ignore.
    }
  }
  return process.env.UNDERLEAF_OPEN ? path.resolve(process.env.UNDERLEAF_OPEN) : null
}

async function readRecent(): Promise<RecentProject[]> {
  try {
    const list = JSON.parse(await fs.readFile(recentFile(), 'utf8')) as RecentProject[]
    return list.filter((p) => existsSync(p.root))
  } catch {
    return []
  }
}

async function addRecent(p: Project): Promise<void> {
  const list = (await readRecent()).filter((r) => r.root !== p.root)
  list.unshift({ root: p.root, name: p.name, openedAt: Date.now() })
  await fs.mkdir(path.dirname(recentFile()), { recursive: true })
  await fs.writeFile(recentFile(), JSON.stringify(list.slice(0, 15), null, 2))
  app.addRecentDocument(p.root)
}

async function openProject(root: string): Promise<ProjectInfo> {
  project?.close()
  runner.stop()
  builtFile = undefined
  texlab.stop()
  const p = new Project(root)
  await p.load()
  project = p
  p.watch((e) => win?.webContents.send('fs:change', e))
  await addRecent(p)
  win?.setTitle(`${p.name} — Underleaf`)
  win?.setRepresentedFilename(p.root)
  return p.info()
}

/** The document the last compile built; the preview, SyncTeX and export use its PDF. */
let builtFile: string | undefined

function pdfPath(p: Project): string {
  const file = builtFile ?? p.settings.mainFile
  const job = path.basename(file, path.extname(file))
  return path.join(p.buildDir, `${job}.pdf`)
}

function requireProject(): Project {
  if (!project) throw new Error('No project is open')
  return project
}

function sendMenu(command: MenuCommand): void {
  win?.webContents.send('menu', command)
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendMenu('new-project') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open-project') },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'New File…', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new-file') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { type: 'separator' },
        { label: 'Export PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenu('export-pdf') },
        { type: 'separator' },
        { label: 'Project Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings') },
        { label: 'Close Project', accelerator: 'CmdOrCtrl+Shift+W', click: () => sendMenu('close-project') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Project', accelerator: 'CmdOrCtrl+Shift+F', click: () => sendMenu('search') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Logs', accelerator: 'CmdOrCtrl+L', click: () => sendMenu('toggle-logs') },
        { label: 'Toggle Outline', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenu('toggle-outline') },
        { label: 'Source Control', accelerator: 'CmdOrCtrl+Shift+G', click: () => sendMenu('git') },
        { type: 'separator' },
        { label: 'Show Position in PDF', accelerator: 'CmdOrCtrl+J', click: () => sendMenu('sync-to-pdf') },
        { type: 'separator' },
        { label: 'Zoom PDF In', accelerator: 'CmdOrCtrl+=', click: () => sendMenu('zoom-in') },
        { label: 'Zoom PDF Out', accelerator: 'CmdOrCtrl+-', click: () => sendMenu('zoom-out') },
        { label: 'Fit PDF to Width', accelerator: 'CmdOrCtrl+0', click: () => sendMenu('zoom-fit') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Build',
      submenu: [
        { label: 'Recompile', accelerator: 'CmdOrCtrl+Enter', click: () => sendMenu('compile') },
        { type: 'separator' },
        { label: 'Word Count', accelerator: 'CmdOrCtrl+Shift+C', click: () => sendMenu('word-count') }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  ipcMain.handle('project:recent', () => readRecent())
  ipcMain.handle('project:initial', async () => {
    const root = pendingOpen
    pendingOpen = null
    return root && existsSync(root) ? openProject(root) : null
  })
  ipcMain.handle('project:open', (_e, root: string) => openProject(root))
  ipcMain.handle('project:openDialog', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Open LaTeX Project',
      buttonLabel: 'Open Project',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled || !res.filePaths[0] ? null : openProject(res.filePaths[0])
  })
  ipcMain.handle('project:templates', () => listTemplates())
  ipcMain.handle('project:newDialog', async (_e, templateId?: string) => {
    const res = await dialog.showSaveDialog(win!, {
      title: 'New LaTeX Project',
      buttonLabel: 'Create Project',
      nameFieldLabel: 'Project name:',
      defaultPath: path.join(app.getPath('documents'), 'Untitled Project')
    })
    if (res.canceled || !res.filePath) return null
    if (existsSync(res.filePath)) throw new Error(`"${path.basename(res.filePath)}" already exists.`)
    const template = getTemplate(templateId)
    for (const [rel, content] of Object.entries(template.files)) {
      const dest = path.join(res.filePath, rel)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, content)
    }
    if (template.compiler) {
      await fs.mkdir(path.join(res.filePath, '.underleaf'), { recursive: true })
      await fs.writeFile(path.join(res.filePath, '.underleaf', 'settings.json'), JSON.stringify({ mainFile: 'main.tex', compiler: template.compiler }, null, 2))
    }
    return openProject(res.filePath)
  })
  ipcMain.handle('project:close', () => {
    runner.stop()
    texlab.stop()
    project?.close()
    project = null
    win?.setTitle('Underleaf')
    win?.setRepresentedFilename('')
  })
  ipcMain.handle('project:refresh', () => requireProject().info())
  ipcMain.handle('project:saveSettings', (_e, s: ProjectSettings) => requireProject().saveSettings(s))

  ipcMain.handle('fs:read', (_e, rel: string) => fs.readFile(requireProject().resolve(rel), 'utf8'))
  ipcMain.handle('fs:readBinary', async (_e, rel: string) => new Uint8Array(await fs.readFile(requireProject().resolve(rel))))
  ipcMain.handle('fs:write', async (_e, rel: string, content: string) => {
    const p = requireProject()
    p.markOwnWrite(rel)
    await fs.writeFile(p.resolve(rel), content, 'utf8')
  })
  ipcMain.handle('fs:createFile', async (_e, rel: string) => {
    const full = requireProject().resolve(rel)
    if (existsSync(full)) throw new Error(`"${rel}" already exists.`)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, '')
  })
  ipcMain.handle('fs:createFolder', async (_e, rel: string) => {
    const full = requireProject().resolve(rel)
    if (existsSync(full)) throw new Error(`"${rel}" already exists.`)
    await fs.mkdir(full, { recursive: true })
  })
  ipcMain.handle('fs:rename', async (_e, from: string, to: string) => {
    const p = requireProject()
    const dest = p.resolve(to)
    if (existsSync(dest)) throw new Error(`"${to}" already exists.`)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.rename(p.resolve(from), dest)
  })
  ipcMain.handle('fs:trash', (_e, rel: string) => shell.trashItem(requireProject().resolve(rel)))
  ipcMain.handle('fs:reveal', (_e, rel: string) => shell.showItemInFolder(requireProject().resolve(rel)))
  ipcMain.handle('fs:import', async (_e, targetDir: string, sources?: string[]) => {
    const p = requireProject()
    if (!sources) {
      const res = await dialog.showOpenDialog(win!, { title: 'Upload Files', buttonLabel: 'Add to Project', properties: ['openFile', 'multiSelections'] })
      if (res.canceled) return []
      sources = res.filePaths
    }
    const added: string[] = []
    for (const src of sources) {
      const dest = p.resolve(path.posix.join(targetDir, path.basename(src)))
      if (dest === src) continue
      await fs.cp(src, dest, { recursive: true })
      added.push(p.relative(dest))
    }
    return added
  })

  ipcMain.handle('compile:run', async (_e, activeFile?: string) => {
    const res = await runner.compile(requireProject(), activeFile)
    if (res.status !== 'cancelled') builtFile = res.mainFile
    return res
  })
  ipcMain.handle('compile:stop', () => runner.stop())
  ipcMain.handle('compile:clearCache', async () => {
    runner.stop()
    await fs.rm(requireProject().buildDir, { recursive: true, force: true })
  })
  ipcMain.handle('compile:readPdf', async () => {
    try {
      return new Uint8Array(await fs.readFile(pdfPath(requireProject())))
    } catch {
      return null
    }
  })
  ipcMain.handle('compile:openPdf', async () => {
    const err = await shell.openPath(pdfPath(requireProject()))
    if (err) throw new Error(err)
  })
  ipcMain.handle('compile:exportPdf', async () => {
    const p = requireProject()
    const src = pdfPath(p)
    if (!existsSync(src)) throw new Error('There is no PDF yet. Compile the project first.')
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export PDF',
      defaultPath: path.join(app.getPath('downloads'), `${p.name}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePath) return null
    await fs.copyFile(src, res.filePath)
    return res.filePath
  })
  ipcMain.handle('synctex:forward', (_e, rel: string, line: number, column: number) => {
    const p = requireProject()
    return forwardSearch(pdfPath(p), p.resolve(rel), line, column)
  })
  ipcMain.handle('synctex:inverse', async (_e, page: number, x: number, y: number) => {
    const p = requireProject()
    const hit = await inverseSearch(pdfPath(p), page, x, y)
    if (!hit) return null
    const rel = p.relative(hit.file)
    return rel.startsWith('..') ? null : { ...hit, file: rel }
  })

  ipcMain.handle('tools:wordCount', () => wordCount(requireProject()))
  ipcMain.handle('tools:search', (_e, opts: SearchOptions) => searchProject(requireProject(), opts))
  ipcMain.handle('tools:replaceAll', (_e, opts: SearchOptions, replacement: string) => replaceInProject(requireProject(), opts, replacement))
  ipcMain.handle('tools:symbols', () => projectSymbols(requireProject()))

  ipcMain.handle('git:status', () => gitStatus(requireProject().root))
  ipcMain.handle('git:init', () => gitInit(requireProject().root))
  ipcMain.handle('git:commit', (_e, message: string) => gitCommit(requireProject().root, message))
  ipcMain.handle('git:diff', (_e, rel: string) => gitDiff(requireProject().root, rel))
  ipcMain.handle('git:push', () => gitPush(requireProject().root))
  ipcMain.handle('git:pull', () => gitPull(requireProject().root))

  ipcMain.handle('lsp:start', (_e, opts: LspOptions) => texlab.start(requireProject().root, opts))
  ipcMain.on('lsp:send', (_e, message: string) => texlab.send(message))

  ipcMain.handle('spell:check', (_e, words: string[], lang: string | null) => spell.check(words, lang))
  ipcMain.handle('spell:suggest', (_e, word: string, lang: string | null) => spell.suggest(word, lang))
  ipcMain.handle('spell:learn', (_e, word: string) => spell.learn(word))
  ipcMain.handle('spell:detect', (_e, text: string) => spell.detect(text))
  ipcMain.handle('spell:languages', () => (spell.available ? spell.languages() : []))
  ipcMain.on('app:theme', (_e, theme: ThemePreference) => {
    nativeTheme.themeSource = theme
    win?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#161b22' : '#ffffff')
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    title: 'Underleaf',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Underleaf checks spelling itself (LaTeX-aware); Chromium's checker would flag every command.
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  // Links in the document or logs open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))

  scheduleDebugCapture()
}

/**
 * Developer aid: UNDERLEAF_CAPTURE=out.png saves a screenshot of the window and quits.
 * UNDERLEAF_CAPTURE_JS runs a script in the page first, to drive the UI in smoke tests.
 */
function scheduleDebugCapture(): void {
  const out = process.env.UNDERLEAF_CAPTURE
  if (!out || !win) return
  const delay = Number(process.env.UNDERLEAF_CAPTURE_DELAY ?? 6000)
  win.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') console.log(`[renderer ${e.level}]`, e.message)
  })
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const script = process.env.UNDERLEAF_CAPTURE_JS
      if (script) {
        const res = await win!.webContents.executeJavaScript(script).catch((e) => `script error: ${e}`)
        console.log('[capture-js]', JSON.stringify(res))
        await new Promise((r) => setTimeout(r, 1500))
      }
      const img = await win!.webContents.capturePage()
      await fs.writeFile(out, img.toPNG())
      app.quit()
    }, delay)
  })
}

app.on('open-file', (e, file) => {
  // Folders dropped on the Dock icon or opened via `open -a Underleaf <dir>`.
  e.preventDefault()
  if (win) {
    openProject(file).then(() => win?.webContents.send('menu', 'reload-project'))
  } else {
    pendingOpen = file
  }
})

app.whenReady().then(() => {
  app.setName('Underleaf')
  buildMenu()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  runner.stop()
  texlab.stop()
  spell.stop()
  project?.close()
  app.quit()
})
