import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { promises as fs, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { MenuCommand, ProjectInfo, ProjectSettings, RecentProject } from '@shared/types'
import { CompileRunner } from './compiler'
import { BLANK_DOCUMENT, Project } from './project'

let win: BrowserWindow | null = null
let project: Project | null = null
let pendingOpen: string | null = initialProjectFromArgs()
const runner = new CompileRunner()

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
  const p = new Project(root)
  await p.load()
  project = p
  p.watch((e) => win?.webContents.send('fs:change', e))
  await addRecent(p)
  win?.setTitle(`${p.name} — Underleaf`)
  win?.setRepresentedFilename(p.root)
  return p.info()
}

function pdfPath(p: Project): string {
  const job = path.basename(p.settings.mainFile, path.extname(p.settings.mainFile))
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
        { label: 'Project Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings') },
        { label: 'Close Project', accelerator: 'CmdOrCtrl+Shift+W', click: () => sendMenu('close-project') }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Logs', accelerator: 'CmdOrCtrl+L', click: () => sendMenu('toggle-logs') },
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
      submenu: [{ label: 'Recompile', accelerator: 'CmdOrCtrl+Enter', click: () => sendMenu('compile') }]
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
  ipcMain.handle('project:newDialog', async () => {
    const res = await dialog.showSaveDialog(win!, {
      title: 'New LaTeX Project',
      buttonLabel: 'Create Project',
      nameFieldLabel: 'Project name:',
      defaultPath: path.join(app.getPath('documents'), 'Untitled Project')
    })
    if (res.canceled || !res.filePath) return null
    if (existsSync(res.filePath)) throw new Error(`"${path.basename(res.filePath)}" already exists.`)
    await fs.mkdir(res.filePath, { recursive: true })
    await fs.writeFile(path.join(res.filePath, 'main.tex'), BLANK_DOCUMENT)
    return openProject(res.filePath)
  })
  ipcMain.handle('project:close', () => {
    runner.stop()
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

  ipcMain.handle('compile:run', () => runner.compile(requireProject()))
  ipcMain.handle('compile:stop', () => runner.stop())
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
      sandbox: true
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
  project?.close()
  app.quit()
})
