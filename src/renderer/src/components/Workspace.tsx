import { findReferences, jumpToDefinition, renameSymbol, serverCompletionSource } from '@codemirror/lsp-client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findOutline, type OutlineItem } from '@shared/texScan'
import type { CompileResult, Compiler, FileNode, LogEntry, LspStatus, MenuCommand, ProjectInfo, ProjectSettings, ProjectSymbols } from '@shared/types'
import { fallbackSource, snippetSource } from '../editor/completions'
import { EditorManager } from '../editor/manager'
import { forgetWord, ignoreWord, misspelledWordAt, proseSample } from '../editor/spell'
import { TexlabClient } from '../lsp/texlab'
import { getPrefs, setPrefs, type Prefs } from '../prefs'
import { load, save } from '../storage'
import { ContextMenu, type MenuItem, type MenuRequest } from './ContextMenu'
import { ConfirmDialog, DiffDialog, errorMessage, PromptDialog, SettingsDialog, WordCountDialog, type ConfirmRequest, type PromptRequest } from './Dialogs'
import { BINARY_EXT, EditorPane, IMAGE_EXT } from './EditorPane'
import { FileTree, parentDir } from './FileTree'
import { GitPanel } from './GitPanel'
import { FilesIcon, GitIcon, HomeIcon, LeafIcon, SearchIcon, SettingsIcon, TextIcon } from './icons'
import { Outline } from './Outline'
import { PdfPane, type SyncRequest, type ZoomRequest } from './PdfPane'
import { SearchPanel } from './SearchPanel'
import { Splitter } from './Splitter'

const api = window.underleaf
const AUTOSAVE_MS = 1000
const SPLITTER_W = 5

type SidebarTab = 'files' | 'search' | 'git'

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
  const [syncRequest, setSyncRequest] = useState<SyncRequest | null>(null)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [menu, setMenu] = useState<MenuRequest | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [wordCountOpen, setWordCountOpen] = useState(false)
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [sidebarW, setSidebarW] = useState(() => load('sidebarWidth', 240))
  const [editorFrac, setEditorFrac] = useState(() => load('editorFraction', 0.5))
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(() => load('sidebarTab', 'files'))
  const [outlineOpen, setOutlineOpen] = useState(() => load('outlineOpen', true))
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [cursorLine, setCursorLine] = useState(1)
  const [searchFocus, setSearchFocus] = useState(0)
  const [gitRefresh, setGitRefresh] = useState(0)
  const [lspStatus, setLspStatus] = useState<LspStatus>({ available: false, error: 'Starting texlab…' })

  const bodyRef = useRef<HTMLDivElement>(null)
  const compilingRef = useRef(false)
  const pendingCompile = useRef(false)
  const autosaveTimer = useRef<number | undefined>(undefined)
  const outlineTimer = useRef<number | undefined>(undefined)
  const resultRef = useRef<CompileResult | null>(null)
  const symbolsRef = useRef<ProjectSymbols | null>(null)
  // Detected spelling language per open file (when the preference is "auto").
  const spellLangs = useRef(new Map<string, string | null>())
  const texlabRef = useRef<TexlabClient | null>(null)
  const tabsRef = useRef<string[]>([])
  tabsRef.current = tabs
  const activeRef = useRef<string | null>(null)
  activeRef.current = active

  // The editor callbacks are created once, so they go through this ref to reach the latest closures.
  const actions = useRef({
    compile: () => {},
    scheduleAutosave: () => {},
    syncToPdf: () => {},
    contextMenu: (_pos: number, _x: number, _y: number) => {},
    outlineChanged: () => {}
  })

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
          actions.current.outlineChanged()
        },
        onCursor: (_path, line) => setCursorLine(line),
        onContextMenu: (pos, x, y) => actions.current.contextMenu(pos, x, y),
        onSave: () => actions.current.compile(),
        onCompile: () => actions.current.compile(),
        onSyncToPdf: () => actions.current.syncToPdf(),
        completionSources: () =>
          texlabRef.current?.active ? [snippetSource, serverCompletionSource] : [snippetSource, fallbackSource(() => symbolsRef.current)],
        spellEnabled: () => getPrefs().spellCheck,
        spellLanguage: () => {
          const pref = getPrefs().spellLanguage
          if (pref !== 'auto') return pref
          const path = activeRef.current
          return path && spellLangs.current.has(path) ? spellLangs.current.get(path) : undefined
        }
      }),
    []
  )

  // Lets scripted smoke tests (UNDERLEAF_CAPTURE_JS) reach the editor.
  useEffect(() => {
    Object.assign(window, { __underleaf: { view: manager.view } })
  }, [manager])

  const relPath = useCallback((abs: string) => (abs.startsWith(initial.root + '/') ? abs.slice(initial.root.length + 1) : null), [initial.root])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 5000)
  }, [])

  const showError = useCallback((err: unknown) => notify(errorMessage(err)), [notify])

  const refreshSymbols = useCallback(async () => {
    // Only the fallback completion needs this; texlab indexes the project itself.
    if (texlabRef.current?.active) return
    symbolsRef.current = await api.getSymbols().catch(() => symbolsRef.current)
  }, [])

  const saveAll = useCallback(async () => {
    window.clearTimeout(autosaveTimer.current)
    const paths = manager.dirtyPaths()
    for (const path of paths) {
      const content = manager.content(path)!
      try {
        await api.writeFile(path, content)
        manager.markSaved(path, content)
      } catch (err) {
        showError(err)
      }
    }
    setDirty(new Set(manager.dirtyPaths()))
    if (paths.length) {
      void refreshSymbols()
      // The file watcher ignores the app's own writes, so tell the git panel directly.
      setGitRefresh((n) => n + 1)
    }
  }, [manager, refreshSymbols, showError])

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
      manager.applyCompileDiagnostics(res.entries)
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

  const openAt = useCallback(
    async (file: string, line?: number, column?: number, length?: number) => {
      await openFile(file)
      if (line) manager.goToLine(line, column, length)
    },
    [manager, openFile]
  )

  const jumpTo = useCallback((entry: LogEntry) => entry.file && void openAt(entry.file, entry.line), [openAt])

  // ---- SyncTeX -----------------------------------------------------------------------------

  const syncToPdf = useCallback(async () => {
    const path = activeRef.current
    const cur = manager.cursor()
    if (!path || !cur || !path.endsWith('.tex')) return
    try {
      const boxes = await api.syncForward(path, cur.line, cur.column)
      if (!boxes.length) {
        notify('No matching place in the PDF. Recompile and try again.')
        return
      }
      setShowLogs(false)
      setSyncRequest((r) => ({ boxes, seq: (r?.seq ?? 0) + 1 }))
    } catch (err) {
      showError(err)
    }
  }, [manager, notify, showError])

  const syncToCode = useCallback(
    async (page: number, x: number, y: number) => {
      try {
        const hit = await api.syncInverse(page, x, y)
        if (hit) await openAt(hit.file, hit.line)
        else notify('No matching source line for this spot.')
      } catch (err) {
        showError(err)
      }
    },
    [notify, openAt, showError]
  )

  // ---- Settings ----------------------------------------------------------------------------

  const saveProjectSettings = useCallback(
    async (s: ProjectSettings) => {
      const saved = await api.saveSettings(s)
      setInfo((prev) => ({ ...prev, settings: saved }))
      void compile()
    },
    [compile]
  )

  const saveAllSettings = useCallback(
    async (s: ProjectSettings, prefs: Prefs) => {
      const before = getPrefs()
      setPrefs(prefs)
      if (before.spellCheck !== prefs.spellCheck || before.spellLanguage !== prefs.spellLanguage) manager.refreshSpelling()
      if (before.styleHints !== prefs.styleHints) void texlabRef.current?.reconfigure({ chktex: prefs.styleHints })
      if (s.mainFile !== info.settings.mainFile || s.compiler !== info.settings.compiler) await saveProjectSettings(s)
    },
    [info.settings, manager, saveProjectSettings]
  )

  const clearCache = useCallback(async () => {
    await api.clearCache()
    void compile()
  }, [compile])

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
      await saveProjectSettings({ ...info.settings, mainFile: remap(info.settings.mainFile) })
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

  const treeContextMenu = (node: FileNode | null, x: number, y: number) => {
    const dir = node ? (node.type === 'dir' ? node.path : parentDir(node.path)) : ''
    const items: MenuItem[] = []
    if (node?.type === 'file' && node.path.endsWith('.tex') && node.path !== info.settings.mainFile) {
      items.push({ label: 'Set as main document', onSelect: () => void saveProjectSettings({ ...info.settings, mainFile: node.path }) })
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

  const editorContextMenu = async (pos: number, x: number, y: number) => {
    const view = manager.view
    const items: MenuItem[] = []
    const pref = getPrefs().spellLanguage
    const lang = pref === 'auto' ? (spellLangs.current.get(activeRef.current ?? '') ?? null) : pref
    const typo = getPrefs().spellCheck && activeRef.current?.endsWith('.tex') ? misspelledWordAt(view, pos, lang) : null
    const suggestions = typo ? (await api.spellSuggest(typo.word, lang).catch(() => [])).slice(0, 6) : []
    if (typo) {
      for (const s of suggestions) {
        items.push({ label: s, onSelect: () => view.dispatch({ changes: { from: typo.from, to: typo.to, insert: s }, selection: { anchor: typo.from + s.length } }) })
      }
      if (!suggestions.length) items.push({ label: 'No spelling suggestions', onSelect: () => {}, disabled: true })
      items.push(
        {
          label: `Add “${typo.word}” to dictionary`,
          separatorBefore: true,
          onSelect: async () => {
            await api.spellLearn(typo.word)
            forgetWord(typo.word)
            manager.refreshSpelling()
          }
        },
        {
          label: 'Ignore for this session',
          onSelect: () => {
            ignoreWord(typo.word)
            manager.refreshSpelling()
          }
        }
      )
    }
    const sel = view.state.selection.main
    items.push(
      {
        label: 'Cut',
        separatorBefore: items.length > 0,
        disabled: sel.empty,
        onSelect: () => {
          void navigator.clipboard.writeText(view.state.sliceDoc(sel.from, sel.to))
          view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' } })
        }
      },
      { label: 'Copy', disabled: sel.empty, onSelect: () => void navigator.clipboard.writeText(view.state.sliceDoc(sel.from, sel.to)) },
      {
        label: 'Paste',
        onSelect: async () => {
          const text = await navigator.clipboard.readText()
          view.dispatch(view.state.replaceSelection(text))
          view.focus()
        }
      }
    )
    if (activeRef.current?.endsWith('.tex')) {
      items.push({ label: 'Show in PDF', separatorBefore: true, onSelect: () => void syncToPdf() })
      if (texlabRef.current?.active) {
        items.push(
          { label: 'Go to definition', onSelect: () => jumpToDefinition(view) },
          { label: 'Find references', onSelect: () => findReferences(view) },
          { label: 'Rename symbol…', onSelect: () => renameSymbol(view) }
        )
      }
    }
    setMenu({ x, y, items })
  }

  actions.current = {
    compile: () => void compile(),
    scheduleAutosave: () => {
      window.clearTimeout(autosaveTimer.current)
      autosaveTimer.current = window.setTimeout(() => void (getPrefs().autoCompile ? compile() : saveAll()), AUTOSAVE_MS)
    },
    syncToPdf: () => void syncToPdf(),
    contextMenu: (pos, x, y) => void editorContextMenu(pos, x, y),
    outlineChanged: () => {
      window.clearTimeout(outlineTimer.current)
      outlineTimer.current = window.setTimeout(() => {
        const path = activeRef.current
        setOutline(path?.endsWith('.tex') ? findOutline(manager.content(path) ?? '') : [])
      }, 300)
    }
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

    const texlab = new TexlabClient(
      initial.root,
      (abs, diagnostics) => {
        const rel = relPath(abs)
        if (rel) manager.applyLspDiagnostics(rel, diagnostics)
      },
      async (abs) => {
        const rel = relPath(abs)
        if (!rel) return null
        await openFile(rel)
        return manager.view
      }
    )
    texlabRef.current = texlab
    texlab.start({ chktex: getPrefs().styleHints }).then((status) => {
      setLspStatus(status)
      if (status.available) manager.setLanguageServer((path) => texlab.extensionFor(`${initial.root}/${path}`))
      else void refreshSymbols()
    })
    return () => {
      texlab.stop()
      manager.setLanguageServer(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    actions.current.outlineChanged()
    // Detect the language of a newly opened document once, for spell checking.
    if (active?.endsWith('.tex') && !spellLangs.current.has(active) && getPrefs().spellLanguage === 'auto') {
      const sample = proseSample(manager.content(active) ?? '')
      api
        .spellDetect(sample)
        .catch(() => null)
        .then((lang) => {
          spellLangs.current.set(active, sample.split(' ').length >= 5 ? lang : null)
          if (activeRef.current === active) manager.refreshSpelling()
        })
    }
  }, [active, manager])

  useEffect(() => {
    save(`tabs:${info.root}`, tabs)
    save(`active:${info.root}`, active)
  }, [info.root, tabs, active])

  useEffect(() => save('sidebarWidth', sidebarW), [sidebarW])
  useEffect(() => save('editorFraction', editorFrac), [editorFrac])
  useEffect(() => save('sidebarTab', sidebarTab), [sidebarTab])
  useEffect(() => save('outlineOpen', outlineOpen), [outlineOpen])

  useEffect(
    () =>
      api.onFsChange(async (e) => {
        if (e.kind === 'file') {
          if (manager.has(e.path)) manager.reloadFromDisk(e.path, await api.readFile(e.path).catch(() => ''))
          setGitRefresh((n) => n + 1)
          return
        }
        const next = await refresh()
        setGitRefresh((n) => n + 1)
        void refreshSymbols()
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
    [closeTabs, manager, refresh, refreshSymbols]
  )

  const exportPdf = useCallback(async () => {
    try {
      const dest = await api.exportPdf()
      if (dest) notify(`Saved ${dest.split('/').pop()}`)
    } catch (err) {
      showError(err)
    }
  }, [notify, showError])

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
          case 'toggle-outline':
            setSidebarTab('files')
            setOutlineOpen((v) => !v)
            break
          case 'search':
            setSidebarTab('search')
            setSearchFocus((n) => n + 1)
            break
          case 'git':
            setSidebarTab('git')
            break
          case 'word-count':
            void saveAll().then(() => setWordCountOpen(true))
            break
          case 'export-pdf':
            void exportPdf()
            break
          case 'sync-to-pdf':
            void syncToPdf()
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
    [active, compile, leave, exportPdf, syncToPdf]
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
    setSidebarW(Math.min(520, Math.max(170, x - left)))
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

  const sidebarButton = (tab: SidebarTab, Icon: typeof FilesIcon, title: string) => (
    <button
      className={`sidebar-tab${sidebarTab === tab ? ' active' : ''}`}
      title={title}
      aria-pressed={sidebarTab === tab}
      onClick={() => {
        setSidebarTab(tab)
        if (tab === 'search') setSearchFocus((n) => n + 1)
        if (tab === 'git') setGitRefresh((n) => n + 1)
      }}
    >
      <Icon size={17} />
    </button>
  )

  return (
    <div className="workspace">
      <header className="titlebar">
        <div className="titlebar-left">
          <button className="titlebar-btn" title="All projects" onClick={() => void leave('home')}>
            <HomeIcon size={16} />
          </button>
          <button className="titlebar-btn" title="Settings (⌘,)" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={16} />
          </button>
          <button className="titlebar-btn" title="Word count (⇧⌘C)" onClick={() => void saveAll().then(() => setWordCountOpen(true))}>
            <TextIcon size={16} />
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
        <aside className="sidebar">
          <nav className="sidebar-tabs">
            {sidebarButton('files', FilesIcon, 'Files and outline')}
            {sidebarButton('search', SearchIcon, 'Search project (⇧⌘F)')}
            {sidebarButton('git', GitIcon, 'Source control (⇧⌘G)')}
          </nav>
          <div className="sidebar-content" style={{ display: sidebarTab === 'files' ? 'flex' : 'none' }}>
            <FileTree
              tree={info.tree}
              activePath={active}
              mainFile={info.settings.mainFile}
              dirty={dirty}
              onOpen={(p) => void openFile(p)}
              onContextMenu={treeContextMenu}
              onNewFile={newFile}
              onNewFolder={newFolder}
              onUpload={(d) => void upload(d)}
              onMove={(from, toDir) => void movePath(from, joinPath(toDir, from.split('/').pop()!)).catch(showError)}
              onDropExternal={(d, files) => void dropExternal(d, files)}
            />
            <Outline items={outline} currentLine={cursorLine} open={outlineOpen} onToggle={() => setOutlineOpen((v) => !v)} onJump={(line) => manager.goToLine(line)} />
          </div>
          {sidebarTab === 'search' && (
            <div className="sidebar-content">
              <SearchPanel
                focusSeq={searchFocus}
                beforeSearch={saveAll}
                onOpenMatch={(file, line, column, length) => void openAt(file, line, column, length)}
                onReplaced={async (files) => {
                  for (const f of files) if (manager.has(f)) manager.reloadFromDisk(f, await api.readFile(f))
                  notify(`Replaced in ${files.length} file${files.length === 1 ? '' : 's'}.`)
                }}
                confirmReplace={(count, files, run) =>
                  setConfirm({
                    title: 'Replace all',
                    message: (
                      <p>
                        Replace {count} match{count === 1 ? '' : 'es'} in {files} file{files === 1 ? '' : 's'}? Use git or Undo in each file to revert.
                      </p>
                    ),
                    confirmLabel: 'Replace all',
                    onConfirm: run
                  })
                }
              />
            </div>
          )}
          {sidebarTab === 'git' && (
            <div className="sidebar-content">
              <GitPanel refreshSeq={gitRefresh} beforeCommit={saveAll} onShowDiff={setDiffPath} onNotify={notify} />
            </div>
          )}
        </aside>
        <Splitter onDrag={dragSidebar} onDoubleClick={() => setSidebarW(240)} />
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
          syncRequest={syncRequest}
          compiler={info.settings.compiler}
          onCompile={() => void compile()}
          onStop={() => void api.stopCompile()}
          onClearCache={() => void clearCache()}
          onSetCompiler={(c: Compiler) => void saveProjectSettings({ ...info.settings, compiler: c })}
          onToggleLogs={() => setShowLogs((v) => !v)}
          onJump={jumpTo}
          onOpenExternal={() => void api.openPdfExternally().catch(showError)}
          onSyncToPdf={() => void syncToPdf()}
          onSyncToCode={(page, x, y) => void syncToCode(page, x, y)}
        />
      </div>

      {prompt && <PromptDialog req={prompt} onClose={() => setPrompt(null)} />}
      {confirm && <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />}
      {menu && <ContextMenu req={menu} onClose={() => setMenu(null)} />}
      {settingsOpen && (
        <SettingsDialog settings={info.settings} texFiles={info.texFiles} lspStatus={lspStatus} onSave={saveAllSettings} onClose={() => setSettingsOpen(false)} />
      )}
      {wordCountOpen && <WordCountDialog onClose={() => setWordCountOpen(false)} />}
      {diffPath && <DiffDialog path={diffPath} onClose={() => setDiffPath(null)} />}
      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
