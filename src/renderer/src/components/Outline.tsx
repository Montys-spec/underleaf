import type { OutlineItem } from '@shared/texScan'
import { ChevronIcon } from './icons'

interface Props {
  items: OutlineItem[]
  currentLine: number
  open: boolean
  onToggle: () => void
  onJump: (line: number) => void
}

/** Section headings of the open file, with the one containing the cursor highlighted. */
export function Outline({ items, currentLine, open, onToggle, onJump }: Props) {
  const minLevel = items.length ? Math.min(...items.map((i) => i.level)) : 0
  let current = -1
  items.forEach((item, i) => {
    if (item.line <= currentLine) current = i
  })

  return (
    <div className={`outline${open ? ' open' : ''}`}>
      <button className="outline-header" onClick={onToggle}>
        <span className={`tree-chevron${open ? ' open' : ''}`}>
          <ChevronIcon size={12} />
        </span>
        <span className="pane-title">File outline</span>
      </button>
      {open && (
        <ul className="outline-list">
          {items.length === 0 && <li className="outline-empty">No sections in this file.</li>}
          {items.map((item, i) => (
            <li key={`${item.line}-${i}`}>
              <button
                className={`outline-item${i === current ? ' current' : ''}`}
                style={{ paddingLeft: 14 + (item.level - minLevel) * 14 }}
                onClick={() => onJump(item.line)}
                title={`Line ${item.line}`}
              >
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
