import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompileResult, FileNode, LogEntry, MenuCommand, ProjectInfo, ProjectSettings } from '@shared/types'
import { EditorManager } from '../editor/manager'
import { load, save } from '../storage'
import { ContextMenu, type MenuItem, type MenuRequest } from './ContextMenu'
import { ConfirmDialog, errorMessage, PromptDialog, SettingsDialog, type ConfirmRequest, type PromptRequest } from './Dialogs'
import { BINARY_EXT, EditorPane, IMAGE_EXT } from './EditorPane'
import { FileTree, parentDir } from './FileTree'
import { HomeIcon, LeafIcon, SettingsIcon } from './icons'
import { PdfPane, type ZoomRequest } from './PdfPane'
import { Splitter } from './Splitter'

const api = window.underleaf
const AUTOSAVE_MS = 1000
const SPLITTER_W = 5

interface Props {
  initial: ProjectInfo
  /** Called after unsaved work is flushed; the parent decides what replaces the workspace. */
  onLeave: (next: 'home' | 'open' | 'new') => void
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

function treeHas(nodes: FileNode[], path: string): boolean {
  for (const n of nodes) {
    if (n.path === path) return true
    if (n.children && path.startsWith(n.path + '/') && treeHas(n.children, path)) return true
  }
  return false
}

export function Workspace({ initial, onLeave }: Props) {
  const [info, setInfo] = useState(initial)
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [compiling, setCompiling] = useState(false)
  const [result, setResult] = useState<CompileResult | null>(null)
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [zoomRequest, setZoomRequest] = useState<ZoomRequest | null>(null)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [menu, setMenu] = useState<MenuRequest | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [sidebarW, setSidebarW] = useState(() => load('sidebarWidth', 230))
  const [editorFrac, setEditorFrac] = useState(() => load('editorFraction', 0.5))

  const bodyRef = useRef<HTMLDivElement>(null)
  const compilingRef = useRef(false)
  const pendingCompile = useRef(false)
  const autosaveTimer = useRef<number | undefined>(undefined)
  const resultRef = useRef<CompileResult | null>(null)
  const tabsRef = useRef<string[]>([])
  tabsRef.current = tabs
  const activeRef = useRef<string | null>(null)
  activeRef.current = active

  // The editor callbacks are created once, so they go through this ref to reach the latest closures.
  const actions = useRef({ saveAndCompile: () => {}, compile: () => {}, scheduleAutosave: () => {} })

  const manager = useMemo(
    () =>
      new EditorManager({
        onChange: (path, isDirty) => {
          setDirty((prev) => {
            if (prev.has(path) === isDirty) return prev
            const next = new Set(prev)
            if (isDirty) next.add(path)
            else next.delete(path)
            return next
          })
          if (isDirty) actions.current.scheduleAutosave()
        },
        onSave: () => actions.current.saveAndCompile(),
        onCompile: () => actions.current.compile()
      }),
    []
  )

  const showError = useCallback((err: unknown) => {
    setToast(errorMessage(err))
    window.setTimeout(() => setToast(null), 6000)
  }, [])

  const saveAll = useCallback(async () => {
    window.clearTimeout(autosaveTimer.current)
    for (const path of manager.dirtyPaths()) {
      const content = manager.content(path)!
      try {
        await api.writeFile(path, content)
        manager.markSaved(path, content)
      } catch (err) {
        showError(err)
      }
    }
    setDirty(new Set(manager.dirtyPaths()))
  }, [manager, showError])

  const compile = useCallback(async () => {
    if (compilingRef.current) {
      pendingCompile.current = true
      return
    }
    compilingRef.current = true
    setCompiling(true)
    try {
      await saveAll()
      const res = await api.compile()
      resultRef.current = res
      setResult(res)
      manager.applyDiagnostics(res.entries)
      if (res.hasPdf) setPdf(await api.readPdf())
      else if (res.status !== 'cancelled') {
        setPdf(null)
        setShowLogs(true)
      }
    } catch (err) {
      showError(err)
    } finally {
      compilingRef.current = false
      setCompiling(false)
      if (pendingCompile.current) {
        pendingCompile.current = false
        void compile()
      }
    }
  }, [manager, saveAll, showError])

  actions.current = {
    saveAndCompile: () => void compile(),
    compile: () => void compile(),
    scheduleAutosave: () => {
      window.clearTimeout(autosaveTimer.current)
      autosaveTimer.current = window.setTimeout(() => void saveAll(), AUTOSAVE_MS)
    }
  }

  const refresh = useCallback(async () => {
    const next = await api.refreshProject()
    setInfo(next)
    return next
  }, [])

  const openFile = useCallback(
    async (path: string) => {
      try {
        if (IMAGE_EXT.test(path) || BINARY_EXT.test(path)) {
          manager.deactivate()
        } else if (manager.has(path)) {
          manager.activate(path)
        } else {
          manager.open(path, await api.readFile(path))
          manager.diagnosticsFor(path, resultRef.current?.entries ?? [])
        }
        setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
        setActive(path)
      } catch (err) {
        showError(err)
      }
    },
    [manager, showError]
  )

  const closeTabs = useCallback(
    async (paths: string[], { save: shouldSave = true } = {}) => {
      if (paths.length === 0) return
      if (shouldSave) await saveAll()
      for (const p of paths) manager.close(p)
      const current = tabsRef.current
      const remaining = current.filter((t) => !paths.includes(t))
      setTabs(remaining)
      const prevActive = activeRef.current
      if (prevActive && !paths.includes(prevActive)) return
      const idx = prevActive ? current.indexOf(prevActive) : -1
      const neighbour = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)]
      if (neighbour) await openFile(neighbour)
      else setActive(null)
    },
    [manager, openFile, saveAll]
  )

  const jumpTo = useCallback(
    async (entry: LogEntry) => {
      if (!entry.file) return
      await openFile(entry.file)
      if (entry.line) manager.goToLine(entry.line)
    },
    [manager, openFile]
  )

  const saveSettings = useCallback(
    async (s: ProjectSettings) => {
      const saved = await api.saveSettings(s)
      setInfo((prev) => ({ ...prev, settings: saved }))
      void compile()
    },
    [compile]
  )

  const leave = useCallback(
    async (next: 'home' | 'open' | 'new') => {
      await saveAll()
      onLeave(next)
    },
    [onLeave, saveAll]
  )

  // ---- File operations -------------------------------------------------------------------

  const newFile = (dir: string) =>
    setPrompt({
      title: 'New file',
      label: dir ? `File name (in ${dir}/)` : 'File name',
      initial: 'untitled.tex',
      confirmLabel: 'Create',
      selectStem: true,
      onSubmit: async (name) => {
        const path = joinPath(dir, name)
        await api.createFile(path)
        await refresh()
        await openFile(path)
      }
    })

  const newFolder = (dir: string) =>
    setPrompt({
      title: 'New folder',
      label: dir ? `Folder name (in ${dir}/)` : 'Folder name',
      initial: 'figures',
      confirmLabel: 'Create',
      onSubmit: async (name) => {
        await api.createFolder(joinPath(dir, name))
        await refresh()
      }
    })

  const upload = async (dir: string) => {
    try {
      const added = await api.importFiles(dir)
      if (added.length) await refresh()
    } catch (err) {
      showError(err)
    }
  }

  const movePath = async (from: string, to: string) => {
    await saveAll()
    await api.renamePath(from, to)
    // Carry open tabs (including everything inside a moved folder) over to the new path.
    const remap = (p: string) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
    for (const t of tabsRef.current) if (remap(t) !== t) manager.rename(t, remap(t))
    setTabs((prev) => prev.map(remap))
    setActive((prev) => (prev ? remap(prev) : prev))
    if (remap(info.settings.mainFile) !== info.settings.mainFile) {
      await saveSettings({ ...info.settings, mainFile: remap(info.settings.mainFile) })
    }
    await refresh()
  }

  const rename = (node: FileNode) =>
    setPrompt({
      title: `Rename ${node.type === 'dir' ? 'folder' : 'file'}`,
      label: 'New name',
      initial: node.name,
      confirmLabel: 'Rename',
      selectStem: node.type === 'file',
      onSubmit: async (name) => {
        if (name.includes('/')) throw new Error('Names cannot contain "/". Drag the file onto a folder to move it.')
        if (name !== node.name) await movePath(node.path, joinPath(parentDir(node.path), name))
      }
    })

  const remove = (node: FileNode) =>
    setConfirm({
      title: `Delete ${node.type === 'dir' ? 'folder' : 'file'}`,
      message: (
        <p>
          Move <b>{node.path}</b> to the Trash? You can restore it from the Trash in Finder.
        </p>
      ),
      confirmLabel: 'Move to Trash',
      danger: true,
      onConfirm: async () => {
        await api.trashPath(node.path)
        await closeTabs(
          tabsRef.current.filter((t) => t === node.path || t.startsWith(node.path + '/')),
          { save: false }
        )
        await refresh()
      }
    })

  const dropExternal = async (dir: string, files: File[]) => {
    try {
      const sources = files.map((f) => api.getPathForFile(f)).filter(Boolean)
      const added = await api.importFiles(dir, sources)
      if (added.length) await refresh()
    } catch (err) {
      showError(err)
    }
  }

  const openContextMenu = (node: FileNode | null, x: number, y: number) => {
    const dir = node ? (node.type === 'dir' ? node.path : parentDir(node.path)) : ''
    const items: MenuItem[] = []
    if (node?.type === 'file' && node.path.endsWith('.tex') && node.path !== info.settings.mainFile) {
      items.push({ label: 'Set as main document', onSelect: () => void saveSettings({ ...info.settings, mainFile: node.path }) })
    }
    items.push(
      { label: 'New file…', onSelect: () => newFile(dir), separatorBefore: items.length > 0 },
      { label: 'New folder…', onSelect: () => newFolder(dir) },
      { label: 'Upload files…', onSelect: () => void upload(dir) }
    )
    if (node) {
      items.push(
        { label: 'Rename…', onSelect: () => rename(node), separatorBefore: true },
        { label: 'Show in Finder', onSelect: () => void api.revealInFinder(node.path) },
        { label: 'Delete…', onSelect: () => remove(node), danger: true, separatorBefore: true }
      )
    }
    setMenu({ x, y, items })
  }

  // ---- Lifecycle -------------------------------------------------------------------------

  useEffect(() => {
    // Restore the tabs from the last session, or start with the main document.
    const saved = load<string[]>(`tabs:${initial.root}`, []).filter((t) => treeHas(initial.tree, t))
    const activeSaved = load<string | null>(`active:${initial.root}`, null)
    const toOpen = saved.length ? saved : treeHas(initial.tree, initial.settings.mainFile) ? [initial.settings.mainFile] : []
    ;(async () => {
      for (const t of toOpen) await openFile(t)
      const first = activeSaved && toOpen.includes(activeSaved) ? activeSaved : toOpen[0]
      if (first) await openFile(first)
    })()
    void compile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    save(`tabs:${info.root}`, tabs)
    save(`active:${info.root}`, active)
  }, [info.root, tabs, active])

  useEffect(() => save('sidebarWidth', sidebarW), [sidebarW])
  useEffect(() => save('editorFraction', editorFrac), [editorFrac])

  useEffect(
    () =>
      api.onFsChange(async (e) => {
        if (e.kind === 'file') {
          if (manager.has(e.path)) manager.reloadFromDisk(e.path, await api.readFile(e.path).catch(() => ''))
          return
        }
        const next = await refresh()
        // Editors that save atomically only produce "rename" events, so re-read open files too.
        const gone: string[] = []
        for (const t of tabsRef.current) {
          if (!treeHas(next.tree, t)) {
            if (!manager.isDirty(t)) gone.push(t)
          } else if (manager.has(t)) {
            const content = await api.readFile(t).catch(() => null)
            if (content !== null) manager.reloadFromDisk(t, content)
          }
        }
        if (gone.length) await closeTabs(gone, { save: false })
      }),
    [closeTabs, manager, refresh]
  )

  useEffect(
    () =>
      api.onMenu((cmd: MenuCommand) => {
        switch (cmd) {
          case 'compile':
          case 'save':
            void compile()
            break
          case 'new-file':
            newFile(active ? parentDir(active) : '')
            break
          case 'settings':
            setSettingsOpen(true)
            break
          case 'toggle-logs':
            setShowLogs((v) => !v)
            break
          case 'zoom-in':
          case 'zoom-out':
          case 'zoom-fit':
            setZoomRequest((z) => ({ kind: cmd.slice(5) as ZoomRequest['kind'], seq: (z?.seq ?? 0) + 1 }))
            break
          case 'close-project':
            void leave('home')
            break
          case 'open-project':
            void leave('open')
            break
          case 'new-project':
            void leave('new')
            break
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, compile, leave]
  )

  useEffect(() => {
    // Flush pending edits before the window closes.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (manager.dirtyPaths().length === 0) return
      e.preventDefault()
      e.returnValue = false
      void saveAll().then(() => window.close())
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [manager, saveAll])

  // ---- Layout ------------------------------------------------------------------------------

  const dragSidebar = useCallback((x: number) => {
    const left = bodyRef.current?.getBoundingClientRect().left ?? 0
    setSidebarW(Math.min(480, Math.max(150, x - left)))
  }, [])

  const dragEditor = useCallback(
    (x: number) => {
      const rect = bodyRef.current?.getBoundingClientRect()
      if (!rect) return
      const avail = rect.width - sidebarW - SPLITTER_W * 2
      setEditorFrac(Math.min(0.85, Math.max(0.15, (x - rect.left - sidebarW - SPLITTER_W) / avail)))
    },
    [sidebarW]
  )

  return (
    <div className="workspace">
      <header className="titlebar">
        <div className="titlebar-left">
          <button className="titlebar-btn" title="All projects" onClick={() => void leave('home')}>
            <HomeIcon size={16} />
          </button>
          <button className="titlebar-btn" title="Project settings (⌘,)" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={16} />
          </button>
        </div>
        <div className="titlebar-title">
          <LeafIcon size={15} />
          <span>{info.name}</span>
        </div>
        <div className="titlebar-right">
          <span className="titlebar-meta">
            {info.settings.mainFile} · {{ pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' }[info.settings.compiler]}
          </span>
        </div>
      </header>

      <div className="workspace-body" ref={bodyRef} style={{ gridTemplateColumns: `${sidebarW}px ${SPLITTER_W}px ${editorFrac}fr ${SPLITTER_W}px ${1 - editorFrac}fr` }}>
        <FileTree
          tree={info.tree}
          activePath={active}
          mainFile={info.settings.mainFile}
          dirty={dirty}
          onOpen={(p) => void openFile(p)}
          onContextMenu={openContextMenu}
          onNewFile={newFile}
          onNewFolder={newFolder}
          onUpload={(d) => void upload(d)}
          onMove={(from, toDir) => void movePath(from, joinPath(toDir, from.split('/').pop()!)).catch(showError)}
          onDropExternal={(d, files) => void dropExternal(d, files)}
        />
        <Splitter onDrag={dragSidebar} onDoubleClick={() => setSidebarW(230)} />
        <EditorPane
          manager={manager}
          tabs={tabs}
          active={active}
          dirty={dirty}
          onSelect={(p) => void openFile(p)}
          onClose={(p) => void closeTabs([p])}
          onReveal={(p) => void api.revealInFinder(p)}
        />
        <Splitter onDrag={dragEditor} onDoubleClick={() => setEditorFrac(0.5)} />
        <PdfPane
          pdf={pdf}
          compiling={compiling}
          result={result}
          showLogs={showLogs}
          zoomRequest={zoomRequest}
          onCompile={() => void compile()}
          onStop={() => void api.stopCompile()}
          onToggleLogs={() => setShowLogs((v) => !v)}
          onJump={(e) => void jumpTo(e)}
          onOpenExternal={() => void api.openPdfExternally().catch(showError)}
        />
      </div>

      {prompt && <PromptDialog req={prompt} onClose={() => setPrompt(null)} />}
      {confirm && <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />}
      {menu && <ContextMenu req={menu} onClose={() => setMenu(null)} />}
      {settingsOpen && (
        <SettingsDialog settings={info.settings} texFiles={info.texFiles} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />
      )}
      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
