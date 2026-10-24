import { useCallback } from 'react'

/** A vertical drag handle; reports the pointer's x-position while dragging. */
export function Splitter({ onDrag, onDoubleClick }: { onDrag: (clientX: number) => void; onDoubleClick?: () => void }) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      document.body.classList.add('resizing')
      const move = (ev: PointerEvent) => onDrag(ev.clientX)
      const up = () => {
        document.body.classList.remove('resizing')
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    },
    [onDrag]
  )
  return <div className="splitter" onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} role="separator" aria-orientation="vertical" />
}
