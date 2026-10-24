import { type EditorState, type Extension, type Range, RangeSet, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { parseVisual, type VisualDoc, type VNode } from '@shared/visualParse'
import { renderInline } from './render'
import {
  BulletWidget,
  ChipWidget,
  EnvWidget,
  type FloatContent,
  FloatWidget,
  FootnoteMarker,
  ImageWidget,
  type ImageSource,
  MathWidget,
  PreambleWidget,
  TableWidget,
  TextWidget,
  TitleWidget
} from './widgets'

/**
 * The visual editor: renders LaTeX structure in place (headings, formatting, math,
 * lists, figures, tables) while the document stays plain LaTeX. Whatever the cursor
 * is in shows its source again, so it can be edited directly.
 */

const togglePreamble = StateEffect.define<boolean>()

interface VisualState {
  parse: VisualDoc
  preambleOpen: boolean
  decorations: DecorationSet
  atomic: RangeSet<Decoration>
}

const hidden = Decoration.replace({})
const ENV_PLAIN = new Set(['document', 'center', 'flushleft', 'flushright', 'minipage', 'multicols', 'small', 'footnotesize', 'adjustbox', 'landscape'])
const ENV_HEADINGS = new Set(['abstract'])

function bulletFor(node: Extract<VNode, { kind: 'item' }>, macros: Record<string, string>): { html: string; custom: boolean } {
  if (node.label !== undefined) return { html: renderInline(node.label, macros) || '•', custom: true }
  // LaTeX numbers nested enumerate levels 1., (a), i., A. and bullets itemize levels •, –, ∗, ·.
  const level = Math.min(node.level - 1, 3)
  if (node.list === 'enumerate') {
    const n = node.index
    return { html: [`${n}.`, `(${String.fromCharCode(96 + n)})`, `${roman(n)}.`, `${String.fromCharCode(64 + n)}.`][level], custom: false }
  }
  return { html: ['•', '–', '∗', '·'][level], custom: false }
}

function roman(n: number): string {
  const table: [number, string][] = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let out = ''
  for (const [v, s] of table) while (n >= v) (out += s), (n -= v)
  return out
}

function build(state: EditorState, parse: VisualDoc, preambleOpen: boolean, images: ImageSource): Pick<VisualState, 'decorations' | 'atomic'> {
  const doc = state.doc
  const text = (from: number, to: number) => doc.sliceString(from, to)
  const ranges: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []
  const sel = state.selection.ranges
  const touched = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from)
  const macros = parse.macros

  const replace = (from: number, to: number, deco: Decoration = hidden) => {
    if (to <= from && !(deco.spec.widget && to === from)) return
    ranges.push(deco.range(from, to))
    atomic.push(hidden.range(from, to))
  }
  const lineClass = (pos: number, cls: string, style?: string) => {
    const line = doc.lineAt(pos)
    ranges.push(Decoration.line({ class: cls, attributes: style ? { style } : undefined }).range(line.from))
  }
  /** True when [from, to) covers whole lines (ignoring surrounding whitespace), so it can be a block. */
  const wholeLines = (from: number, to: number) => {
    const a = doc.lineAt(from)
    const b = doc.lineAt(to)
    return text(a.from, from).trim() === '' && text(to, b.to).trim() === ''
  }
  const block = (from: number, to: number, widget: Decoration['spec']['widget']) => {
    if (wholeLines(from, to)) {
      const a = doc.lineAt(from)
      const b = doc.lineAt(to)
      replace(a.from, b.to, Decoration.replace({ widget, block: true }))
    } else {
      replace(from, to, Decoration.replace({ widget }))
    }
  }

  // The preamble collapses into one line until opened (or until the cursor goes into it).
  let skipUntil = 0
  if (parse.preamble) {
    const { from, to } = parse.preamble
    const lastLine = doc.lineAt(to)
    const toggle = (view: EditorView) => view.dispatch({ effects: togglePreamble.of(!view.state.field(visualField).preambleOpen) })
    // A cursor resting at the very start (where documents open) does not unfold it.
    const inPreamble = sel.some((r) => r.to > 0 && r.from <= to)
    if (!preambleOpen && !inPreamble) {
      replace(from, lastLine.to, Decoration.replace({ widget: new PreambleWidget(lastLine.number, false, toggle), block: true }))
      skipUntil = lastLine.to
    } else {
      ranges.push(Decoration.widget({ widget: new PreambleWidget(lastLine.number, true, toggle), block: true, side: -1 }).range(0))
      for (let l = 1; l <= lastLine.number; l++) ranges.push(Decoration.line({ class: 'cm-v-preamble-line' }).range(doc.line(l).from))
    }
  }

  // Environments that are not lists or floats get a label and a left rule on their lines.
  const envStack: { name: string; line: number }[] = []

  for (const node of parse.nodes) {
    if (node.from < skipUntil) continue
    const isTouched = touched(node.from, node.to)

    switch (node.kind) {
      case 'section': {
        lineClass(node.from, `cm-v-h cm-v-h${node.level}`)
        if (!isTouched) {
          replace(node.from, node.contentFrom)
          replace(node.contentTo, node.to)
        }
        break
      }
      case 'format': {
        if (node.contentTo > node.contentFrom) ranges.push(Decoration.mark({ class: `cm-v-${node.style}` }).range(node.contentFrom, node.contentTo))
        if (!isTouched) {
          replace(node.from, node.contentFrom)
          replace(node.contentTo, node.to)
        }
        break
      }
      case 'footnote': {
        if (node.contentTo > node.contentFrom) ranges.push(Decoration.mark({ class: 'cm-v-footnote' }).range(node.contentFrom, node.contentTo))
        if (!isTouched) {
          replace(node.from, node.contentFrom, Decoration.replace({ widget: new FootnoteMarker() }))
          replace(node.contentTo, node.to)
        }
        break
      }
      case 'caption': {
        if (!isTouched) {
          replace(node.from, node.contentFrom, Decoration.replace({ widget: new TextWidget('Caption: ', 'cm-v-caption-label') }))
          replace(node.contentTo, node.to)
        }
        break
      }
      case 'link': {
        if (node.contentTo > node.contentFrom) ranges.push(Decoration.mark({ class: 'cm-v-link', attributes: { title: node.url } }).range(node.contentFrom, node.contentTo))
        if (!isTouched) {
          replace(node.from, node.contentFrom)
          replace(node.contentTo, node.to)
        }
        break
      }
      case 'ref':
      case 'cite':
        if (!isTouched) replace(node.from, node.to, Decoration.replace({ widget: new ChipWidget(node.kind, node.keys.join(', '), node.from) }))
        break
      case 'label':
        if (!isTouched) replace(node.from, node.to, Decoration.replace({ widget: new ChipWidget('label', node.name, node.from) }))
        break
      case 'symbol':
        if (!isTouched) replace(node.from, node.to, Decoration.replace({ widget: new TextWidget(node.text) }))
        break
      case 'math': {
        if (!isTouched) {
          const widget = new MathWidget(node.tex, node.display, macros, node.from)
          if (node.display) block(node.from, node.to, widget)
          else replace(node.from, node.to, Decoration.replace({ widget }))
          skipUntil = Math.max(skipUntil, node.to)
        } else {
          ranges.push(Decoration.mark({ class: 'cm-v-math-source' }).range(node.from, node.to))
          if (node.display) {
            // While editing display math, show the rendered result underneath.
            const end = doc.lineAt(node.to).to
            ranges.push(Decoration.widget({ widget: new MathWidget(node.tex, true, macros, node.from, true), block: true, side: 1 }).range(end))
          }
        }
        break
      }
      case 'graphic':
        if (!isTouched) replace(node.from, node.to, Decoration.replace({ widget: new ImageWidget(node.path, node.options, images, node.from) }))
        break
      case 'table':
        if (!isTouched) {
          block(node.from, node.to, new TableWidget(node.rows, macros, node.from))
          skipUntil = Math.max(skipUntil, node.to)
        }
        break
      case 'float': {
        if (isTouched) break
        const inner = parse.nodes.filter((n) => n.from >= node.bodyFrom && n.to <= node.bodyTo)
        const caption = inner.find((n) => n.kind === 'caption') as Extract<VNode, { kind: 'caption' }> | undefined
        const label = inner.find((n) => n.kind === 'label') as Extract<VNode, { kind: 'label' }> | undefined
        const content: FloatContent = {
          kind: node.name.startsWith('table') ? 'table' : 'figure',
          graphics: inner.filter((n) => n.kind === 'graphic').map((n) => ({ path: (n as { path: string }).path, options: (n as { options: string }).options })),
          tables: inner.filter((n) => n.kind === 'table').map((n) => (n as Extract<VNode, { kind: 'table' }>).rows),
          caption: caption ? text(caption.contentFrom, caption.contentTo) : null,
          label: label?.name ?? null
        }
        block(node.from, node.to, new FloatWidget(content, macros, images, node.from))
        skipUntil = Math.max(skipUntil, node.to)
        break
      }
      case 'item': {
        const bullet = bulletFor(node, macros)
        lineClass(node.from, 'cm-v-li', `--v-depth: ${node.depth}`)
        if (!isTouched) replace(node.from, node.to, Decoration.replace({ widget: new BulletWidget(bullet.html, bullet.custom) }))
        break
      }
      case 'begin':
      case 'end': {
        const line = doc.lineAt(node.from)
        const onLine = touched(line.from, line.to)
        if (node.kind === 'begin' && !node.list && !ENV_PLAIN.has(node.name)) envStack.push({ name: node.name, line: line.number })
        if (node.kind === 'end' && !node.list && envStack.length && envStack[envStack.length - 1].name === node.name) {
          const open = envStack.pop()!
          // Mark the environment's body with a rule so it reads as one block.
          for (let l = open.line + 1; l < line.number; l++) ranges.push(Decoration.line({ class: `cm-v-env-body ${ENV_HEADINGS.has(node.name) ? 'cm-v-env-abstract' : ''}` }).range(doc.line(l).from))
        }
        if (onLine) {
          ranges.push(Decoration.mark({ class: 'cm-v-env-source' }).range(node.from, node.to))
          break
        }
        const alone = wholeLines(node.from, node.to)
        if (node.kind === 'begin' && !node.list && !ENV_PLAIN.has(node.name)) {
          const widget = new EnvWidget(node.name, node.title, macros, node.from)
          if (alone) replace(line.from, line.to, Decoration.replace({ widget, block: true }))
          else replace(node.from, node.to, Decoration.replace({ widget }))
        } else if (alone) {
          // List and end markers have nothing to show; the whole line folds away.
          replace(line.from, line.to, Decoration.replace({ block: true }))
        } else {
          replace(node.from, node.to)
        }
        break
      }
      case 'maketitle':
        if (!isTouched) block(node.from, node.to, new TitleWidget(parse.title, parse.author, parse.date, macros, node.from))
        break
    }
  }

  return { decorations: Decoration.set(ranges, true), atomic: RangeSet.of(atomic, true) }
}

let imageSource: ImageSource = { load: async () => null }

const visualField = StateField.define<VisualState>({
  create(state) {
    const parse = parseVisual(state.doc.toString())
    return { parse, preambleOpen: false, ...build(state, parse, false, imageSource) }
  },
  update(value, tr) {
    let { parse, preambleOpen } = value
    const toggled = tr.effects.find((e) => e.is(togglePreamble))
    if (toggled) preambleOpen = toggled.value
    if (tr.docChanged) parse = parseVisual(tr.state.doc.toString())
    if (!tr.docChanged && !tr.selection && !toggled) return value
    return { parse, preambleOpen, ...build(tr.state, parse, preambleOpen, imageSource) }
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(f).atomic)]
})

/** The visual editor extension. `images` loads pictures for \includegraphics. */
export function visualEditor(images: ImageSource): Extension {
  imageSource = images
  return [visualField, EditorView.editorAttributes.of({ class: 'cm-visual' })]
}
