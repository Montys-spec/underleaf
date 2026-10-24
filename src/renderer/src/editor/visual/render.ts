import katex from 'katex'
import 'katex/dist/katex.min.css'
import { groupEnd } from '@shared/visualParse'

const mathCache = new Map<string, string>()

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Renders TeX math to HTML with KaTeX; unknown commands show in red instead of failing. */
export function renderMath(tex: string, display: boolean, macros: Record<string, string>): string {
  const key = `${display ? 'D' : 'I'}|${tex}|${JSON.stringify(macros)}`
  let html = mathCache.get(key)
  if (html === undefined) {
    try {
      html = katex.renderToString(tex || '\\,', {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        output: 'html',
        // KaTeX mutates the macros object when \def is used, so give it a copy.
        macros: { ...macros }
      })
    } catch (err) {
      html = `<span class="cm-v-math-error" title="${escapeHtml(String((err as Error).message))}">${escapeHtml(tex)}</span>`
    }
    if (mathCache.size > 2000) mathCache.clear()
    mathCache.set(key, html)
  }
  return html
}

const INLINE_TAGS: Record<string, [string, string]> = {
  textbf: ['<b>', '</b>'],
  textit: ['<i>', '</i>'],
  textsl: ['<i>', '</i>'],
  emph: ['<em>', '</em>'],
  underline: ['<u>', '</u>'],
  texttt: ['<code>', '</code>'],
  textsc: ['<span style="font-variant:small-caps">', '</span>'],
  textsf: ['<span style="font-family:var(--visual-sans)">', '</span>']
}

const INLINE_SYMBOLS: Record<string, string> = {
  LaTeX: 'LaTeX',
  TeX: 'TeX',
  ldots: '…',
  dots: '…',
  textbackslash: '\\',
  today: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  newline: '<br>',
  par: '<br>',
  and: ' · ',
  quad: '&emsp;',
  qquad: '&emsp;&emsp;',
  hfill: ' ',
  centering: '',
  small: '',
  large: '',
  Large: '',
  LARGE: '',
  huge: '',
  Huge: '',
  normalsize: '',
  footnotesize: '',
  scriptsize: '',
  tiny: '',
  bfseries: '',
  itshape: '',
  noindent: ''
}

/**
 * Turns a short piece of LaTeX (a caption, a table cell, a title) into HTML:
 * formatting commands become tags, math is rendered, other commands keep their text.
 */
export function renderInline(tex: string, macros: Record<string, string>): string {
  let out = ''
  let i = 0
  const n = tex.length
  while (i < n) {
    const c = tex[i]
    if (c === '%') {
      const nl = tex.indexOf('\n', i)
      i = nl === -1 ? n : nl
      continue
    }
    if (c === '$') {
      const display = tex[i + 1] === '$'
      const open = display ? 2 : 1
      const close = tex.indexOf(display ? '$$' : '$', i + open)
      if (close !== -1) {
        out += renderMath(tex.slice(i + open, close), display, macros)
        i = close + open
        continue
      }
    }
    if (c === '\\') {
      const next = tex[i + 1]
      if (next === '\\') {
        out += '<br>'
        i += 2
        continue
      }
      if (next === '(') {
        const close = tex.indexOf('\\)', i + 2)
        if (close !== -1) {
          out += renderMath(tex.slice(i + 2, close), false, macros)
          i = close + 2
          continue
        }
      }
      const name = /^[A-Za-z@]+\*?/.exec(tex.slice(i + 1))?.[0]
      if (!name) {
        if (next !== undefined) out += next === ',' || next === ' ' ? ' ' : escapeHtml(next)
        i += 2
        continue
      }
      let j = i + 1 + name.length
      // Skip optional arguments; they are never shown.
      while (tex[j] === '[') {
        const e = groupEnd(tex, j, '[', ']')
        if (e === -1) break
        j = e
      }
      const argEnd = tex[j] === '{' ? groupEnd(tex, j) : -1
      const arg = argEnd !== -1 ? tex.slice(j + 1, argEnd - 1) : null
      const base = name.replace(/\*$/, '')
      if (arg !== null && INLINE_TAGS[base]) {
        out += INLINE_TAGS[base][0] + renderInline(arg, macros) + INLINE_TAGS[base][1]
        i = argEnd
      } else if (arg !== null && /^(label|index|hspace|vspace|includegraphics|phantom)$/.test(base)) {
        i = argEnd
      } else if (arg !== null && /^(ref|eqref|cref|Cref|autoref|pageref)$/.test(base)) {
        out += `<span class="cm-v-chip cm-v-ref">${escapeHtml(arg)}</span>`
        i = argEnd
      } else if (arg !== null && /cite/i.test(base)) {
        out += `<span class="cm-v-chip cm-v-cite">${escapeHtml(arg)}</span>`
        i = argEnd
      } else if (arg !== null && base === 'href') {
        const textEnd = tex[argEnd] === '{' ? groupEnd(tex, argEnd) : -1
        out += `<span class="cm-v-link">${renderInline(textEnd !== -1 ? tex.slice(argEnd + 1, textEnd - 1) : arg, macros)}</span>`
        i = textEnd !== -1 ? textEnd : argEnd
      } else if (arg !== null) {
        // Unknown command with an argument: show its argument (e.g. \textcolor{red}{x} shows "red" then "x").
        out += renderInline(arg, macros)
        i = argEnd
      } else {
        out += INLINE_SYMBOLS[base] ?? ''
        i = j
        if (tex.startsWith('{}', i)) i += 2
      }
      continue
    }
    if (c === '{' || c === '}') {
      i++
      continue
    }
    if (c === '~') {
      out += '&nbsp;'
      i++
      continue
    }
    if (tex.startsWith('---', i)) {
      out += '—'
      i += 3
      continue
    }
    if (tex.startsWith('--', i)) {
      out += '–'
      i += 2
      continue
    }
    if (tex.startsWith('``', i) || tex.startsWith("''", i)) {
      out += c === '`' ? '“' : '”'
      i += 2
      continue
    }
    out += escapeHtml(c)
    i++
  }
  return out
}
