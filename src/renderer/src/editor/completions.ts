import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import { snippetCompletion } from '@codemirror/autocomplete'
import { findLabels } from '@shared/texScan'
import type { ProjectSymbols } from '@shared/types'

const COMMANDS = [
  'section{}', 'subsection{}', 'subsubsection{}', 'paragraph{}', 'chapter{}', 'part{}',
  'textbf{}', 'textit{}', 'emph{}', 'underline{}', 'texttt{}', 'textsc{}', 'footnote{}',
  'label{}', 'ref{}', 'eqref{}', 'pageref{}', 'autoref{}', 'cref{}', 'cite{}', 'citep{}', 'citet{}', 'textcite{}', 'parencite{}',
  'url{}', 'href{}{}', 'includegraphics[width=\\linewidth]{}', 'input{}', 'include{}', 'usepackage{}', 'documentclass{}',
  'title{}', 'author{}', 'date{}', 'maketitle', 'tableofcontents', 'listoffigures', 'listoftables', 'newpage', 'clearpage',
  'centering', 'caption{}', 'item', 'frac{}{}', 'sqrt{}', 'sum', 'prod', 'int', 'infty', 'partial', 'nabla',
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'kappa', 'lambda', 'mu', 'nu', 'xi',
  'pi', 'rho', 'sigma', 'tau', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Omega',
  'mathbb{}', 'mathcal{}', 'mathrm{}', 'mathbf{}', 'operatorname{}', 'text{}', 'left(', 'right)', 'cdot', 'cdots', 'ldots',
  'times', 'leq', 'geq', 'neq', 'approx', 'equiv', 'in', 'subseteq', 'cup', 'cap', 'to', 'mapsto', 'rightarrow', 'Rightarrow',
  'quad', 'qquad', 'hline', 'toprule', 'midrule', 'bottomrule', 'bibliography{}', 'bibliographystyle{}', 'printbibliography',
  'addbibresource{}', 'newcommand{}{}', 'renewcommand{}{}', 'vspace{}', 'hspace{}', 'noindent', 'today', 'LaTeX', 'TeX',
  'small', 'large', 'Large', 'footnotesize', 'tiny', 'huge', 'textwidth', 'linewidth', 'frametitle{}', 'pause'
]

const ENVIRONMENTS = [
  'itemize', 'enumerate', 'description', 'figure', 'table', 'tabular', 'equation', 'equation*', 'align', 'align*',
  'gather', 'multline', 'center', 'abstract', 'quote', 'verbatim', 'minipage', 'theorem', 'lemma', 'proof',
  'definition', 'document', 'frame', 'columns', 'block', 'thebibliography', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'array'
]

const PACKAGES = [
  'amsmath', 'amssymb', 'amsthm', 'graphicx', 'hyperref', 'cleveref', 'geometry', 'booktabs', 'xcolor', 'tikz', 'pgfplots',
  'biblatex', 'natbib', 'babel', 'fontspec', 'inputenc', 'fontenc', 'microtype', 'siunitx', 'enumitem', 'caption', 'subcaption',
  'float', 'listings', 'minted', 'fancyhdr', 'setspace', 'multirow', 'longtable', 'tabularx', 'csquotes', 'mathtools', 'lipsum'
]

/** Full environment skeletons, offered for `\begin` and as named snippets. */
const ENV_SNIPPETS: Record<string, string> = {
  figure: '\\begin{figure}[ht]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${file}}\n\t\\caption{${caption}}\n\t\\label{fig:${label}}\n\\end{figure}',
  table:
    '\\begin{table}[ht]\n\t\\centering\n\t\\begin{tabular}{${lcr}}\n\t\t${A} & ${B} & ${C} \\\\\\\\\n\t\\end{tabular}\n\t\\caption{${caption}}\n\t\\label{tab:${label}}\n\\end{table}',
  itemize: '\\begin{itemize}\n\t\\item ${}\n\\end{itemize}',
  enumerate: '\\begin{enumerate}\n\t\\item ${}\n\\end{enumerate}',
  frame: '\\begin{frame}{${title}}\n\t${}\n\\end{frame}',
  equation: '\\begin{equation}\n\t${}\n\t\\label{eq:${label}}\n\\end{equation}'
}

function envSnippet(env: string): Completion {
  const body = ENV_SNIPPETS[env] ?? `\\begin{${env}}\n\t\${}\n\\end{${env}}`
  return snippetCompletion(body, { label: `\\begin{${env}}`, type: 'class', detail: ENV_SNIPPETS[env] ? 'template' : 'environment', boost: env in ENV_SNIPPETS ? 2 : 0 })
}

/** `\begin{...}` skeletons, including figure and table templates. Used with or without texlab. */
export const snippetSource: CompletionSource = (ctx) => {
  // Fuzzy matching lets `\fig` find `\begin{figure}` as well as `\beg` finding all of them.
  const word = ctx.matchBefore(/\\[A-Za-z]*/)
  if (!word || (word.text.length < 3 && !ctx.explicit)) return null
  return { from: word.from, options: ENVIRONMENTS.map(envSnippet), validFor: /^\\[A-Za-z]*$/ }
}

const commandOptions: Completion[] = COMMANDS.map((c) => {
  const name = c.replace(/[[{(].*$/, '')
  const template = '\\' + c.replace(/\{\}/g, '{${}}').replace(/\[([^\]]*)\]/, '[${$1}]')
  return snippetCompletion(template, { label: '\\' + name, detail: c.slice(name.length) || undefined, type: 'keyword' })
})

const REF = /^(?:ref|eqref|pageref|autoref|cref|Cref|nameref|vref|labelcref)$/
const CITE = /^(?:cite|citep|citet|citeauthor|citeyear|textcite|parencite|autocite|footcite|nocite|fullcite|Cite|Textcite|Parencite)\*?$/

/**
 * Completion without a language server: commands, environments, and arguments of
 * \ref, \cite, \input, \includegraphics and friends from the project's files.
 */
export function fallbackSource(getSymbols: () => ProjectSymbols | null): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const arg = argumentCompletion(ctx, getSymbols())
    if (arg) return arg
    const word = ctx.matchBefore(/\\[A-Za-z]*/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    return { from: word.from, options: commandOptions, validFor: /^\\[A-Za-z]*$/ }
  }
}

function argumentCompletion(ctx: CompletionContext, symbols: ProjectSymbols | null): CompletionResult | null {
  const before = ctx.matchBefore(/\\([A-Za-z]+\*?)(?:\[[^\]]*\])*\{[^{}]*$/)
  if (!before) return null
  const cmd = /^\\([A-Za-z]+\*?)/.exec(before.text)![1]
  const braceAt = before.text.lastIndexOf('{')
  const argText = before.text.slice(braceAt + 1)
  // Several keys may be listed: \cite{a,b,|}
  const lastComma = argText.lastIndexOf(',')
  const from = before.from + braceAt + 1 + (lastComma + 1)
  const files = symbols?.files ?? []
  let options: Completion[] = []

  if (REF.test(cmd)) {
    const labels = new Map<string, Completion>()
    for (const l of symbols?.labels ?? []) labels.set(l.name, { label: l.name, type: 'variable', detail: `${l.file}:${l.line}` })
    // Labels typed in the open document count before it is saved.
    for (const l of findLabels(ctx.state.doc.toString())) if (!labels.has(l.name)) labels.set(l.name, { label: l.name, type: 'variable', detail: `line ${l.line}` })
    options = [...labels.values()]
  } else if (CITE.test(cmd)) {
    options = (symbols?.citations ?? []).map((c) => ({
      label: c.key,
      type: 'constant',
      detail: [c.author?.split(/ and /)[0]?.split(',')[0], c.year].filter(Boolean).join(' '),
      info: c.title
    }))
  } else if (/^(?:input|include|subfile|includeonly)$/.test(cmd)) {
    options = files.filter((f) => f.endsWith('.tex')).map((f) => ({ label: f.replace(/\.tex$/, ''), type: 'text', detail: 'file' }))
  } else if (/^(?:includegraphics|includepdf)\*?$/.test(cmd)) {
    options = files.filter((f) => /\.(png|jpe?g|pdf|eps|svg)$/i.test(f)).map((f) => ({ label: f, type: 'text', detail: 'image' }))
  } else if (/^(?:bibliography|addbibresource)$/.test(cmd)) {
    options = files.filter((f) => f.endsWith('.bib')).map((f) => ({ label: cmd === 'bibliography' ? f.replace(/\.bib$/, '') : f, type: 'text' }))
  } else if (/^(?:usepackage|RequirePackage)$/.test(cmd)) {
    options = PACKAGES.map((p) => ({ label: p, type: 'namespace' }))
  } else if (cmd === 'begin' || cmd === 'end') {
    options = ENVIRONMENTS.map((e) => ({ label: e, type: 'class' }))
  } else {
    return null
  }
  return { from, options, validFor: /^[^,{}]*$/ }
}
