import { StateEffect, type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { blockExclusions, proseWords } from '@shared/spellScan'

/** Dispatch this to recompute spelling marks, e.g. after toggling the feature or adding a word. */
export const refreshSpelling = StateEffect.define<null>()

/**
 * The spelling language for the open document: a code such as "en" or "de",
 * null for the system default, or undefined while it is still being detected.
 */
export type LanguageGetter = () => string | null | undefined

// Results from the macOS spell checker, keyed by "language|word". true = misspelled.
const cache = new Map<string, boolean>()
const inFlight = new Set<string>()
const ignored = new Set<string>()
const mark = Decoration.mark({ class: 'cm-misspelled' })

const key = (lang: string | null, word: string) => `${lang ?? ''}|${word}`

export function forgetWord(word: string): void {
  for (const k of cache.keys()) if (k.endsWith(`|${word}`)) cache.set(k, false)
}

export function ignoreWord(word: string): void {
  ignored.add(word)
}

function isMarked(lang: string | null, word: string): boolean {
  return !ignored.has(word) && cache.get(key(lang, word)) === true
}

/** The misspelled word at a document position, if any. */
export function misspelledWordAt(view: EditorView, pos: number, lang: string | null): { from: number; to: number; word: string } | null {
  const line = view.state.doc.lineAt(pos)
  for (const [s, e] of proseWords(line.text)) {
    if (pos >= line.from + s && pos <= line.from + e) {
      const word = line.text.slice(s, e)
      return isMarked(lang, word) ? { from: line.from + s, to: line.from + e, word } : null
    }
  }
  return null
}

/** A sample of the document's prose, for language detection. */
export function proseSample(text: string, maxWords = 400): string {
  const words: string[] = []
  for (const line of text.split('\n')) {
    for (const [s, e] of proseWords(line)) {
      words.push(line.slice(s, e))
      if (words.length >= maxWords) return words.join(' ')
    }
  }
  return words.join(' ')
}

export function spellChecker(isEnabled: () => boolean, getLang: LanguageGetter): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      private exclusions: [number, number][] = []
      private timer = 0
      private destroyed = false

      constructor(private view: EditorView) {
        this.exclusions = blockExclusions(view.state.doc.toString())
        this.decorations = this.build()
      }

      update(u: ViewUpdate) {
        const forced = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshSpelling)))
        if (u.docChanged) {
          this.decorations = this.decorations.map(u.changes)
          // Recomputing on every keystroke is wasteful; wait for a pause in typing.
          clearTimeout(this.timer)
          this.timer = window.setTimeout(() => this.view.dispatch({ effects: refreshSpelling.of(null) }), 400)
        }
        if (forced) this.exclusions = blockExclusions(u.state.doc.toString())
        if (forced || u.viewportChanged) this.decorations = this.build()
      }

      destroy() {
        this.destroyed = true
        clearTimeout(this.timer)
      }

      build(): DecorationSet {
        const lang = getLang()
        if (!isEnabled() || lang === undefined) return Decoration.none
        const builder = new RangeSetBuilder<Decoration>()
        const unknown = new Set<string>()
        const doc = this.view.state.doc
        let lastLine = 0
        for (const { from, to } of this.view.visibleRanges) {
          let pos = from
          while (pos <= to) {
            const line = doc.lineAt(pos)
            pos = line.to + 1
            // Visible ranges can share a line around folds; marks must be added in order.
            if (line.number <= lastLine) continue
            lastLine = line.number
            for (const [s, e] of proseWords(line.text)) {
              const start = line.from + s
              if (this.excluded(start)) continue
              const word = line.text.slice(s, e)
              const known = cache.get(key(lang, word))
              if (known === undefined) unknown.add(word)
              else if (known && !ignored.has(word)) builder.add(start, line.from + e, mark)
            }
          }
        }
        if (unknown.size) this.lookup([...unknown], lang)
        return builder.finish()
      }

      /** Asks macOS about words not seen before, then redraws. */
      lookup(words: string[], lang: string | null) {
        const fresh = words.filter((w) => !inFlight.has(key(lang, w)))
        if (!fresh.length) return
        for (const w of fresh) inFlight.add(key(lang, w))
        window.underleaf.spellCheck(fresh, lang).then(
          (misspelled) => {
            const bad = new Set(misspelled)
            for (const w of fresh) {
              cache.set(key(lang, w), bad.has(w))
              inFlight.delete(key(lang, w))
            }
            if (!this.destroyed && bad.size) this.view.dispatch({ effects: refreshSpelling.of(null) })
          },
          () => {
            for (const w of fresh) inFlight.delete(key(lang, w))
          }
        )
      }

      excluded(pos: number): boolean {
        for (const [a, b] of this.exclusions) {
          if (pos < a) return false
          if (pos < b) return true
        }
        return false
      }
    },
    { decorations: (v) => v.decorations }
  )
}
