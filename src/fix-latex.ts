/**
 * 修复从 AI 聊天等来源粘贴的破损 LaTeX。
 *
 * AI 文本在复制过程中常见的损坏：
 * - 用 `[ ... ]` 包裹公式（AI 渲染习惯），思源不认；
 * - 用 `( ... )` 包裹行内公式（如 (W_{ij})、(a_t,b_t)）；
 * - `\[ ... \]` / `\( ... \)` 定界符（Typora 等习惯）；
 * - 下标记号被 Markdown 斜体吃掉：`*{b_i}` / `\*{b_i}` → `_{b_i}`；
 * - 矩阵换行符被吃掉一个反斜杠：行尾 `\` → `\\`，行内 `\3` → `\\3`；
 * - 公式碎片标记行：`==========`（AI 渲染把等号画成分割线）；
 * - 行内公式边界被空格撑开：`$ x $` 思源不解析。
 *
 * 设计原则：只修复"看起来像数学"的区域，普通文本一律原样返回。
 * 所有新生成的公式统一用占位符保护，避免各规则互相误伤
 * （比如方括号块转出的 $$...$$ 不再被圆括号扫描二次处理）。
 */

const BLOCK_BRACKET_RE = /\\\[([\s\S]+?)\\\]/g; // \[ ... \]
const INLINE_BRACKET_RE = /\\\(([\s\S]{0,500}?)\\\)/g; // \( ... \)（内容可含括号，如 \( f(x) \)；上限防未闭合时 O(n²)）
const BLOCK_DOLLAR_RE = /\$\$([\s\S]+?)\$\$/g; // $$ ... $$
const INLINE_DOLLAR_RE = /\$([^$\n\u0001\u0002]+)\$/g; // $ ... $（单行；不穿过占位符）
const FENCE_RE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g; // 代码围栏（反引号 + GFM 波浪线）

// 占位符防止公式内容被后续规则二次处理（正文不会出现 \u0001/\u0002）
const PH = (i: number) => `\u0001PFB${i}\u0002`;
const PH_RE = /\u0001PFB(\d+)\u0002/g;

/** 强数学特征：单个 LaTeX 命令即可判定（用于单行 [ ... ] 块） */
const STRONG_TOKEN_RE = /\\(?:frac|dfrac|sum|int|prod|sqrt|mathbb|left|right|text|begin|end|boxed|underbrace|overbrace|otimes|times|partial|nabla|to|rightarrow|Rightarrow|approx|cdot|cdots|vdots|ddots|top|quad|qquad|displaystyle)/;

/** 数学信号（粘贴拦截和右键菜单显示判断共用；含 Markdown 转义形态） */
const MATH_SIGNALS_RE = /\$\$|\\\[|\\\]|\\\(|\\\)|\\begin\{|\\boxed\{|\\underbrace\{|\\frac\{|<math[\s>]|\\\\[a-zA-Z]|\\[_=^]/i;

export function looksLikeMath(text: string): boolean {
    return MATH_SIGNALS_RE.test(text) || (text.match(/\$/g) || []).length >= 2;
}

/** 双反斜杠折叠白名单：只有这些命令前的 \\ 才可能是 Markdown 转义损伤（\\frac → \frac）。
 *  不含单字母标识符：矩阵行分隔 \\ 后紧跟下一行内容（如 \\L_3、\\c_{21}）不能被误折叠。 */
const FOLDABLE_CMD_RE = /\\(?:frac|dfrac|tfrac|cfrac|sqrt|sum|prod|coprod|int|oint|iint|iiint|iiiint|lim|liminf|limsup|log|ln|lg|exp|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|arcsin|arccos|arctan|arg|max|min|sup|inf|det|gcd|dim|ker|Pr|deg|hom|partial|nabla|infty|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|mathbf|mathit|mathrm|mathcal|mathscr|mathbb|mathfrak|mathsf|mathtt|operatorname|text|textbf|textit|textrm|left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|begin|end|label|ref|eqref|tag|underbrace|overbrace|overline|underline|widehat|widetilde|vec|hat|bar|tilde|dot|ddot|dddot|acute|grave|breve|check|times|cdot|cdots|vdots|ddots|ldots|dots|geq|leq|geqslant|leqslant|neq|ne|approx|equiv|sim|simeq|cong|propto|to|rightarrow|longrightarrow|leftarrow|longleftarrow|Rightarrow|Longrightarrow|Leftarrow|in|notin|ni|subset|subseteq|supset|supseteq|cup|cap|forall|exists|nexists|pm|mp|circ|bullet|oplus|otimes|oslash|odot|star|ast|mid|parallel|perp|angle|langle|rangle|vert|Vert|binom|choose|pmod|mod|bmod|land|lor|neg|ell|hbar|imath|jmath|Re|Im|aleph|emptyset|varnothing|displaystyle|textstyle|scriptstyle|overset|underset|substack|boxed|smash|phantom|vphantom|hphantom|mathop|mathbin|mathrel|mathord|quad|qquad|sdot|lesssim|gtrsim|doteq|mapsto|longmapsto|hookrightarrow|iff|implies|models|vdash|dashv|therefore|because|triangle|top|bot|smallmatrix|subarray)/;

/**
 * Markdown 转义还原：思源复制文本 / AI 渲染器导出时会给特殊字符加反斜杠。
 * - `\\frac` → `\frac`（仅白名单命令前的双反斜杠折叠；矩阵行分隔 `\\ ` 后跟非字母不动）
 * - `\=` `\{` `\}` `\_` `\^` `\#` `\*` `\~` → 原字符
 */
function deEscapeMath(content: string): string {
    let s = content;
    s = s.replace(/(?<!\\)\\(\\[a-zA-Z]+)/g, (_m, cmd: string) =>
        FOLDABLE_CMD_RE.test(cmd) ? cmd : _m);
    s = s.replace(/\\([=_^#{}*~])/g, "$1");
    return s;
}

/** 数学区域内修复 */
function fixInsideMath(content: string): string {
    let s = content;
    // Markdown 转义还原（\\frac → \frac；\= \_ \^ \{ 等还原为原字符）
    s = deEscapeMath(s);
    // 下标记号被 Markdown 斜体吃掉：_*{x}、*{x}、_\*{x}、\*{x} → _{x}
    s = s.replace(/_?\\?\*\{/g, "_{");
    // 行尾单个反斜杠（Markdown 粘贴丢了一个反斜杠，应为矩阵换行 \\）
    s = s.replace(/(?<!\\)\\(?=\n)/g, "\\\\");
    // 行内 \ 后跟数字（如 2\3\4 挤在一行的矩阵）：\ 不是合法命令前缀，补成 \\
    s = s.replace(/(?<!\\)\\([0-9])/g, "\\\\$1");
    // 纯 = 行（连同后续空行）：AI 渲染把公式里的等号画成了分割线，恢复为 =
    s = s.replace(/(\n|^)[ \t]*=+[ \t]*(?:\n|$)+/g, " = ");
    // 纯 - 行（连同后续空行）：普通分割线残留，删除
    s = s.replace(/(\n|^)[ \t]*-{2,}[ \t]*(?:\n|$)+/g, "$1");
    // 公式片段间的空行：等号被渲染完全吞掉后只剩空行，同样恢复为 =
    s = s.replace(/\n[ \t]*\n+/g, " = ");
    return s;
}

/** 行内公式修复：还原 Markdown 转义；去掉两侧边界空格（$ x $ 思源不解析；但 $5 and $10 这种只右侧有空格的不动） */
function fixInlineMath(content: string): string {
    let s = deEscapeMath(content);
    if (/^\s/.test(s) && /\s$/.test(s)) {
        const core = s.trim();
        if (!core) {
            return s; // "$ $" 空内容保持原样，防止收拢成 "$$"
        }
        // 只有"像数学"才收拢边界空格：不含中文/全角，且是单 token 或含数学符号。
        // 否则（如"$ 5 和 $"这类金额）保持原样，避免把两处美元拼成一段。
        if (!/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(core) &&
            (!/\s/.test(core) || /\\[a-zA-Z]|[_^=]/.test(core))) {
            s = core;
        }
    }
    return s;
}

/** 颜文字形状：T_T、^_^、^^、Q_Q、x_x、>_< 等（含 _ 或 ^ 但不是数学） */
function looksLikeEmoticon(s: string): boolean {
    const t = s.trim();
    if (!/[_^]/.test(t)) {
        return false;
    }
    if (/^(\w)[_^]\1$/.test(t)) {
        return true; // T_T、x_x、Q_Q、T^T
    }
    if (!/[A-Za-z0-9\\{}]/.test(t)) {
        return true; // ^_^、^^、>_< 纯符号
    }
    if (/^[_^]/.test(t)) {
        return true; // _x、^2 打头
    }
    return false;
}

/** `[ ... ]` 内容像 LaTeX 才转换 */
function looksLikeLatexBlock(content: string): boolean {
    if (/\](\(|\[)/.test(content)) {
        return false; // Markdown 链接/引用 [text](url)、[ref][id]
    }
    if (/[\[\]]/.test(content) && !/\\[bB]igg?[lrm]?\s*[\[\]]|\\left\s*[\[\]]|\\right\s*[\[\]]/.test(content)) {
        return false; // 含裸方括号（[[wiki]]、[a [b]]）不整体转；\left[ \right] 等 LaTeX 定界符放行
    }
    // 中文/全角内容只有带 LaTeX 命令时才可能是公式（[步骤1=初始化] 是文本）
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(content) && !/\\[a-zA-Z]/.test(content)) {
        return false;
    }
    if (/\\begin\{|\\boxed\{|\\underbrace\{|\\overbrace\{/.test(content)) {
        return true;
    }
    if (content.includes("\\")) {
        const commands = content.match(/\\[a-zA-Z]+\{?/g) || [];
        if (commands.length >= 2) {
            return true;
        }
        if (STRONG_TOKEN_RE.test(content)) {
            return true;
        }
        // Markdown 转义损坏：\\命令（双反斜杠）或 \= \_ \^（符号被转义）
        if (/\\\\[a-zA-Z]/.test(content) || /\\?[_^=]/.test(content)) {
            return true;
        }
        return false;
    }
    // 无反斜杠：跨行块有下标/上标/等号即数学；单行需等号（且非逗号数组）或上下标
    if (content.includes("\n")) {
        return /[_^=]/.test(content); // 如 [ y_i ]、[ z_1,z_2,z_3 ]
    }
    if (/=/.test(content) && !/,/.test(content)) {
        return true; // 如 [ y=Wx ]、[ a=x ]
    }
    if (looksLikeEmoticon(content)) {
        return false; // [T_T]、[^_^]
    }
    const marks = content.match(/[_^]/g) || [];
    if (marks.length >= 2) {
        return true; // 如 [ z_1,z_2,z_3 ]
    }
    // 单处上下标且形状像变量：[a_i]、[x^2]；但 [ref_id]（双字母前缀）、[^1] 脚注不转
    if (marks.length === 1 && /^[A-Za-z][A-Za-z0-9]?[_\^]\w/.test(content.trim())) {
        return true;
    }
    return false;
}

/** 平衡括号扫描 `[ ... ]`，把像 LaTeX 的块转成 $$ ... $$。
 *  单遍栈配对（O(n)）：病态输入（大量未闭合 `[`）不会触发 O(n²) 扫描卡死编辑器 */
function convertBareBlocks(text: string, hold: (math: string) => string): string {
    // 找出所有顶层配对的 [ ... ]（跳过 \ 转义；内层括号不单独处理）
    const stack: number[] = [];
    const pairs: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\\") {
            i++; // 跳过转义字符
            continue;
        }
        if (c === "[") {
            stack.push(i);
        } else if (c === "]") {
            const s = stack.pop();
            if (s !== undefined && stack.length === 0) {
                pairs.push({start: s, end: i});
            }
        }
    }
    if (pairs.length === 0) {
        return text;
    }
    // 按原顺序重组：判定通过的块替换为 $$ 公式，其余原样保留
    const parts: string[] = [];
    let pos = 0;
    for (const {start, end} of pairs) {
        const content = deEscapeMath(text.slice(start + 1, end));
        const after = text[end + 1] ?? "";
        const looksMath = looksLikeLatexBlock(content);
        const multiline = content.includes("\n");
        const strongSingle = !content.includes("\\") || STRONG_TOKEN_RE.test(content) ||
            /\\begin\{|\\boxed\{|\\underbrace\{|\\overbrace\{/.test(content);
        if (looksMath && (multiline || strongSingle) && after !== "(" && after !== "[") {
            // 去掉独占一行的 # 标题残留：# [公式] 中的 # 是渲染伪影
            let prefix = text.slice(pos, start);
            prefix = prefix.replace(/(\n|^)([ \t]*#+[ \t]*)$/, "$1");
            parts.push(prefix);
            parts.push(hold("$$\n" + fixInsideMath(content).trim() + "\n$$"));
        } else {
            parts.push(text.slice(pos, end + 1));
        }
        pos = end + 1;
    }
    parts.push(text.slice(pos));
    return parts.join("");
}

/** `( ... )` 内容像数学（含 LaTeX 命令或下标/上标）才转换 */
function looksLikeParenMath(content: string): boolean {
    if (content.includes("\n") || content.includes("://") ||
        /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(content)) {
        return false; // 跨行、URL、含中文/全角符号 → 是普通括号文本
    }
    if (content.includes("\\")) {
        // Windows 路径（C:\、UNC \\、.\ 相对路径）不是公式
        if (/^[a-zA-Z]:[\\/]|^\\\\|^\.[\\/]/.test(content)) {
            return false;
        }
        // 必须是真正的 LaTeX 命令（\in、\frac 等）；转义形式经 deEscapeMath 已还原为符号
        return /\\[a-zA-Z]+/.test(content);
    }
    if (looksLikeEmoticon(content)) {
        return false; // (^_^)、(T_T)、(^^) 颜文字
    }
    if (/[a-zA-Z0-9]{2}[_^]/.test(content)) {
        return false; // my_var、foo^bar 等代码标识符（下标/上标前只有一个字母才是常见数学写法）
    }
    if (/^[a-zA-Z]\w*\([^()]*\)$/.test(content)) {
        return false; // 函数调用形状 f(x)、a_i(b)
    }
    return /[_^]/.test(content); // 下标/上标，如 (W_{ij})、(a_t, b_t)
}

/** `(` 前是这些关键字/标识符时跳过：\left(、\big(、函数调用 f(x)、链接 ]( */
const PAREN_GUARD_RE = /(?:left|right|[bB]ig[lmr]?|[bB]igg[lmr]?)$/;

/** 平衡括号扫描 `( ... )`，把像数学的内容转成 $ ... $ */
function convertParenMath(text: string, hold: (math: string) => string): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        const prev = text[i - 1] ?? "";
        if (ch === "(" && prev !== "\\" && !/[a-zA-Z0-9_)\]]/.test(prev) &&
            !PAREN_GUARD_RE.test(text.slice(Math.max(0, i - 4), i))) {
            // 尝试找配对的 )
            let depth = 0;
            let j = i;
            for (; j < text.length && j - i <= 200; j++) {
                const c = text[j];
                if (c === "\\") {
                    j++;
                    continue;
                }
                if (c === "(") depth++;
                else if (c === ")") {
                    depth--;
                    if (depth === 0) break;
                }
            }
            if (j < text.length) {
                const content = deEscapeMath(text.slice(i + 1, j));
                if (looksLikeParenMath(content)) {
                    out += hold("$(" + content + ")$");
                    i = j + 1;
                    continue;
                }
            }
        }
        out += ch;
        i++;
    }
    return out;
}

/** 单段（无代码围栏）修复 */
function fixTextSegment(seg: string): string {
    let s = seg;
    const queue: string[] = [];
    const hold = (math: string): string => {
        queue.push(math);
        return PH(queue.length - 1);
    };
    // 1. \[ ... \] → $$ ... $$ ；\( ... \) → $ ... $（立即占位，后续规则不再处理）
    s = s.replace(BLOCK_BRACKET_RE, (_m, inner: string) => hold("$$\n" + inner.trim() + "\n$$"));
    s = s.replace(INLINE_BRACKET_RE, (_m, inner: string) => {
        const t = inner.trim();
        // 跨行的 \( ... \) 按块级处理（与 \[ \] 对齐）
        return hold(t.includes("\n") ? "$$\n" + t + "\n$$" : "$" + t + "$");
    });
    // 2. 现有 $$ 块和 $ 行内 → 占位 + 区域内修复（保持原有定界形式，不额外加换行）
    s = s.replace(BLOCK_DOLLAR_RE, (_m, inner: string) =>
        inner.includes("\u0001") ? _m : hold("$$" + fixInsideMath(inner) + "$$"));
    s = s.replace(INLINE_DOLLAR_RE, (_m, inner: string) => hold("$" + fixInlineMath(inner) + "$"));
    // 3. 裸 [ ... ] 块 → 占位
    s = convertBareBlocks(s, hold);
    // 4. 裸 ( ... ) 数学 → 占位
    s = convertParenMath(s, hold);
    // 5. 还原
    s = s.replace(PH_RE, (_m, i: string) => queue[+i]);
    return s;
}

/**
 * 修复整段文本。代码围栏（```）内部不处理。
 * 无数学信号时保证返回原字符串。
 */
export function fixLatexText(text: string): string {
    let out = "";
    let last = 0;
    FENCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FENCE_RE.exec(text))) {
        out += fixTextSegment(text.slice(last, m.index));
        out += m[0];
        last = FENCE_RE.lastIndex;
    }
    out += fixTextSegment(text.slice(last));
    return out;
}
