import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EditorManager } from '../editor/manager'
import { CloseIcon, fileIconFor } from './icons'

export const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i
/** Files that are not text and not previewable as images. */
export const BINARY_EXT = /\.(pdf|eps|ps|zip|gz|tar|ttf|otf|woff2?|tiff?|docx?|xlsx?|pptx?|mp4|mov)$/i

interface Props {
  manager: EditorManager
  tabs: string[]
  active: string | null
  dirty: Set<string>
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onReveal: (path: string) => void
  /** Formatting toolbar, shown above LaTeX files. */
  toolbar?: ReactNode
}

export function EditorPane({ manager, tabs, active, dirty, onSelect, onClose, onReveal, toolbar }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const isImage = !!active && IMAGE_EXT.test(active)
  const isBinary = !!active && BINARY_EXT.test(active)

  useEffect(() => {
    host.current?.appendChild(manager.view.dom)
    return () => manager.view.dom.remove()
  }, [manager])

  return (
    <div className="editor-pane">
      <div className="tab-bar" role="tablist">
        {tabs.map((t) => {
          const Icon = fileIconFor(t)
          return (
            <div
              key={t}
              role="tab"
              aria-selected={t === active}
              className={`tab${t === active ? ' active' : ''}`}
              onClick={() => onSelect(t)}
              onAuxClick={(e) => e.button === 1 && onClose(t)}
              title={t}
            >
              <Icon size={13} />
              <span className="tab-name">{t.split('/').pop()}</span>
              <button
                className={`tab-close${dirty.has(t) ? ' dirty' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(t)
                }}
                title="Close tab"
              >
                <CloseIcon size={11} />
              </button>
            </div>
          )
        })}
      </div>
      {toolbar && active?.endsWith('.tex') && toolbar}
      <div className="editor-body">
        <div ref={host} className="editor-host" style={{ display: active && !isImage && !isBinary ? 'block' : 'none' }} />
        {isImage && <ImagePreview path={active!} />}
        {isBinary && (
          <div className="editor-placeholder">
            <p>{active!.split('/').pop()} can't be edited here.</p>
            <button className="btn" onClick={() => onReveal(active!)}>Show in Finder</button>
          </div>
        )}
        {!active && (
          <div className="editor-placeholder">
            <p>Select a file from the file tree to start editing.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ImagePreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoked = false
    let objectUrl: string | null = null
    window.underleaf.readBinary(path).then((bytes) => {
      if (revoked) return
      const type = path.endsWith('.svg') ? 'image/svg+xml' : ''
      objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
      setUrl(objectUrl)
    })
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])
  return <div className="image-preview">{url && <img src={url} alt={path} />}</div>
}
