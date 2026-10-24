# Third-party software

Underleaf's own code is MIT licensed (see `LICENSE`). The app is built with, and ships, the
following third-party software under their own licenses.

## Bundled programs

| Program | Version | License | Source |
| --- | --- | --- | --- |
| texlab (LaTeX language server) | 5.26.0 | GPL-3.0 | https://github.com/latex-lsp/texlab/tree/v5.26.0 |

texlab is included unmodified as a separate program (`Contents/Resources/bin/texlab`) that
Underleaf starts and talks to over standard input/output. Its source code is available at the
link above, and the full license text is in `licenses/texlab-GPL-3.0.txt`. The binary is the
official release from https://github.com/latex-lsp/texlab/releases/tag/v5.26.0.

## Libraries in the app

| Library | License |
| --- | --- |
| Electron | MIT |
| React, React DOM | MIT |
| CodeMirror 6 (`@codemirror/*`) and Lezer | MIT |
| PDF.js (`pdfjs-dist`) | Apache-2.0 |

Underleaf does not include a TeX distribution. Compiling uses the MacTeX installation on the
user's computer.
