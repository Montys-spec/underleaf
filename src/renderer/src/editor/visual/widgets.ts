import { EditorView, WidgetType } from '@codemirror/view'
import type { TableRow } from '@shared/visualParse'
import { escapeHtml, renderInline, renderMath } from './render'

/** Where to place the cursor when a rendered widget is clicked. */
function placeCursorOnClick(dom: HTMLElement, view: EditorView, pos: () => number): void {
  dom.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    view.dispatch({ selection: { anchor: pos() } })
    view.focus()
  })
}

/** Base class: clicking a rendered element puts the cursor into its source, revealing it. */
abstract class RevealWidget extends WidgetType {
  constructor(protected readonly revealAt: number) {
    super()
  }

  protected attach(dom: HTMLElement, view: EditorView): HTMLElement {
    // Positions shift as the document changes; ask the view where this widget is now.
    placeCursorOnClick(dom, view, () => {
      try {
        return view.posAtDOM(dom) + this.offsetInside()
      } catch {
        return this.revealAt
      }
    })
    return dom
  }

  /** Characters into the source to place the cursor (inside the construct, not before it). */
  protected offsetInside(): number {
    return 1
  }

  ignoreEvent(): boolean {
    return true
  }
}

export class MathWidget extends RevealWidget {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly macros: Record<string, string>,
    revealAt: number,
    readonly preview = false
  ) {
    super(revealAt)
  }

  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display && other.preview === this.preview && JSON.stringify(other.macros) === JSON.stringify(this.macros)
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.preview ? 'cm-v-math-preview' : this.display ? 'cm-v-math-display' : 'cm-v-math-inline'
    el.innerHTML = renderMath(this.tex, this.display, this.macros)
    return this.preview ? el : this.attach(el, view)
  }

  protected offsetInside(): number {
    return this.display ? 2 : 1
  }
}

export type ChipKind = 'ref' | 'cite' | 'label'

export class ChipWidget extends RevealWidget {
  constructor(
    readonly kind: ChipKind,
    readonly text: string,
    revealAt: number
  ) {
    super(revealAt)
  }

  eq(other: ChipWidget): boolean {
    return other.kind === this.kind && other.text === this.text
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = `cm-v-chip cm-v-${this.kind}`
    el.textContent = this.text
    el.title = this.kind === 'label' ? 'Label' : this.kind === 'ref' ? 'Cross-reference' : 'Citation'
    return this.attach(el, view)
  }
}

export class TextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className = 'cm-v-symbol'
  ) {
    super()
  }

  eq(other: TextWidget): boolean {
    return other.text === this.text && other.className === this.className
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = this.className
    el.textContent = this.text
    return el
  }
}

export class BulletWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly custom: boolean
  ) {
    super()
  }

  eq(other: BulletWidget): boolean {
    return other.html === this.html && other.custom === this.custom
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = `cm-v-bullet${this.custom ? ' custom' : ''}`
    el.innerHTML = this.html
    return el
  }
}

export interface ImageSource {
  /** Resolves a path as written in \includegraphics to a project file and loads it. */
  load(path: string): Promise<string | null>
}

function imageElement(path: string, options: string, images: ImageSource): HTMLElement {
  const box = document.createElement('div')
  box.className = 'cm-v-image'
  const width = /width\s*=\s*([\d.]+)\s*\\(?:line|text|column)width/.exec(options)?.[1]
  const img = document.createElement('img')
  img.alt = path
  img.style.maxWidth = width ? `${Math.min(100, Number(width) * 100)}%` : '100%'
  box.appendChild(img)
  images.load(path).then(
    (url) => {
      if (url) img.src = url
      else box.replaceChildren(missing(path))
    },
    () => box.replaceChildren(missing(path))
  )
  return box
}

function missing(path: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'cm-v-image-missing'
  el.textContent = `Image not found: ${path}`
  return el
}

export class ImageWidget extends RevealWidget {
  constructor(
    readonly path: string,
    readonly options: string,
    readonly images: ImageSource,
    revealAt: number
  ) {
    super(revealAt)
  }

  eq(other: ImageWidget): boolean {
    return other.path === this.path && other.options === this.options
  }

  toDOM(view: EditorView): HTMLElement {
    return this.attach(imageElement(this.path, this.options, this.images), view)
  }
}

function tableElement(rows: TableRow[], macros: Record<string, string>): HTMLElement {
  const table = document.createElement('table')
  table.className = 'cm-v-table'
  const body = document.createElement('tbody')
  for (const row of rows) {
    if (row.cells.length === 0) {
      // A rule after the last row: draw it as that row's bottom border.
      body.lastElementChild?.classList.add('rule-below')
      continue
    }
    const tr = document.createElement('tr')
    if (row.ruleAbove) tr.className = 'rule-above'
    for (const cell of row.cells) {
      const td = document.createElement('td')
      if (cell.span > 1) td.colSpan = cell.span
      if (cell.align) td.style.textAlign = cell.align
      td.innerHTML = renderInline(cell.tex, macros)
      tr.appendChild(td)
    }
    body.appendChild(tr)
  }
  table.appendChild(body)
  return table
}

export class TableWidget extends RevealWidget {
  constructor(
    readonly rows: TableRow[],
    readonly macros: Record<string, string>,
    revealAt: number
  ) {
    super(revealAt)
  }

  eq(other: TableWidget): boolean {
    return JSON.stringify(other.rows) === JSON.stringify(this.rows)
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-v-table-wrap'
    wrap.appendChild(tableElement(this.rows, this.macros))
    return this.attach(wrap, view)
  }

  protected offsetInside(): number {
    return 7
  }
}

export interface FloatContent {
  kind: 'figure' | 'table'
  graphics: { path: string; options: string }[]
  tables: TableRow[][]
  caption: string | null
  label: string | null
}

/** A rendered figure or table environment: images or tables with their caption. */
export class FloatWidget extends RevealWidget {
  constructor(
    readonly content: FloatContent,
    readonly macros: Record<string, string>,
    readonly images: ImageSource,
    revealAt: number
  ) {
    super(revealAt)
  }

  eq(other: FloatWidget): boolean {
    return JSON.stringify(other.content) === JSON.stringify(this.content)
  }

  toDOM(view: EditorView): HTMLElement {
    const fig = document.createElement('figure')
    fig.className = `cm-v-float cm-v-float-${this.content.kind}`
    const caption = () => {
      if (this.content.caption === null && !this.content.label) return null
      const cap = document.createElement('figcaption')
      const name = this.content.kind === 'figure' ? 'Figure' : 'Table'
      cap.innerHTML = `<b>${name}:</b> ${this.content.caption !== null ? renderInline(this.content.caption, this.macros) : ''}`
      if (this.content.label) cap.innerHTML += ` <span class="cm-v-chip cm-v-label">${escapeHtml(this.content.label)}</span>`
      return cap
    }
    // Table captions conventionally sit above the table.
    const cap = caption()
    if (cap && this.content.kind === 'table') fig.appendChild(cap)
    const media = document.createElement('div')
    media.className = 'cm-v-float-media'
    for (const g of this.content.graphics) media.appendChild(imageElement(g.path, g.options, this.images))
    for (const t of this.content.tables) media.appendChild(tableElement(t, this.macros))
    if (media.childNodes.length) fig.appendChild(media)
    if (cap && this.content.kind === 'figure') fig.appendChild(cap)
    return this.attach(fig, view)
  }

  protected offsetInside(): number {
    return 8
  }
}

export class TitleWidget extends RevealWidget {
  constructor(
    readonly title: string | undefined,
    readonly author: string | undefined,
    readonly date: string | undefined,
    readonly macros: Record<string, string>,
    revealAt: number
  ) {
    super(revealAt)
  }

  eq(other: TitleWidget): boolean {
    return other.title === this.title && other.author === this.author && other.date === this.date
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-v-titleblock'
    const line = (cls: string, tex: string | undefined, fallback?: string) => {
      if (tex === undefined && fallback === undefined) return
      const d = document.createElement('div')
      d.className = cls
      d.innerHTML = tex !== undefined ? renderInline(tex, this.macros) : fallback!
      el.appendChild(d)
    }
    line('cm-v-title', this.title, '<span class="cm-v-dim">No \\title set</span>')
    line('cm-v-author', this.author)
    // LaTeX prints today's date unless \date is given.
    line('cm-v-date', this.date ?? '\\today')
    return this.attach(el, view)
  }
}

export class EnvWidget extends RevealWidget {
  constructor(
    readonly name: string,
    readonly title: string | undefined,
    readonly macros: Record<string, string>,
    revealAt: number
  ) {
    super(revealAt)
  }

  eq(other: EnvWidget): boolean {
    return other.name === this.name && other.title === this.title
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    const base = this.name.replace(/\*$/, '')
    el.className = `cm-v-env-label cm-v-env-${base}`
    const label = base.charAt(0).toUpperCase() + base.slice(1)
    el.innerHTML = escapeHtml(label) + (this.title ? ` <span class="cm-v-env-title">(${renderInline(this.title, this.macros)})</span>` : '')
    return this.attach(el, view)
  }

  protected offsetInside(): number {
    return 7
  }
}

/** The collapsed preamble at the top of a document. Clicking it toggles its visibility. */
export class PreambleWidget extends WidgetType {
  constructor(
    readonly lines: number,
    readonly open: boolean,
    readonly toggle: (view: EditorView) => void
  ) {
    super()
  }

  eq(other: PreambleWidget): boolean {
    return other.lines === this.lines && other.open === this.open
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = `cm-v-preamble${this.open ? ' open' : ''}`
    el.textContent = this.open ? '▾ Hide preamble' : `▸ Preamble · ${this.lines} lines (packages, title, settings)`
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.toggle(view)
    })
    return el
  }

  ignoreEvent(): boolean {
    return true
  }
}

export class FootnoteMarker extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-v-footnote-mark'
    el.textContent = 'Footnote'
    return el
  }
}
