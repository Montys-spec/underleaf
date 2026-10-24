import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { latexmkEntries, parseLatexLog, toProjectPath } from '../src/shared/logParser.ts'

const opts = { root: '/Users/me/paper', mainDir: '' }

test('parses errors, warnings and bad boxes from a real pdflatex log', () => {
  const log = readFileSync(new URL('./fixtures/sample.log', import.meta.url), 'utf8')
  const entries = parseLatexLog(log, opts)
  const simple = entries.map(({ level, file, line, message }) => ({ level, file, line, message }))

  assert.deepEqual(
    simple.filter((e) => e.level === 'error'),
    [
      { level: 'error', file: 'chapters/one.tex', line: 2, message: 'Undefined control sequence.' },
      { level: 'error', file: 'main.tex', line: 16, message: 'Undefined control sequence.' }
    ]
  )
  assert.ok(simple.some((e) => e.level === 'warning' && e.file === 'main.tex' && e.line === 10 && /sec:missing/.test(e.message)))
  assert.ok(simple.some((e) => e.level === 'warning' && /There were undefined references/.test(e.message)))
  assert.ok(simple.some((e) => e.level === 'typesetting' && e.file === 'main.tex' && e.line === 15))
  assert.match(entries.find((e) => e.file === 'chapters/one.tex')!.context ?? '', /\\badcommand/)
})

test('attributes package warnings with continuation lines', () => {
  const log = [
    '(./main.tex',
    'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
    '(hyperref)                removing `\\textbf\' on input line 17.',
    '',
    ')'
  ].join('\n')
  const [w] = parseLatexLog(log, opts)
  assert.equal(w.level, 'warning')
  assert.equal(w.file, 'main.tex')
  assert.equal(w.line, 17)
  assert.match(w.message, /removing `\\textbf'/)
})

test('handles errors without -file-line-error', () => {
  const log = ['(./sub/doc.tex', '! Missing $ inserted.', '<inserted text>', '                $', 'l.42 x^', '       2', ')'].join('\n')
  const [e] = parseLatexLog(log, opts)
  assert.deepEqual([e.level, e.file, e.line, e.message], ['error', 'sub/doc.tex', 42, 'Missing $ inserted.'])
})

test('maps paths relative to the main file directory and rejects outside paths', () => {
  const o = { root: '/Users/me/paper', mainDir: 'src' }
  assert.equal(toProjectPath('./intro.tex', o), 'src/intro.tex')
  assert.equal(toProjectPath('../figures/a.tex', o), 'figures/a.tex')
  assert.equal(toProjectPath('/usr/local/texlive/2026/texmf-dist/tex/latex/base/article.cls', o), undefined)
  assert.equal(toProjectPath('/Users/me/paper/.underleaf/build/main.aux', o), undefined)
})

test('picks bibliography problems out of latexmk output, ignoring its summaries', () => {
  const out = [
    'Latexmk: Errors, in force_mode: so I tried finishing targets',
    'Latexmk: Summary of warnings from last run of *latex:',
    "Warning--empty journal in knuth",
    "I couldn't open database file refs.bib",
    'WARN - Duplicate entry key x',
    'INFO - This is Biber 2.20',
    "Latexmk: Missing input file 'refs.bib'"
  ].join('\n')
  assert.deepEqual(
    latexmkEntries(out).map((e) => [e.level, e.message]),
    [
      ['warning', 'BibTeX: empty journal in knuth'],
      ['error', "BibTeX: I couldn't open database file refs.bib"],
      ['warning', 'Biber: Duplicate entry key x'],
      ['error', "Missing input file 'refs.bib'"]
    ]
  )
})
