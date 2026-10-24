import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import type { SyncTexBox } from '@shared/types'

GlobalWorkerOptions.workerSrc = workerUrl

export type Zoom = { mode: 'fit' } | { mode: 'scale'; value: number }

const GAP = 12
const PADDING = 16

interface PageSlot {
  page: PDFPageProxy
  el: HTMLDivElement
  rendered: number | null
  task?: { cancel(): void }
  textLayer?: TextLayer
}

interface LinkAnnotation {
  subtype: string
  rect: number[]
  url?: string
  dest?: string | unknown[]
}

/**
 * Renders a PDF as a vertical stack of pages inside a scroll container: a canvas,
 * a selectable text layer and clickable links per page. New versions of the
 * document are rendered off-screen and swapped in, so a recompile does not
 * flash or lose the reading position.
 */
export class PdfRenderer {
  private doc?: PDFDocumentProxy
  private loading?: PDFDocumentLoadingTask
  private slots: PageSlot[] = []
  private stack?: HTMLDivElement
  private zoom: Zoom = { mode: 'fit' }
  private observer?: IntersectionObserver
  private loadToken = 0
  private resizeObserver: ResizeObserver
  private lastWidth = 0
  onScaleChange?: (scale: number) => void
  /** Double-click on a page: page number (1-based) and position in PDF points from the top-left. */
  onDoubleClick?: (page: number, x: number, y: number) => void

  constructor(private container: HTMLDivElement) {
    this.resizeObserver = new ResizeObserver(() => {
      const w = this.container.clientWidth
      if (this.zoom.mode === 'fit' && Math.abs(w - this.lastWidth) > 4 && this.doc) {
        this.lastWidth = w
        this.relayout()
      }
    })
    this.resizeObserver.observe(container)
    container.addEventListener('dblclick', this.handleDoubleClick)
  }

  get scale(): number {
    if (this.zoom.mode === 'scale') return this.zoom.value
    const first = this.slots[0]?.page
    if (!first) return 1
    const width = first.getViewport({ scale: 1 }).width
    return Math.max(0.25, (this.container.clientWidth - PADDING * 2) / width)
  }

  async load(data: Uint8Array): Promise<void> {
    const token = ++this.loadToken
    // pdf.js transfers the buffer to its worker, so hand it a copy.
    const task = getDocument({ data: data.slice() })
    const doc = await task.promise
    const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)))
    if (token !== this.loadToken) {
      void task.destroy()
      return
    }

    const oldTask = this.loading
    this.loading = task
    const scrollTop = this.container.scrollTop
    const scrollLeft = this.container.scrollLeft
    this.doc = doc
    for (const s of this.slots) s.textLayer?.cancel()
    this.slots = pages.map((page) => ({ page, el: document.createElement('div'), rendered: null }))
    this.lastWidth = this.container.clientWidth
    const stack = this.buildStack()

    // Render what will be visible before swapping, so the old pages stay up until then.
    const visible = this.slotsInRange(scrollTop, scrollTop + this.container.clientHeight)
    await Promise.all(visible.map((s) => this.renderSlot(s)))
    if (token !== this.loadToken) return

    this.stack?.remove()
    this.container.appendChild(stack)
    this.stack = stack
    this.container.scrollTop = scrollTop
    this.container.scrollLeft = scrollLeft
    this.observe()
    void oldTask?.destroy()
    this.onScaleChange?.(this.scale)
  }

  setZoom(zoom: Zoom): void {
    this.zoom = zoom
    this.relayout()
  }

  zoomBy(factor: number): void {
    const next = Math.min(4, Math.max(0.25, this.scale * factor))
    this.setZoom({ mode: 'scale', value: Math.round(next * 100) / 100 })
  }

  /** Scrolls to and briefly highlights SyncTeX boxes. */
  showBoxes(boxes: SyncTexBox[]): void {
    if (!boxes.length || !this.stack) return
    const scale = this.scale
    const first = boxes[0]
    const slot = this.slots[first.page - 1]
    if (!slot) return
    const top = slot.el.offsetTop + (first.v - first.H) * scale
    this.container.scrollTo({ top: Math.max(0, top - this.container.clientHeight / 3), behavior: 'smooth' })
    for (const b of boxes) {
      const target = this.slots[b.page - 1]
      if (!target) continue
      const mark = document.createElement('div')
      mark.className = 'pdf-sync-mark'
      Object.assign(mark.style, {
        left: `${b.h * scale}px`,
        top: `${(b.v - b.H) * scale}px`,
        width: `${Math.max(b.W, 20) * scale}px`,
        height: `${Math.max(b.H, 8) * scale}px`
      })
      target.el.appendChild(mark)
      setTimeout(() => mark.classList.add('fade'), 1600)
      setTimeout(() => mark.remove(), 2600)
    }
  }

  clear(): void {
    this.loadToken++
    this.observer?.disconnect()
    for (const s of this.slots) s.textLayer?.cancel()
    this.stack?.remove()
    this.stack = undefined
    this.slots = []
    void this.loading?.destroy()
    this.loading = undefined
    this.doc = undefined
  }

  destroy(): void {
    this.clear()
    this.resizeObserver.disconnect()
    this.container.removeEventListener('dblclick', this.handleDoubleClick)
  }

  private handleDoubleClick = (e: MouseEvent): void => {
    const pageEl = (e.target as HTMLElement).closest('.pdf-page')
    if (!pageEl || (e.target as HTMLElement).closest('a')) return
    const index = this.slots.findIndex((s) => s.el === pageEl)
    if (index < 0) return
    const rect = pageEl.getBoundingClientRect()
    const scale = this.scale
    window.getSelection()?.removeAllRanges()
    this.onDoubleClick?.(index + 1, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale)
  }

  private relayout(): void {
    if (!this.doc || !this.stack) return
    const ratio = this.container.scrollHeight > 0 ? this.container.scrollTop / this.container.scrollHeight : 0
    for (const s of this.slots) {
      s.task?.cancel()
      s.textLayer?.cancel()
      s.rendered = null
    }
    const stack = this.buildStack()
    this.stack.replaceWith(stack)
    this.stack = stack
    this.container.scrollTop = ratio * this.container.scrollHeight
    this.observe()
    this.onScaleChange?.(this.scale)
  }

  private buildStack(): HTMLDivElement {
    const stack = document.createElement('div')
    stack.className = 'pdf-stack'
    stack.style.padding = `${PADDING}px`
    stack.style.gap = `${GAP}px`
    const scale = this.scale
    for (const s of this.slots) {
      const vp = s.page.getViewport({ scale })
      const el = document.createElement('div')
      el.className = 'pdf-page'
      el.style.width = `${Math.floor(vp.width)}px`
      el.style.height = `${Math.floor(vp.height)}px`
      // pdf.js text layers size themselves from these variables.
      el.style.setProperty('--scale-factor', String(scale))
      el.style.setProperty('--total-scale-factor', String(scale))
      el.style.setProperty('--scale-round-x', '1px')
      el.style.setProperty('--scale-round-y', '1px')
      s.el = el
      stack.appendChild(el)
    }
    return stack
  }

  private slotsInRange(top: number, bottom: number): PageSlot[] {
    const scale = this.scale
    let y = PADDING
    const out: PageSlot[] = []
    for (const s of this.slots) {
      const h = Math.floor(s.page.getViewport({ scale }).height)
      if (y + h >= top - 200 && y <= bottom + 200) out.push(s)
      y += h + GAP
    }
    return out
  }

  private observe(): void {
    this.observer?.disconnect()
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const slot = this.slots.find((s) => s.el === e.target)
          if (slot) void this.renderSlot(slot)
        }
      },
      { root: this.container, rootMargin: '400px 0px' }
    )
    for (const s of this.slots) this.observer.observe(s.el)
  }

  private async renderSlot(slot: PageSlot): Promise<void> {
    const scale = this.scale
    if (slot.rendered === scale) return
    slot.rendered = scale
    slot.task?.cancel()
    const dpr = window.devicePixelRatio || 1
    const vp = slot.page.getViewport({ scale: scale * dpr })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(vp.width)
    canvas.height = Math.floor(vp.height)
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    const task = slot.page.render({ canvas, viewport: vp })
    slot.task = task
    try {
      await task.promise
    } catch (err) {
      if ((err as Error)?.name !== 'RenderingCancelledException') console.error(err)
      if (slot.rendered === scale) slot.rendered = null
      return
    }
    const cssViewport = slot.page.getViewport({ scale })
    const textDiv = document.createElement('div')
    textDiv.className = 'textLayer'
    const links = document.createElement('div')
    links.className = 'pdf-links'
    slot.el.replaceChildren(canvas, textDiv, links)

    slot.textLayer?.cancel()
    const textLayer = new TextLayer({ textContentSource: slot.page.streamTextContent(), container: textDiv, viewport: cssViewport })
    slot.textLayer = textLayer
    textLayer.render().catch(() => {
      // Cancelled because the page was re-rendered; nothing to do.
    })
    void this.renderLinks(slot.page, cssViewport, links)
  }

  private async renderLinks(page: PDFPageProxy, viewport: ReturnType<PDFPageProxy['getViewport']>, layer: HTMLDivElement): Promise<void> {
    const annotations = (await page.getAnnotations({ intent: 'display' })) as LinkAnnotation[]
    for (const a of annotations) {
      if (a.subtype !== 'Link' || (!a.url && !a.dest)) continue
      const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]) as number[]
      const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]) as number[]
      const link = document.createElement('a')
      link.className = 'pdf-link'
      Object.assign(link.style, {
        left: `${Math.min(x1, x2)}px`,
        top: `${Math.min(y1, y2)}px`,
        width: `${Math.abs(x2 - x1)}px`,
        height: `${Math.abs(y2 - y1)}px`
      })
      if (a.url) {
        link.href = a.url
        link.target = '_blank'
        link.title = a.url
      } else {
        link.href = '#'
        link.addEventListener('click', (e) => {
          e.preventDefault()
          void this.goToDestination(a.dest!)
        })
      }
      layer.appendChild(link)
    }
  }

  private async goToDestination(dest: string | unknown[]): Promise<void> {
    if (!this.doc) return
    const explicit = typeof dest === 'string' ? await this.doc.getDestination(dest) : dest
    if (!explicit || !explicit[0]) return
    const ref = explicit[0] as { num: number; gen: number } | number
    const pageIndex = typeof ref === 'number' ? ref : await this.doc.getPageIndex(ref)
    const slot = this.slots[pageIndex]
    if (!slot) return
    // XYZ destinations carry the target's top in PDF coordinates (origin bottom-left).
    const kind = (explicit[1] as { name?: string } | undefined)?.name
    const pdfTop = kind === 'XYZ' && typeof explicit[3] === 'number' ? (explicit[3] as number) : null
    const pageHeight = slot.page.getViewport({ scale: 1 }).height
    const offset = pdfTop !== null ? (pageHeight - pdfTop) * this.scale : 0
    this.container.scrollTo({ top: slot.el.offsetTop + offset - 20, behavior: 'smooth' })
  }
}
