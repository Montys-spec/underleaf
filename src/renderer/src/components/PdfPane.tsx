import { useEffect, useRef, useState } from 'react'
import type { CompileResult, LogEntry } from '@shared/types'
import { PdfRenderer } from '../pdf/PdfRenderer'
import { LogPanel } from './LogPanel'
import { ExternalIcon, FitIcon, LogIcon, RecompileIcon, StopIcon, ZoomInIcon, ZoomOutIcon } from './icons'

export type ZoomRequest = { kind: 'in' | 'out' | 'fit'; seq: number }

interface Props {
  pdf: Uint8Array | null
  compiling: boolean
  result: CompileResult | null
  showLogs: boolean
  zoomRequest: ZoomRequest | null
  onCompile: () => void
  onStop: () => void
  onToggleLogs: () => void
  onJump: (entry: LogEntry) => void
  onOpenExternal: () => void
}

export function PdfPane(props: Props) {
  const { pdf, compiling, result, showLogs } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<PdfRenderer | null>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    const r = new PdfRenderer(containerRef.current!)
    r.onScaleChange = setScale
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

  const errors = result?.entries.filter((e) => e.level === 'error').length ?? 0
  const warnings = result?.entries.filter((e) => e.level === 'warning').length ?? 0

  return (
    <div className="pdf-pane">
      <div className="pane-header pdf-header">
        <div className="recompile-group">
          {compiling ? (
            <button className="btn btn-compile compiling" onClick={props.onStop} title="Stop compiling">
              <span className="spinner" /> Compiling… <StopIcon size={13} />
            </button>
          ) : (
            <button className="btn btn-compile" onClick={props.onCompile} title="Recompile (⌘↵ or ⌘S)">
              <RecompileIcon size={15} /> Recompile
            </button>
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
