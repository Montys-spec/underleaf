import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  separatorBefore?: boolean
}

export interface MenuRequest {
  x: number
  y: number
  items: MenuItem[]
}

export function ContextMenu({ req, onClose }: { req: MenuRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: req.x, y: req.y })

  useLayoutEffect(() => {
    // Keep the menu inside the window.
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.min(req.x, window.innerWidth - r.width - 8), y: Math.min(req.y, window.innerHeight - r.height - 8) })
  }, [req])

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {req.items.map((item) => (
        <div key={item.label}>
          {item.separatorBefore && <div className="menu-sep" />}
          <button
            role="menuitem"
            className={`menu-item${item.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
