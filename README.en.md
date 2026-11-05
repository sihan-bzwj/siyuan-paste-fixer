# Paste LaTeX Fixer（粘贴公式修复）

SiYuan note plugin: **auto-repairs LaTeX on paste, converts web MathML and Word formulas into renderable formulas, and keeps the original layout**, with no manual steps.

Since v0.3.0: web formula conversion no longer flattens the whole page into plain text (bold/links/images/lists/tables are all kept); Office math (OMML) from Word / WPS / PPT is converted; a formula inside a table row never tears the table apart; two new commands, "Copy as Markdown (with formulas)" and "Export last paste diagnostic"; a notice when a similar plugin is detected; English i18n and an English README.

v0.2.10 fixed SiYuan 3.8.6's paste event not using the conversion result, the Conservative/Off policies being bypassed by the asynchronous repair, truncated fraction and square-root arguments, misidentified field names, and tasks that kept writing back after unload. Complete superscript tags in bare formulas are restored as math superscripts again; re-converting an existing formula is stable.

> Copying content from AI chat, web pages or documents into SiYuan often leaves formulas as garbage or raw text. This plugin repairs them during paste:
> `[ formula ]` delimiters, `==========` fragments, subscripts lost in `*{b_i}`, missing backslashes in matrix `\`, parenthesised formulas `(W_{ij})`,
> Markdown escapes created by copying inside SiYuan (`y\=Wx`, `\\frac`), bare LaTeX environments — and it converts MathML / MathJax / KaTeX formulas from web pages into renderable formula blocks.
> Block-level formulas are inserted in SiYuan's internal format (real formula blocks, not inline fallbacks).

## What it solves

Copying content from AI chat, web pages or documents into SiYuan often leaves formulas as garbage or raw text. This plugin handles them during paste:

| Source | Handling |
|---|---|
| AI chat text (`[ formula ]` delimiters, `==========` fragments, subscripts in `*{b_i}` eaten by italics, missing backslashes in matrix `\`) | Repaired automatically into `$$...$$` / `$...$` that SiYuan can render |
| Parenthesised inline formulas `(W_{ij})`, `(a_t,b_t)` etc. | Converted to `$(W_{ij})$` / `$(a_t,b_t)$` (only when the content contains LaTeX commands or sub/superscripts) |
| `\[ ... \]`, `\( ... \)` (Typora habit etc.) | Converted to `$$...$$` / `$...$` |
| Bare complete environments `math`, `equation`, `align`, `gather`, `cases`, matrices etc. | Wrapped into inline or block formulas automatically; unclosed environments are kept as-is |
| Native web MathML (Wikipedia, Zhihu etc.) | Converted to LaTeX formulas while keeping the page layout (bold/links/images/lists/tables) |
| MathJax-rendered pages (mjx-container) | The assistive MathML is extracted and converted |
| KaTeX-rendered pages | The source annotation is extracted directly (`<annotation encoding="application/x-tex">`) |
| Office formulas (OMML) copied from Word / WPS / PPT | Converted to LaTeX formulas |
| Web pages whose tables contain formulas | Block formulas inside a cell are downgraded to inline, and a vertical bar inside a formula becomes `\vert`, so the table is never torn apart |

Repaired content goes through SiYuan's Markdown paste path, so `$$...$$` turns into a formula block directly; the page layout (bold/links/images/lists/tables/headings/quotes/code blocks) is kept at the same time.

## Before and after

Content before pasting (copied from AI chat) and after pasting (rendered in SiYuan):

| Scenario | Before (copied from AI) | After (pasted into SiYuan) |
|---|---|---|
| Delimited formula | Wrapped in `[ formula ]`, with the equals signs drawn as a `==========` separator by the AI | `$$L = \frac{1}{n}\sum_{i=1}^{n}(y_i - \hat{y}_i)^2$$` → formula block |
| Subscripts eaten by italics | `*{b_i}*` (asterisks become italics, subscript lost) | `$b_i \sim \mathcal{N}(0, \sigma^2)$` |
| Matrix line breaks | `[ a11 a12 ]`, the `\` line-break markers are gone | `$$\begin{bmatrix} w_{11} & w_{12} \\ w_{21} & w_{22} \end{bmatrix}$$` |
| Parenthesised formula | `(W_{ij})` pasted as-is, not rendered | `$(W_{ij})$` → inline formula |
| Copy inside SiYuan | `y\=Wx` (leftover Markdown escape) | `$y = Wx$` |
| MathML web page | Raw `<math>…</math>` text | MathML → LaTeX → formula block |

> The "After" column is what actually lands in SiYuan — SiYuan renders it as math automatically, **with zero manual steps**.

## Installation

During development one command verifies a real paste (Windows, Node.js 22 or newer):

```powershell
node .\test\live-paste.cjs --workspace D:\siyuan --app D:\app\SiYuan\SiYuan.exe
```

Point the paths at a notebook and a SiYuan executable you are allowed to test with. The script builds the artifacts, performs a native paste in a fresh, isolated test notebook, checks the formula content, the three policy levels, the kernel result and the `.sy` file, then restores the clipboard and the event listeners. Evidence is written to a `_qa_paste_live` directory next to the source workspace; the exit code is 0 on success and 1 on failure. It attaches the candidate code only temporarily and never overwrites an installed plugin; if SiYuan is already running without a debugging port open, it exits instead of restarting SiYuan.

After installing and reloading the fixed build, append `--installed` to the same command to test the plugin instance the host has actually loaded. The script first checks the installed files against the build hash, so an old build is never recorded as a new pass.

Option 1 (from source):

```bash
git clone https://github.com/sihan-bzwj/siyuan-paste-fixer
cd siyuan-paste-fixer
npm install && npm run build
```

Copy the **contents** of `dist/` (`index.js`, `plugin.json`, `i18n/`, `README.md`) into `data/plugins/paste-fixer/` under the SiYuan data directory (create it if missing), restart SiYuan, then enable the plugin in Settings → Plugins.

> Where is the data directory? SiYuan → Settings → About → Open data folder.
> After changing the code, rebuild, copy the `dist/` contents back, then fully quit and restart SiYuan.

Besides automatic paste repair, manual entry points are available (**automatic stays conservative, manual is explicit**):

- **Context menu** (shown depending on context): with a selection → "Force convert to formula" (wraps the selected content as a formula: single line → `$...$`; multiple lines or `<br>` → a local inline formula that keeps the line breaks; whole paragraph → `$$...$$`, reusing the repair engine first to clean up broken parts); when the selection covers a formula node → adds "Revert to plain text"; when the caret is inside a formula → only "Revert to plain text"; **inside code blocks / inline code and for cross-block selections "Force convert" is not shown**; for ordinary text with no selection → nothing is shown
- **Cross-block selection**: "Force convert to formula" works **block by block** — only paragraphs fully covered by the selection are processed (partially intersecting blocks are never touched), and each block goes through the same gate as a single block (type allowlist: paragraph/formula block; no code inside the block; safe to serialise). If any gate fails, only that block is skipped and the hint "converted some paragraphs" is shown. "Revert to plain text" is allowed — it is a node-level operation that only reverts fully selected formula nodes (inline-math replaced in place, formula blocks updated individually); ordinary paragraphs, headings and code are never touched
- **Settings panel**: Settings → Marketplace → Installed plugins → "Paste LaTeX Fixer" → Settings. The five policies are unified into three levels: **Smart** (default, automatic) / **Conservative** (hint only, no rewriting) / **Off** (silent); code content only has Smart (detect + hint) / Off
- **Top-bar Σ button**: only controls the automatic processing switches — the automatic-processing switch for AI math / web formulas / mixed content / undelimited LaTeX (Smart ↔ Conservative), the "detection hint" switch for code content (Smart ↔ Off), and the scenario-hint switch
- **One-click policy switch in hints**: the toast for a successful or hint-only paste carries "Switch to conservative / Switch to smart" buttons; clicking one changes that scenario's policy and persists it. Hints (including the switch entry points) can be turned off with the "Scenario hints" setting
- `Ctrl+P` command palette: force-convert the selection to a formula (uses the latest selection snapshot in the editor)
- The `Ctrl+P` command palette has two more commands: **Copy as Markdown (with formulas)** (selected blocks or a multi-block selection; outputs Markdown with `$...$` / `$$...$$`) and **Export last paste diagnostic** (writes the clipboard source text, the scenario decision and the timing of the most recent paste to JSON, so a bad case is easy to report)

## Scenario detection (v0.2+)

On paste the plugin detects which kind of content and target it is dealing with, and processes it by scenario policy (each scenario can be adjusted in the settings or the top-bar menu):

| Scenario | Default behaviour |
|---|---|
| Copy inside SiYuan (any non-empty siyuanHTML) | Passed through as-is (internal structure and block IDs depend on it) |
| Paste inside a code block | Passed through as-is (code never takes part in formula repair) |
| Code content (CSS/HTML/SCSS/JSON/JS etc.) | Pasted as-is + scenario hint |
| Web formulas (MathML/KaTeX/MathJax) | Raw TeX extraction preferred |
| AI math text | Broken formulas repaired + scenario hint |
| Mixed content | Formulas repaired, prose protected |
| Undelimited LaTeX (bare `\lor`/`\neg` commands without delimiters, common when copying AI plain text) | Smart (default) = wrap formula fragments in `$...$` automatically (verified against the 1149-command KaTeX table; prose, code fences and lines without strong tokens are not converted); Conservative = as-is + hint; Off = silent |
| Plain prose | Passed through as-is |

## What's new in v0.3.0

- **Page layout preserved**: web formula conversion goes HTML → Markdown (no more flattening), so bold/italic/links/images/lists/headings/quotes/code blocks/tables are kept alongside the formulas; if the conversion fails it still falls back to plain text and never loses content.
- **Word formulas (OMML)**: Office MathML (`<m:oMath>`) in Word / WPS / PPT clipboards is converted to LaTeX, covering fractions, sub/superscripts, radicals, sums and integrals, delimiters, functions, accents, matrices, equation systems and other common structures.
- **Table safety**: a block-level formula inside a table row is downgraded to inline automatically, and a bare `|` inside a formula becomes `\vert`, so a single formula can no longer tear a table apart.
- **Copy as Markdown (with formulas)**: run from the command palette; copies the selected blocks (multi-selection works too) as Markdown with `$...$` / `$$...$$`, handy for forums, GitHub and Word.
- **Export last paste diagnostic**: writes the clipboard source text, the scenario decision, the source verdict and the timing of the most recent paste to JSON (workspace `/data/paste-fixer-diagnostics/`; if the file cannot be written it is copied to the clipboard), so reporting a bad case no longer means rebuilding it by hand.
- **Coexistence notice for similar plugins**: when a plugin that also rewrites pastes (such as "text-process" or "latex-paste") is detected, the user is told once, so the two pipelines do not overwrite each other.
- **Performance instrumentation**: a single paste that takes longer than 150 ms logs a console warning (behaviour unchanged); the test suite also has a 1 MB-level input budget case.

## How it works

A single paste channel; ordinary text (code, prices such as `$5 and $10`, links, function calls) is never touched:

1. **Context capture**: a document-level capture listener for the native `paste` event only takes a **read-only snapshot** — whether the paste target is inside a code block, which editor it is in, whether files are attached, and the text content. It **does not intercept, does not modify the clipboard and does not re-dispatch**, so pasting images/attachments passes through untouched and can never be lost, and there are no conflicts with other plugins;
2. **Event bus channel**: when the SiYuan host pastes, it sends a `paste` event to the plugin. The plugin **consumes the most recent snapshot** (500 ms freshness window + text fingerprint match, so a stale context is never used; the code-block target information flows through here, closing the issue #1 gap), decides the scenario, repairs or passes through, and returns the payload through `resolve()`.

The repaired Markdown is converted to SiYuan's internal format (`text/siyuan`) and attached to the paste — **block-level formulas are inserted as real formula blocks** (the SiYuan front-end only parses inline math with Lute, so handing it plain text would downgrade `$$` to an inline formula). Only `$$` blocks in unprotected spans are detected; code fences, links and URLs are handed to Lute as-is (an `<img …>` or a `$$` inside a fence cannot leak out, and attributes are escaped by Lute). MathML (including MathJax/KaTeX source annotations) is handled the same way after conversion to LaTeX.

When the clipboard carries both HTML and plain text, the plugin picks the source by fidelity: HTML is preferred when it carries `data-latex`, a TeX annotation, MathJax v2 source or `alttext`; when only a MathML reverse conversion is available and the plain text already contains complete LaTeX, the plain text is preferred, to avoid duplicating the same formula or losing accuracy in the reverse conversion.

### LaTeX repair rules

- `[ ... ]` (containing `\`, equals signs, sub/superscripts) → `$$ ... $$`; same for `\[...\]`/`\(...\)`
- Complete bare environments are wrapped by type: `math` → inline; `displaymath`/`equation`/`align`/`gather`/`cases`/matrices etc. → block-level
- `( ... )` containing LaTeX commands or sub/superscripts → `$ ... $` (function calls such as `f(x)`, `\left(`, English phrases and link URLs are never touched)
- Markdown escapes from copying inside SiYuan are reverted by context: `\\frac` → `\frac`, `b\_t` → `b_t`; legitimate literal escapes (such as `x\_1`, `\text{A\&B}`) are kept
- `*{...}` / `\*{...}` / `_*{...}` → `_{...}` (subscripts eaten by Markdown italics)
- A single trailing `\` → `\\` (matrix line break); `\` + digit (`2\3\4`) inline → `\\`
- `==========` fragment lines and blank lines between formula fragments → `=` (the AI rendered equals signs as a separator)
- `$ x $` (spaces on both sides) → `$x$` (SiYuan does not parse it otherwise); **multiline `$...$` (reliable content, not crossing a blank line) is upgraded to `$$...$$` automatically** — prices, shell variables, pure number stacks and paragraph boundaries are never paired across lines (all through the same `$` scanner)
- NBSP inside math becomes a normal space and zero-width characters are removed; prose and Unicode math symbols are kept character for character
- Spaces swallowed after a command name are restored (KaTeX treats consecutive letters as one command name and reports `Undefined control sequence`): `\proptoe^{...}` → `\propto e^{...}`, `\langleP_t` → `\langle P_t`, `\rightarrowEdge` → `\rightarrow Edge`. Judged against the full KaTeX command table (`src/latex-commands.ts`); legal commands such as `\bigcup`/`\leftrightarrow`/`\rightarrowtail`/`\top` and out-of-table spellings such as `\intertext` are never touched
- Backtick/tilde fences of any length, inline code, link URLs, image paths and autolink bodies are never processed; explicit formulas inside link text are still repaired
- Incomplete environments, unclosed delimiters and mixed delimiters are not guessed at; keeping the original structure wins

## Known limitations

- When the clipboard carries files/images the plugin passes everything through (payload unchanged; safety first);
- Web formula conversion keeps the common layout tags (bold/italic/links/images/lists/headings/quotes/code blocks/tables); rare semantic tags such as footnotes and form controls degrade to text — losing styling is preferable to losing text;
- Word formulas go through OMML conversion and only `<m:oMath>` is recognised; if the copy source turned the formula into an image (some WeChat public accounts, PDF tools), recovering it needs OCR and is out of scope for this plugin;
- Parenthesis conversion is conservative: parentheses without commands or subscripts, such as `(a,b)`, `(T)`, `(i,j)`, are kept as-is (they cannot be told apart from ordinary parentheses);
- Inline `$` parsing requires SiYuan's "inline formula" setting to be on (on by default);
- When a whole block contains complex formatting (bold, links, inline code and unknown future semantic nodes), manual conversion refuses and asks you to select only the plain-text part — an allowlist-style protection: it is better to miss one edge case than to silently drop formatting;
- When the pasted content is complex rich text (links/images/tables/lists/headings/quotes), the plugin passes it through as-is with a hint and never loses structure for the sake of formulas. After the pass-through there is a **"post-paste fallback"**: once the paste has landed, it repairs the content of formula nodes that **fail to render** (KaTeX parse error) exactly once (changing `data-content` and going through the kernel `updateBlock`, which keeps the block ID and lets the kernel re-render); the scope is limited to blocks that appeared in this paste plus the block holding the caret; a block containing bold/links/inline code or any structure outside the allowlist is skipped entirely (fail-closed); code blocks and inline code are a hard boundary of the plugin (automatic paste, context menu and command palette all stay out);
- Selecting a whole Heading/CodeBlock or another non-paragraph block refuses whole-block conversion (to prevent `updateBlock` from unexpectedly changing the block type).

## Tests

```bash
npm test          # full headless suite
npm run check     # release gate: typecheck → version consistency → full tests → build
npm run release-check  # check + package + release content check
```

1085 assertions cover Ghost paper notes, real Chinese/English Wikipedia MathML, adversarial Markdown, dual-source clipboards, scenario-classifier edge cases (`\frac` inside code, the weak `80%` signal, SCSS variable lines), Lute's isolated-dollar pairing protection, idempotency and 1 MB stress input, plus the new v0.2.x modules: manual conversion (force convert/revert, partial/full fragments, whole-block prefix/suffix decision, no trimming of partial selections, rich-format allowlist protection, cross-block refusal, `<br>` newline serialisation, split-editor derivation), context menu (context-dependent items, the common-menu-open event path, single menu instance reused 10 times without leftovers), settings (load validation, serialized persistence, failure checks), paste routing (code-block target snapshot including the inline-code caret, 500 ms freshness, text fingerprint), the unified `$` scanner (multiline `$...$` upgraded to `$$...$$`, price/shell/blank-line boundary protection, same criteria at the scenario entry points), siyuan-dom (code fence boundary protection, formula attribute escaping, link structure integrity), unified command-word splitting when the space after a command is swallowed (`\proptoe` → `\propto e`, `\langleP_t` → `\langle P_t`, `\rightarrowEdge` → `\rightarrow Edge`, with the KaTeX command-table coverage guard `test/katex-commands.cjs`), post-paste fallback repair (only nodes that failed to render, no change when the repair does not help, inline never upgraded to block, blocks outside the allowlist skipped and rolled back, scope limited to new/caret blocks); every new formula is validated with KaTeX. GitHub Actions runs `npm run check` on every push/PR.

## Project structure

```
src/index.ts        Plugin entry: lifecycle, event registration, top bar, commands, module wiring
src/paste-context.ts  Read-only snapshot of the native paste (code-block target/editor/files; pure functions, unit-testable)
src/scenario.ts     Scenario classifier + paste routing decision (pure functions)
src/manual-action.ts  Manual conversion action layer (force convert/revert, cross-block refusal, allowlist protection)
src/context-menu.ts Context menu (official path + common-menu-open event fallback + timed injection)
src/settings.ts     Settings panel and persistence (validation + serialized saving + failure checks)
src/latex-commands.ts KaTeX command-name table (used by the word-splitting rule; coverage checked by test/katex-commands.cjs)
src/post-paste-repair.ts Post-paste fallback: repairs only formula nodes that failed to render (new/caret blocks, fail-closed)
src/siyuan-dom.ts   Repaired Markdown → SiYuan internal DOM (protected spans handed to Lute, $$ blocks generated by hand)
src/clipboard.ts    HTML/plain clipboard source priority (pure functions)
src/fix-latex.ts    Broken LaTeX repair + inline math tokenizer (pure functions, headless-testable)
src/mathml.ts       MathML/MathJax/KaTeX/OMML → LaTeX, then handed to html-to-markdown
src/html-to-markdown.ts  HTML → Markdown (keeps bold/links/images/lists/tables, v0.3.0)
src/omml.ts         Office MathML (Word/WPS/PPT formulas) → LaTeX
src/compat.ts       Coexistence detection for similar plugins (text-process/latex-paste)
src/diagnostics.ts  Paste diagnostics recording and export (pure functions)
src/copy-markdown.ts Kramdown cleanup for "Copy as Markdown" (pure functions)
src/undelimited.ts  Undelimited LaTeX line-level fragment detection and wrapping (on by default in the Smart level, verified against the KaTeX command table)
test/               Headless tests (KaTeX validation + jsdom coverage for manual actions/menu/settings/routing/DOM)
```
