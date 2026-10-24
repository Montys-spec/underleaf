import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockExclusions, proseWords } from '../src/shared/spellScan.ts'
import { findLabels, findOutline, parseBibEntries, plainTitle } from '../src/shared/texScan.ts'

const words = (line: string) => proseWords(line).map(([s, e]) => line.slice(s, e))

test('spell scanning skips commands, identifiers, math and comments', () => {
  assert.deepEqual(words('See \\cref{sec:method} and \\cite[p.~3]{knuth1984} for $x^2$ details % sumary'), ['See', 'and', 'for', 'details'])
  assert.deepEqual(words('\\textbf{Bold words} stay, \\href{https://x.org}{link text} too'), ['Bold', 'words', 'stay', 'link', 'text', 'too'])
  assert.deepEqual(words('\\usepackage[margin=2.5cm]{geometry} \\begin{itemize} \\item Item one'), ['Item', 'one'])
  assert.deepEqual(words('Unclosed \\cref{sec: \\cref{sec:} trailing'), ['Unclosed'])
  assert.deepEqual(words("Don't split l’apostrophe, Zürich"), ["Don't", 'split', 'l’apostrophe', 'Zürich'])
  assert.deepEqual(words('An \\( inline \\) and \\[ display \\] end'), ['An', 'and', 'end'])
})

test('block exclusions cover display math and verbatim environments', () => {
  const text = 'Intro\n\\begin{equation}\n  mc squared\n\\end{equation}\nOutro\n\\[ a + b \\]\n\\begin{align*}\nx\n\\end{align*}'
  const blocks = blockExclusions(text)
  const covered = (word: string) => blocks.some(([a, b]) => text.indexOf(word) >= a && text.indexOf(word) < b)
  assert.ok(covered('mc squared'))
  assert.ok(covered('a + b'))
  assert.ok(covered('\nx\n'))
  assert.ok(!covered('Intro'))
  assert.ok(!covered('Outro'))
})

test('outline finds sections with levels, starred variants and markup in titles', () => {
  const text = '\\chapter{Intro}\n% \\section{Commented}\n\\section*{The \\textbf{Bold} part}\\label{s}\n\\subsection[Short]{Long title\n  over two lines}\n'
  assert.deepEqual(findOutline(text), [
    { level: 1, title: 'Intro', line: 1 },
    { level: 2, title: 'The Bold part', line: 3 },
    { level: 3, title: 'Long title over two lines', line: 4 }
  ])
  assert.equal(plainTitle('A~\\emph{nice} title\\label{x}'), 'A nice title')
})

test('labels and bibliography entries are extracted', () => {
  assert.deepEqual(findLabels('a\\label{eq:1}\n% \\label{gone}\n\\label{ fig:x }'), [
    { name: 'eq:1', line: 1 },
    { name: 'fig:x', line: 3 }
  ])
  const bib = '@comment{x}\n@Book{knuth1984,\n  author = {Donald E. Knuth},\n  title = {The {\\TeX}book},\n  year = 1984\n}\n@article{doe, title="Quoted", date={2020-01-02}}'
  assert.deepEqual(parseBibEntries(bib), [
    { key: 'knuth1984', type: 'book', title: 'The \\TeXbook', author: 'Donald E. Knuth', year: '1984' },
    { key: 'doe', type: 'article', title: 'Quoted', author: undefined, year: '2020' }
  ])
})
