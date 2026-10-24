import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVisual, type VNode } from '../src/shared/visualParse.ts'

const kinds = (nodes: VNode[]) => nodes.map((n) => n.kind)
const slice = (text: string, n: { from: number; to: number }) => text.slice(n.from, n.to)

test('preamble, title data and math macros', () => {
  const text = '\\documentclass{article}\n\\newcommand{\\R}{\\mathbb{R}}\n\\DeclareMathOperator{\\Tr}{tr}\n\\graphicspath{{figures/}{img/}}\n\\title{A \\emph{Study}}\n\\author{Ada}\n\\begin{document}\n\\maketitle\nHi\n\\end{document}\n'
  const doc = parseVisual(text)
  assert.equal(slice(text, doc.preamble!), text.slice(0, text.indexOf('\\begin{document}') + 16))
  assert.equal(doc.title, 'A \\emph{Study}')
  assert.equal(doc.author, 'Ada')
  assert.deepEqual(doc.macros, { '\\R': '\\mathbb{R}', '\\Tr': '\\operatorname{tr}' })
  assert.deepEqual(doc.graphicsPaths, ['figures/', 'img/'])
  assert.deepEqual(kinds(doc.nodes), ['maketitle', 'end'])
})

test('sections and nested formatting keep content ranges', () => {
  const text = '\\section*{The \\textbf{Bold} part}\\label{s:1}\nSome \\textbf{bold \\emph{and nested}} text.'
  const doc = parseVisual(text)
  assert.deepEqual(kinds(doc.nodes), ['section', 'format', 'label', 'format', 'format'])
  const [sec, , label, bold, emph] = doc.nodes as Extract<VNode, { contentFrom: number }>[]
  assert.equal(text.slice(sec.contentFrom, sec.contentTo), 'The \\textbf{Bold} part')
  assert.equal((label as unknown as { name: string }).name, 's:1')
  assert.equal(text.slice(bold.contentFrom, bold.contentTo), 'bold \\emph{and nested}')
  assert.equal(text.slice(emph.contentFrom, emph.contentTo), 'and nested')
})

test('inline and display math in all notations', () => {
  const text = 'a $x^2$ b \\(y\\) c \\[z\\] d $$w$$\n\\begin{equation}\\label{e}\n E=mc^2 % energy\n\\end{equation}\n\\begin{align*}a&=b\\\\c&=d\\end{align*}'
  const math = parseVisual(text).nodes.filter((n) => n.kind === 'math') as Extract<VNode, { kind: 'math' }>[]
  assert.deepEqual(
    math.map((m) => [m.display, m.tex]),
    [
      [false, 'x^2'],
      [false, 'y'],
      [true, 'z'],
      [true, 'w'],
      [true, 'E=mc^2'],
      [true, '\\begin{aligned}a&=b\\\\c&=d\\end{aligned}']
    ]
  )
})

test('escaped dollars and comments are not math', () => {
  const doc = parseVisual('costs \\$5 and \\$6 % $not math$\n')
  assert.deepEqual(kinds(doc.nodes), ['symbol', 'symbol'])
})

test('lists number items per level', () => {
  const text = '\\begin{enumerate}\n\\item One\n\\item Two\n\\begin{itemize}\n\\item[*] Sub\n\\end{itemize}\n\\end{enumerate}'
  const items = parseVisual(text).nodes.filter((n) => n.kind === 'item') as Extract<VNode, { kind: 'item' }>[]
  assert.deepEqual(
    items.map((i) => [i.list, i.index, i.depth, i.level, i.label ?? null, text.slice(i.to, text.indexOf('\n', i.to))]),
    [
      ['enumerate', 1, 1, 1, null, 'One'],
      ['enumerate', 2, 1, 1, null, 'Two'],
      ['itemize', 1, 2, 1, '*', 'Sub']
    ]
  )
})

test('figures, graphics, captions and tables', () => {
  const text =
    '\\begin{figure}[ht]\n\\centering\n\\includegraphics[width=0.5\\linewidth]{plot}\n\\caption{A $y=x$ plot}\\label{fig:p}\n\\end{figure}\n' +
    '\\begin{tabular}{lr}\n\\toprule\nA & \\textbf{B} \\\\\n\\midrule\n\\multicolumn{2}{c}{Wide} \\\\[2pt]\n1 & 2\\\\\n\\bottomrule\n\\end{tabular}'
  const doc = parseVisual(text)
  const float = doc.nodes.find((n) => n.kind === 'float')!
  assert.equal(slice(text, float), text.slice(0, text.indexOf('\\end{figure}') + 12))
  const g = doc.nodes.find((n) => n.kind === 'graphic') as Extract<VNode, { kind: 'graphic' }>
  assert.deepEqual([g.path, g.options], ['plot', 'width=0.5\\linewidth'])
  const table = doc.nodes.find((n) => n.kind === 'table') as Extract<VNode, { kind: 'table' }>
  assert.deepEqual(
    table.rows.map((r) => [r.ruleAbove, r.cells.map((c) => `${c.tex}/${c.span}${c.align ? '/' + c.align : ''}`)]),
    [
      [true, ['A/1', '\\textbf{B}/1']],
      [true, ['Wide/2/center']],
      [false, ['1/1', '2/1']],
      [true, []]
    ]
  )
})

test('references, citations, links and typographic symbols', () => {
  const text = 'See \\cref{a,b} and \\cite[p.~2]{knuth} at \\href{https://x.org}{the site} -- or --- ``quoted\'\' \\LaTeX{} 50\\%'
  const doc = parseVisual(text)
  const pick = (k: string) => doc.nodes.filter((n) => n.kind === k)
  assert.deepEqual((pick('ref')[0] as { keys: string[] }).keys, ['a', 'b'])
  assert.deepEqual((pick('cite')[0] as { keys: string[] }).keys, ['knuth'])
  const link = pick('link')[0] as Extract<VNode, { kind: 'link' }>
  assert.deepEqual([link.url, text.slice(link.contentFrom, link.contentTo)], ['https://x.org', 'the site'])
  assert.deepEqual(
    (pick('symbol') as { text: string }[]).map((s) => s.text),
    ['–', '—', '“', '”', 'LaTeX', '%']
  )
})

test('verbatim content is skipped', () => {
  const doc = parseVisual('\\begin{verbatim}\n\\textbf{x} $y$\n\\end{verbatim}\nafter $z$')
  assert.deepEqual(kinds(doc.nodes), ['math'])
})
