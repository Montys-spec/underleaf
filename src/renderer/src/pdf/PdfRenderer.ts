import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export type Zoom = { mode: 'fit' } | { mode: 'scale'; value: number }

const GAP = 12
const PADDING = 16

interface PageSlot {
  page: PDFPageProxy
  el: HTMLDivElement
  rendered: number | null
  task?: { cancel(): void }
}

/**
 * Renders a PDF as a vertical stack of canvases inside a scroll container.
 * New versions of the document are rendered off-screen and swapped in, so a
 * recompile does not flash or lose the reading position.
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

  constructor(private container: HTMLDivElement) {
    this.resizeObserver = new ResizeObserver(() => {
      const w = this.container.clientWidth
      if (this.zoom.mode === 'fit' && Math.abs(w - this.lastWidth) > 4 && this.doc) {
        this.lastWidth = w
        this.relayout()
      }
    })
    this.resizeObserver.observe(container)
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

  clear(): void {
    this.loadToken++
    this.observer?.disconnect()
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
  }

  private relayout(): void {
    if (!this.doc || !this.stack) return
    const ratio = this.container.scrollHeight > 0 ? this.container.scrollTop / this.container.scrollHeight : 0
    for (const s of this.slots) {
      s.task?.cancel()
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
      slot.el.replaceChildren(canvas)
    } catch (err) {
      if ((err as Error)?.name !== 'RenderingCancelledException') console.error(err)
      if (slot.rendered === scale) slot.rendered = null
    }
  }
}
