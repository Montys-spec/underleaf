/** Commands whose arguments are identifiers, paths or code rather than prose. */
const SKIP_ALL_ARGS = new Set([
  'label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'nameref', 'vref',
  'cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'textcite', 'parencite', 'autocite', 'footcite', 'nocite', 'fullcite',
  'usepackage', 'RequirePackage', 'documentclass', 'begin', 'end', 'input', 'include', 'includeonly', 'subfile',
  'includegraphics', 'includepdf', 'url', 'bibliography', 'bibliographystyle', 'addbibresource', 'graphicspath',
  'newcommand', 'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment', 'DeclareMathOperator',
  'setlength', 'addtolength', 'setcounter', 'addtocounter', 'usetheme', 'usecolortheme', 'usefonttheme', 'hypersetup',
  'definecolor', 'pagestyle', 'thispagestyle', 'vspace', 'hspace', 'lstinputlisting', 'inputminted', 'mintinline',
  'setmainfont', 'setsansfont', 'setmonofont', 'newtheorem', 'theoremstyle', 'numberwithin', 'geometry', 'tikz',
  'lstset', 'pgfplotsset', 'tikzset', 'color', 'pagenumbering', 'bibitem', 'verb'
])
/** Commands where only the first argument is not prose, e.g. \href{url}{text}. */
const SKIP_FIRST_ARG = new Set(['href', 'textcolor', 'colorbox', 'hyperref', 'resizebox', 'scalebox', 'rotatebox'])

const NON_PROSE_ENVS = 'equation|align|alignat|flalign|gather|multline|eqnarray|math|displaymath|split|tikzpicture|verbatim|Verbatim|lstlisting|minted|comment|filecontents'

/** Ranges of the document holding math or code that spans lines; spell checking skips them. */
export function blockExclusions(text: string): [number, number][] {
  const out: [number, number][] = []
  const env = new RegExp(`\\\\begin\\{(${NON_PROSE_ENVS})(\\*?)\\}`, 'g')
  let m: RegExpExecArray | null
  while ((m = env.exec(text))) {
    const end = text.indexOf(`\\end{${m[1]}${m[2]}}`, env.lastIndex)
    const to = end === -1 ? text.length : end + m[1].length + m[2].length + 6
    out.push([m.index, to])
    env.lastIndex = to
  }
  // Display math: \[ ... \] and $$ ... $$ may span lines.
  const display = /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g
  while ((m = display.exec(text))) out.push([m.index, m.index + m[0].length])
  return out.sort((a, b) => a[0] - b[0])
}

function skipGroup(s: string, i: number, open: string, close: string): number {
  let depth = 0
  for (let k = i; k < s.length; k++) {
    if (s[k] === '\\') {
      k++
      continue
    }
    if (s[k] === open) depth++
    else if (s[k] === close && --depth === 0) return k + 1
  }
  return s.length
}

const WORD = /[\p{L}][\p{L}\p{M}'’]*/uy

/**
 * Finds prose words on one line of LaTeX: skips commands, their identifier
 * arguments, inline math and comments. Returns [start, end) offsets in the line.
 */
export function proseWords(line: string): [number, number][] {
  const words: [number, number][] = []
  const n = line.length
  let i = 0
  while (i < n) {
    const c = line[i]
    if (c === '%') break
    if (c === '\\') {
      const name = /^[a-zA-Z@]+\*?/.exec(line.slice(i + 1))?.[0]
      if (!name) {
        const next = line[i + 1]
        if (next === '(') i = indexAfter(line, '\\)', i + 2)
        else if (next === '[') i = indexAfter(line, '\\]', i + 2)
        else i += 2
        continue
      }
      i += 1 + name.length
      const base = name.replace(/\*$/, '')
      const skipAll = SKIP_ALL_ARGS.has(base)
      let first = true
      // Options in [...] are never prose; skip argument groups depending on the command.
      for (;;) {
        while (line[i] === ' ') i++
        if (line[i] === '[') i = skipGroup(line, i, '[', ']')
        else if (line[i] === '{' && (skipAll || (first && SKIP_FIRST_ARG.has(base)))) {
          i = skipGroup(line, i, '{', '}')
          first = false
        } else break
      }
      continue
    }
    if (c === '$') {
      i = indexAfter(line, '$', i + 1)
      continue
    }
    WORD.lastIndex = i
    const m = WORD.exec(line)
    if (m) {
      const word = m[0].replace(/['’]+$/, '')
      if (word.length > 1) words.push([i, i + word.length])
      i += m[0].length
      continue
    }
    i++
  }
  return words
}

function indexAfter(s: string, token: string, from: number): number {
  const k = s.indexOf(token, from)
  return k === -1 ? s.length : k + token.length
}
