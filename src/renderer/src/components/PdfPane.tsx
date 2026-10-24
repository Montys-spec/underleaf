import { useEffect, useRef, useState } from 'react'
import type { CompileResult, Compiler, LogEntry, SyncTexBox } from '@shared/types'
import { PdfRenderer } from '../pdf/PdfRenderer'
import { setPrefs, usePrefs } from '../prefs'
import { LogPanel } from './LogPanel'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, ExternalIcon, FitIcon, LogIcon, RecompileIcon, StopIcon, ZoomInIcon, ZoomOutIcon } from './icons'

export type ZoomRequest = { kind: 'in' | 'out' | 'fit'; seq: number }
export type SyncRequest = { boxes: SyncTexBox[]; seq: number }

interface Props {
  pdf: Uint8Array | null
  compiling: boolean
  result: CompileResult | null
  showLogs: boolean
  zoomRequest: ZoomRequest | null
  syncRequest: SyncRequest | null
  compiler: Compiler
  onCompile: () => void
  onStop: () => void
  onClearCache: () => void
  onSetCompiler: (c: Compiler) => void
  onToggleLogs: () => void
  onJump: (entry: LogEntry) => void
  onOpenExternal: () => void
  onSyncToPdf: () => void
  onSyncToCode: (page: number, x: number, y: number) => void
}

const COMPILER_LABEL: Record<Compiler, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' }

export function PdfPane(props: Props) {
  const { pdf, compiling, result, showLogs } = props
  const prefs = usePrefs()
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<PdfRenderer | null>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const syncToCode = useRef(props.onSyncToCode)
  syncToCode.current = props.onSyncToCode

  useEffect(() => {
    const r = new PdfRenderer(containerRef.current!)
    r.onScaleChange = setScale
    r.onDoubleClick = (page, x, y) => syncToCode.current(page, x, y)
    rendererRef.current = r
    return () => r.destroy()
  }, [])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    if (!pdf) {
      r.clear()
      setScale(null)
      return
    }
    setRenderError(null)
    r.load(pdf).catch((err) => setRenderError(String(err?.message ?? err)))
  }, [pdf])

  useEffect(() => {
    const r = rendererRef.current
    const z = props.zoomRequest
    if (!r || !z) return
    if (z.kind === 'in') r.zoomBy(1.15)
    else if (z.kind === 'out') r.zoomBy(1 / 1.15)
    else r.setZoom({ mode: 'fit' })
  }, [props.zoomRequest])

  useEffect(() => {
    if (props.syncRequest) rendererRef.current?.showBoxes(props.syncRequest.boxes)
  }, [props.syncRequest])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const errors = result?.entries.filter((e) => e.level === 'error').length ?? 0
  const warnings = result?.entries.filter((e) => e.level === 'warning').length ?? 0

  const menuItem = (label: string, onClick: () => void, checked?: boolean) => (
    <button
      className="menu-item"
      onClick={() => {
        setMenuOpen(false)
        onClick()
      }}
    >
      <span className="menu-check">{checked && <CheckIcon size={13} />}</span>
      {label}
    </button>
  )

  return (
    <div className="pdf-pane">
      <div className="pane-header pdf-header">
        <div className="sync-buttons">
          <button className="icon-btn" title="Go to code location of the PDF (or double-click the PDF)" disabled={!pdf} onClick={() => rendererRef.current && syncCenter(rendererRef.current, containerRef.current!, props.onSyncToCode)}>
            <ArrowLeftIcon size={15} />
          </button>
          <button className="icon-btn" title="Show cursor position in the PDF (⌘J)" disabled={!pdf} onClick={props.onSyncToPdf}>
            <ArrowRightIcon size={15} />
          </button>
        </div>
        <div className="recompile-group" ref={menuRef}>
          {compiling ? (
            <button className="btn btn-compile compiling" onClick={props.onStop} title="Stop compiling">
              <span className="spinner" /> Compiling… <StopIcon size={13} />
            </button>
          ) : (
            <button className="btn btn-compile" onClick={props.onCompile} title="Recompile (⌘↵ or ⌘S)">
              <RecompileIcon size={15} /> Recompile
            </button>
          )}
          <button className="btn btn-compile btn-compile-menu" onClick={() => setMenuOpen((v) => !v)} title="Compile options" aria-expanded={menuOpen}>
            <ChevronDownIcon size={14} />
          </button>
          {menuOpen && (
            <div className="dropdown-menu">
              <div className="menu-label">Auto compile</div>
              {menuItem('On', () => setPrefs({ autoCompile: true }), prefs.autoCompile)}
              {menuItem('Off', () => setPrefs({ autoCompile: false }), !prefs.autoCompile)}
              <div className="menu-sep" />
              <div className="menu-label">Compiler</div>
              {(Object.keys(COMPILER_LABEL) as Compiler[]).map((c) => (
                <div key={c}>{menuItem(COMPILER_LABEL[c], () => props.onSetCompiler(c), props.compiler === c)}</div>
              ))}
              <div className="menu-sep" />
              {menuItem('Recompile from scratch', props.onClearCache)}
            </div>
          )}
        </div>
        <button className={`btn btn-ghost logs-btn${showLogs ? ' active' : ''}`} onClick={props.onToggleLogs} title="Logs and output (⌘L)">
          <LogIcon size={15} />
          {errors > 0 && <span className="badge badge-error">{errors}</span>}
          {errors === 0 && warnings > 0 && <span className="badge badge-warning">{warnings}</span>}
        </button>
        <div className="spacer" />
        {!showLogs && pdf && (
          <div className="zoom-controls">
            <button className="icon-btn" title="Zoom out (⌘−)" onClick={() => rendererRef.current?.zoomBy(1 / 1.15)}>
              <ZoomOutIcon />
            </button>
            <span className="zoom-value">{scale ? `${Math.round(scale * 100)}%` : ''}</span>
            <button className="icon-btn" title="Zoom in (⌘=)" onClick={() => rendererRef.current?.zoomBy(1.15)}>
              <ZoomInIcon />
            </button>
            <button className="icon-btn" title="Fit to width (⌘0)" onClick={() => rendererRef.current?.setZoom({ mode: 'fit' })}>
              <FitIcon />
            </button>
            <button className="icon-btn" title="Open in Preview" onClick={props.onOpenExternal}>
              <ExternalIcon />
            </button>
          </div>
        )}
      </div>
      <div className="pdf-body">
        <div ref={containerRef} className="pdf-scroll" style={{ visibility: showLogs ? 'hidden' : 'visible' }} />
        {!pdf && !showLogs && (
          <div className="pdf-empty">
            {compiling ? (
              <p>Compiling your document…</p>
            ) : result ? (
              <>
                <p>No PDF was produced.</p>
                <button className="btn" onClick={props.onToggleLogs}>View logs</button>
              </>
            ) : (
              <p>Press Recompile to build the PDF.</p>
            )}
          </div>
        )}
        {renderError && !showLogs && <div className="pdf-error">Could not display the PDF: {renderError}</div>}
        {showLogs && (
          <div className="log-overlay">
            <LogPanel result={result} onJump={props.onJump} />
          </div>
        )}
      </div>
    </div>
  )
}

/** "Go to code" without a click position: use the middle of the visible PDF area. */
function syncCenter(_r: PdfRenderer, container: HTMLDivElement, onSync: Props['onSyncToCode']): void {
  const rect = container.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 3
  const el = document.elementsFromPoint(x, y).find((e) => e.classList.contains('pdf-page')) as HTMLElement | undefined
  if (!el) return
  const pages = [...container.querySelectorAll('.pdf-page')]
  const page = pages.indexOf(el) + 1
  const pr = el.getBoundingClientRect()
  const scale = Number(el.style.getPropertyValue('--scale-factor')) || 1
  onSync(page, (x - pr.left) / scale, (y - pr.top) / scale)
}
