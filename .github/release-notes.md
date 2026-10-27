## What's new in 0.4.0

- **Nicer Visual Editor for letters and CVs.** Font groups like `{\bfseries\large Name}` show bold and at the right size, spacing commands (`\vspace`, `\\`, `\par`) disappear, `\hfill` right-aligns a line, and comments become quiet notes instead of raw code.
- **Compiles the document you have open** when it's complete on its own, so a folder of cover letters just works. `% !TEX program = xelatex` is followed, and files that use `fontspec` switch to XeLaTeX automatically.
- **Saves the PDF next to your .tex file** after each compile without errors (can be switched off beside Recompile).
- **Spell checking uses the document's language** from babel or polyglossia, so English letters on a German Mac are no longer underlined everywhere.
- **Faster builds with system fonts:** TeX no longer tries to generate fonts such as Calibri, which took many seconds and could leave junk folders behind.

## Install

Works on macOS 11 or newer, on both Intel and Apple-chip Macs.

1. Install **MacTeX** (free, about 5 GB) from [tug.org/mactex](https://tug.org/mactex/) if you don't have it yet.
2. Download **Underleaf-…dmg** below, open it and drag **Underleaf** into **Applications**.
3. The first time you open it, macOS says it can't verify the app, because Underleaf isn't registered with Apple. Click **Done**, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. On macOS 14 or older, right-click the app and choose **Open** instead.

After that it opens like any other app. Smart completion (texlab) and the spell checker are built in.
