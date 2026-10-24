import { redo, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { currentHeading, HEADINGS, insertFigure, insertLink, insertList, insertMath, insertReference, insertTable, setHeading, toggleCommand } from '../editor/commands'
import { BulletListIcon, ImageIcon, LinkIcon, NumberListIcon, QuoteIcon, RedoIcon, TableIcon, TagIcon, UndoIcon, UploadIcon } from './icons'

export type EditorMode = 'code' | 'visual'

interface Props {
  view: EditorView
  mode: EditorMode
  /** Changes whenever the cursor moves, so the heading menu follows it. */
  cursorLine: number
  /** Image files in the project, as paths to use in \includegraphics. */
  images: string[]
  onModeChange: (mode: EditorMode) => void
  onUploadImage: () => Promise<string | null>
}

type Popover = 'figure' | 'table' | null

export function EditorToolbar({ view, mode, cursorLine, images, onModeChange, onUploadImage }: Props) {
  const [popover, setPopover] = useState<Popover>(null)
  const [grid, setGrid] = useState({ rows: 0, cols: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const heading = currentHeading(view)
  void cursorLine

  useEffect(() => {
    if (!popover) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setPopover(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [popover])

  // Buttons act on the editor without stealing its focus or selection.
  const button = (title: string, content: React.ReactNode, run: () => void, extra = '') => (
    <button className={`tb-btn ${extra}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {content}
    </button>
  )

  return (
    <div className="editor-toolbar" ref={ref}>
      <div className="mode-switch" role="tablist" aria-label="Editor mode">
        <button role="tab" aria-selected={mode === 'code'} className={mode === 'code' ? 'active' : ''} onClick={() => onModeChange('code')}>
          Code Editor
        </button>
        <button role="tab" aria-selected={mode === 'visual'} className={mode === 'visual' ? 'active' : ''} onClick={() => onModeChange('visual')}>
          Visual Editor
        </button>
      </div>
      <div className="tb-group">
        {button('Undo (⌘Z)', <UndoIcon size={15} />, () => undo(view))}
        {button('Redo (⇧⌘Z)', <RedoIcon size={15} />, () => redo(view))}
      </div>
      <div className="tb-group">
        <select
          className="tb-select"
          value={heading}
          title="Text style"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setHeading(view, e.target.value)}
        >
          {HEADINGS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
      </div>
      <div className="tb-group">
        {button('Bold (⌘B)', <b>B</b>, () => toggleCommand(view, 'textbf'), 'tb-text')}
        {button('Italic (⌘I)', <i>I</i>, () => toggleCommand(view, 'textit'), 'tb-text tb-italic')}
      </div>
      <div className="tb-group">
        {button('Inline math', <span className="tb-math">π</span>, () => insertMath(view, false), 'tb-text')}
        {button('Display math', <span className="tb-math">Σ</span>, () => insertMath(view, true), 'tb-text')}
      </div>
      <div className="tb-group">
        {button('Bulleted list', <BulletListIcon size={16} />, () => insertList(view, 'itemize'))}
        {button('Numbered list', <NumberListIcon size={16} />, () => insertList(view, 'enumerate'))}
      </div>
      <div className="tb-group">
        {button('Link', <LinkIcon size={15} />, () => insertLink(view))}
        {button('Cross-reference', <TagIcon size={15} />, () => insertReference(view, 'ref'))}
        {button('Citation', <QuoteIcon size={15} />, () => insertReference(view, 'cite'))}
      </div>
      <div className="tb-group tb-popover-anchor">
        {button('Insert figure', <ImageIcon size={16} />, () => setPopover(popover === 'figure' ? null : 'figure'), popover === 'figure' ? 'active' : '')}
        {button('Insert table', <TableIcon size={16} />, () => setPopover(popover === 'table' ? null : 'table'), popover === 'table' ? 'active' : '')}
        {popover === 'figure' && (
          <div className="tb-popover figure-picker">
            <div className="menu-label">Insert figure</div>
            {images.length === 0 && <p className="hint">No images in this project yet.</p>}
            <div className="figure-list">
              {images.map((img) => (
                <button
                  key={img}
                  className="menu-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setPopover(null)
                    insertFigure(view, img)
                  }}
                >
                  {img}
                </button>
              ))}
            </div>
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={async () => {
                setPopover(null)
                const path = await onUploadImage()
                if (path) insertFigure(view, path)
              }}
            >
              <UploadIcon size={13} /> Upload an image…
            </button>
          </div>
        )}
        {popover === 'table' && (
          <div className="tb-popover table-picker" onMouseLeave={() => setGrid({ rows: 0, cols: 0 })}>
            <div className="menu-label">{grid.rows ? `${grid.rows} × ${grid.cols} table` : 'Insert table'}</div>
            <div className="table-grid">
              {Array.from({ length: 8 * 8 }, (_, k) => {
                const r = Math.floor(k / 8) + 1
                const c = (k % 8) + 1
                return (
                  <button
                    key={k}
                    className={r <= grid.rows && c <= grid.cols ? 'on' : ''}
                    onMouseEnter={() => setGrid({ rows: r, cols: c })}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPopover(null)
                      insertTable(view, r, c)
                    }}
                    aria-label={`${r} by ${c}`}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
