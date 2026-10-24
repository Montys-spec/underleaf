import type { Compiler, TemplateInfo } from '@shared/types'

interface Template extends TemplateInfo {
  compiler?: Compiler
  files: Record<string, string>
}

const ARTICLE = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath, amssymb}
\\usepackage{graphicx}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{hyperref}

\\title{Untitled Document}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Start writing here.

\\end{document}
`

const PAPER = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath, amssymb, amsthm}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage[style=authoryear, backend=biber]{biblatex}
\\usepackage{hyperref}
\\usepackage[capitalise]{cleveref}

\\addbibresource{references.bib}

\\title{Title of the Paper}
\\author{Your Name\\\\ \\small Your Institution}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
A short summary of the paper.
\\end{abstract}

\\section{Introduction}\\label{sec:introduction}

LaTeX was created by \\textcite{lamport1994}. See \\cref{sec:method} for the method
and \\cref{tab:results} for the results.

\\section{Method}\\label{sec:method}

\\begin{equation}\\label{eq:energy}
  E = mc^2
\\end{equation}

\\section{Results}\\label{sec:results}

\\begin{table}[ht]
  \\centering
  \\begin{tabular}{lrr}
    \\toprule
    Method & Accuracy & Time \\\\
    \\midrule
    Baseline & 0.81 & 12s \\\\
    Ours     & 0.93 & 9s  \\\\
    \\bottomrule
  \\end{tabular}
  \\caption{Results.}\\label{tab:results}
\\end{table}

\\printbibliography

\\end{document}
`

const REFERENCES = `@book{lamport1994,
  author    = {Leslie Lamport},
  title     = {{\\LaTeX}: A Document Preparation System},
  edition   = {2},
  publisher = {Addison-Wesley},
  year      = {1994}
}

@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984}
}
`

const THESIS_MAIN = `\\documentclass[12pt, a4paper, oneside]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath, amssymb, amsthm}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage[margin=3cm]{geometry}
\\usepackage{setspace}
\\usepackage[style=numeric, backend=biber]{biblatex}
\\usepackage{hyperref}
\\usepackage[capitalise]{cleveref}

\\addbibresource{references.bib}
\\graphicspath{{figures/}}
\\onehalfspacing

\\title{Thesis Title}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\begin{titlepage}
  \\centering
  \\vspace*{4cm}
  {\\Huge\\bfseries Thesis Title\\par}
  \\vspace{1.5cm}
  {\\Large Your Name\\par}
  \\vfill
  {\\large A thesis submitted for the degree of ...\\par}
  \\vspace{1cm}
  {\\large \\today\\par}
\\end{titlepage}

\\begin{abstract}
Summarise the thesis here.
\\end{abstract}

\\tableofcontents

\\include{chapters/introduction}
\\include{chapters/background}
\\include{chapters/conclusion}

\\printbibliography[heading=bibintoc]

\\end{document}
`

const BEAMER = `\\documentclass{beamer}
\\usetheme{Madrid}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{graphicx}

\\title{Presentation Title}
\\subtitle{Subtitle}
\\author{Your Name}
\\institute{Your Institution}
\\date{\\today}

\\begin{document}

\\frame{\\titlepage}

\\begin{frame}{Outline}
  \\tableofcontents
\\end{frame}

\\section{Introduction}

\\begin{frame}{Motivation}
  \\begin{itemize}
    \\item<1-> First point
    \\item<2-> Second point
    \\item<3-> Third point
  \\end{itemize}
\\end{frame}

\\section{Results}

\\begin{frame}{Two columns}
  \\begin{columns}
    \\column{0.5\\textwidth}
    Text on the left.
    \\column{0.5\\textwidth}
    \\begin{block}{A block}
      Text on the right.
    \\end{block}
  \\end{columns}
\\end{frame}

\\begin{frame}{Thank you}
  \\centering\\Large Questions?
\\end{frame}

\\end{document}
`

const LETTER = `\\documentclass[11pt]{letter}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[margin=2.5cm]{geometry}

\\signature{Your Name}
\\address{Your Street 1 \\\\ 8000 Zürich \\\\ Switzerland}

\\begin{document}

\\begin{letter}{Recipient Name \\\\ Company \\\\ Street 2 \\\\ City}

\\opening{Dear Sir or Madam,}

Write your letter here.

\\closing{Kind regards,}

\\end{letter}

\\end{document}
`

const HOMEWORK = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath, amssymb, amsthm}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{enumitem}
\\usepackage{fancyhdr}

\\pagestyle{fancy}
\\fancyhf{}
\\lhead{Course Name}
\\chead{Problem Set 1}
\\rhead{Your Name}
\\cfoot{\\thepage}

\\newtheorem*{solution}{Solution}

\\begin{document}

\\section*{Problem 1}
Show that $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$.

\\begin{proof}
By induction on $n$. \\dots
\\end{proof}

\\section*{Problem 2}
\\begin{enumerate}[label=(\\alph*)]
  \\item First part.
  \\item Second part.
\\end{enumerate}

\\end{document}
`

const TEMPLATES: Template[] = [
  { id: 'article', name: 'Blank article', description: 'A simple document with a title and one section.', files: { 'main.tex': ARTICLE } },
  {
    id: 'paper',
    name: 'Paper with bibliography',
    description: 'Article with abstract, biblatex citations, cross-references and a table.',
    files: { 'main.tex': PAPER, 'references.bib': REFERENCES }
  },
  {
    id: 'thesis',
    name: 'Thesis / report',
    description: 'Title page, table of contents and one file per chapter.',
    files: {
      'main.tex': THESIS_MAIN,
      'chapters/introduction.tex': '\\chapter{Introduction}\\label{ch:introduction}\n\nWrite the introduction here \\cite{knuth1984}.\n',
      'chapters/background.tex': '\\chapter{Background}\\label{ch:background}\n\nAs discussed in \\cref{ch:introduction}, ...\n',
      'chapters/conclusion.tex': '\\chapter{Conclusion}\\label{ch:conclusion}\n\nSummarise the results.\n',
      'figures/.gitkeep': '',
      'references.bib': REFERENCES
    }
  },
  { id: 'beamer', name: 'Presentation (Beamer)', description: 'Slides with a title page, outline and overlays.', files: { 'main.tex': BEAMER } },
  { id: 'homework', name: 'Problem set', description: 'Header with course and name, problems with proofs.', files: { 'main.tex': HOMEWORK } },
  { id: 'letter', name: 'Letter', description: 'A formal letter with address and signature.', files: { 'main.tex': LETTER } }
]

export function listTemplates(): TemplateInfo[] {
  return TEMPLATES.map(({ id, name, description }) => ({ id, name, description }))
}

export function getTemplate(id: string | undefined): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
}
