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

interface ProtectedRange {
    start: number;
    end: number;
}

export interface MarkdownSegment {
    text: string;
    protected: boolean;
}

/** 正则字面量转义，仅用于动态生成占位符恢复表达式。 */
function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 创建与本次输入不冲突的占位符。
 *
 * 旧实现固定使用 \u0001PFB0\u0002；如果用户正文恰好包含同样的控制串，
 * 恢复阶段会把用户内容误当成内部 token。这里先寻找正文中不存在的前缀，
 * 并循环恢复嵌套占位符，使混合定界符也不会泄漏内部标记。
 */
function createPlaceholderCodec(input: string): {
    hold: (math: string) => string;
    restore: (text: string) => string;
    contains: (text: string) => boolean;
} {
    let salt = 0;
    let prefix = `\u0001PFB${salt}:`;
    while (input.includes(prefix)) {
        salt++;
        prefix = `\u0001PFB${salt}:`;
    }
    const queue: string[] = [];
    const tokenRe = new RegExp(escapeRegExp(prefix) + "(\\d+)\\u0002", "g");
    return {
        hold(math: string): string {
            queue.push(math);
            return `${prefix}${queue.length - 1}\u0002`;
        },
        restore(text: string): string {
            let out = text;
            // 嵌套公式最多形成 queue.length 层；多一轮用于确认已完全稳定。
            for (let round = 0; round <= queue.length; round++) {
                const next = out.replace(tokenRe, (_m, i: string) => queue[+i] ?? _m);
                if (next === out) {
                    break;
                }
                out = next;
            }
            return out;
        },
        contains(text: string): boolean {
            return text.includes(prefix);
        },
    };
}

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

/** 文本模式命令：参数里的 \_ 是合法字面下划线，转义还原必须跳过这些 span。 */
const TEXT_MODE_RE = /\\(?:text|textbf|textit|textrm|textsf|texttt|mathrm|mathit|mathbf|mathsf|mathtt|operatorname|operatorname\*)\{[^{}\n]*\}/g;

/**
 * Markdown 转义还原：思源复制文本 / AI 渲染器导出时会给特殊字符加反斜杠。
 * - `\\frac` → `\frac`（仅白名单命令前的双反斜杠折叠；矩阵行分隔 `\\ ` 后跟非字母不动）
 * - `\=` `\{` `\}` `\_` `\^` `\#` `\*` `\~` → 原字符
 */
function deEscapeMath(content: string): string {
    let s = content;
    // \text{a\_b} 等文本命令内的 \_ 是字面下划线（KaTeX 合法），先整体摘出保护
    const textSpans: string[] = [];
    s = s.replace(TEXT_MODE_RE, (m) => {
        textSpans.push(m);
        return `\u0003TX${textSpans.length - 1}\u0004`;
    });
    s = s.replace(/(?<!\\)\\(\\[a-zA-Z]+)/g, (_m, cmd: string) =>
        FOLDABLE_CMD_RE.test(cmd) ? cmd : _m);
    // 思源 Markdown 常把上下标连同分组花括号一起转义；成组修复可以避免
    // 把合法的 x\_1（显示字面下划线）误改为下标。
    s = s.replace(/\\([_^])\\?\{([^{}\n]*)\\?\}/g, "$1{$2}");
    // `a\^\top` 这类损伤没有花括号，但后面紧跟明确的 LaTeX 命令。
    s = s.replace(/\\([_^])(?=\\[a-zA-Z])/g, "$1");
    // 既有真实样本会把 b_t 导出成 b\_t；字母下标按损伤修复。
    // 数字形态 x\_1 常用于显示字面下划线，按本轮约定保留。
    s = s.replace(/\\_([A-Za-z])/g, "_$1");
    // 等号不是 LaTeX 转义命令，出现 \= 可以安全认定为 Markdown 残留。
    s = s.replace(/\\=/g, "=");
    if (textSpans.length) {
        s = s.replace(/\u0003TX(\d+)\u0004/g, (_m, i: string) => textSpans[+i] ?? _m);
    }
    return s;
}

/** 只清理数学区域中的网页格式字符，正文必须逐字保持。 */
function normalizeMathUnicode(content: string): string {
    return content
        .replace(/\u00a0/g, " ")
        .replace(/[\u200b\u200c\u200d\ufeff]/g, "");
}

/**
 * 还原 AI 聊天界面把 LaTeX 命令逐字加下划线装饰的损坏形态：
 * `\̲r̲i̲g̲h̲t̲a̲r̲r̲o̲w̲E̲d̲g̲e̲`（每个字母带 U+0332 组合下划线）→ `\rightarrowEdge`。
 * 只还原装饰字符，不断词——断词由 separateCommandFromEnglishWord 白名单处理。
 * 纯正文不受影响（无 `\`+装饰字母形态）。
 */
function restoreDecoratedCommand(text: string): string {
    return text.replace(/\\[a-zA-Z]\u0332(?:[a-zA-Z]\u0332)+/g, (m) =>
        "\\" + m.slice(1).replace(/\u0332/g, ""));
}

/**
 * 箭头/关系命令后紧跟英文单词时补分隔（白名单 + 大写字母 lookahead）：
 * `\rightarrowEdge` → `\rightarrow Edge`（KaTeX 会把连续字母整段当命令名，
 * 报 Undefined control sequence: \rightarrowEdge）。
 *
 * 只匹配命令名后**紧跟大写字母**：`\rightarrow B`（已有空格）、`\rightarrowtail`、
 * `\top` 等合法命令/正确写法一律不动。
 */
function separateCommandFromEnglishWord(s: string): string {
    return s.replace(
        /\\(rightarrow|leftarrow|Rightarrow|Leftarrow|longrightarrow|longleftarrow|Longrightarrow|Longleftarrow|mapsto|to)(?=[A-Z])/g,
        "\\$1 ",
    );
}

/** 数学区域内修复 */
function fixInsideMath(content: string): string {
    let s = restoreDecoratedCommand(normalizeMathUnicode(content));
    // Markdown 转义还原（\\frac → \frac；\= \_ \^ \{ 等还原为原字符）
    s = deEscapeMath(s);
    // 箭头命令后紧跟大写英文词：补分隔（\rightarrowEdge → \rightarrow Edge）
    s = separateCommandFromEnglishWord(s);
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

/** 收拢后像数学才允许 trim：非空、不含中文/全角、单 token 或含数学符号。 */
function looksLikeInlineTrimCore(core: string): boolean {
    return !!core && !/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(core) &&
        (!/\s/.test(core) || /\\[a-zA-Z]|[_^=]/.test(core));
}

/** 行内公式修复：还原 Markdown 转义；去掉两侧边界空格（$ x $ 思源不解析；但 $5 and $10 这种只右侧有空格的不动） */
function fixInlineMath(content: string): string {
    let s = separateCommandFromEnglishWord(restoreDecoratedCommand(deEscapeMath(normalizeMathUnicode(content))));
    if (/^\s/.test(s) && /\s$/.test(s)) {
        const core = s.trim();
        // 只有"像数学"才收拢边界空格；否则（如"$ 5 和 $"这类金额）保持原样。
        if (looksLikeInlineTrimCore(core)) {
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
    // 引号是代码/CSS 属性选择器/HTML 属性的特征（[data-theme-mode="dark"]），数学公式不会有；
    // 但 \text{"..."} 这类带引号的数学内容含 LaTeX 命令，放行
    if (/["']/.test(content) && !/\\[a-zA-Z]/.test(content)) {
        return false;
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

const INLINE_ENVIRONMENTS = new Set(["math"]);
const STRIP_DISPLAY_ENVIRONMENTS = new Set(["displaymath", "equation", "equation*"]);
const BLOCK_ENVIRONMENTS = new Set([
    "align", "align*", "gather", "gather*", "multline", "multline*",
    "cases", "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix",
    "smallmatrix", "array", "split", "aligned", "alignedat", "gathered",
]);

/**
 * 将完整的裸 LaTeX 环境补成思源可识别的公式。
 * 不完整环境一律原样返回；同名环境嵌套时按深度配对，避免只截到第一个 \end。
 */
function convertBareEnvironments(
    text: string,
    hold: (math: string) => string,
    containsPlaceholder: (text: string) => boolean,
): string {
    const beginRe = /\\begin\{([A-Za-z]+\*?)\}/g;
    let out = "";
    let pos = 0;
    let match: RegExpExecArray | null;
    while ((match = beginRe.exec(text))) {
        const env = match[1];
        if (!INLINE_ENVIRONMENTS.has(env) && !STRIP_DISPLAY_ENVIRONMENTS.has(env) &&
            !BLOCK_ENVIRONMENTS.has(env)) {
            continue;
        }
        const beginToken = match[0];
        const endToken = `\\end{${env}}`;
        let depth = 1;
        let cursor = match.index + beginToken.length;
        let end = -1;
        while (cursor < text.length) {
            const nextBegin = text.indexOf(beginToken, cursor);
            const nextEnd = text.indexOf(endToken, cursor);
            if (nextEnd < 0) {
                break;
            }
            if (nextBegin >= 0 && nextBegin < nextEnd) {
                depth++;
                cursor = nextBegin + beginToken.length;
                continue;
            }
            depth--;
            cursor = nextEnd + endToken.length;
            if (depth === 0) {
                end = cursor;
                break;
            }
        }
        if (end < 0) {
            // fail-closed：没有完整结尾时，保留从 begin 开始的全部文本。
            break;
        }
        const whole = text.slice(match.index, end);
        if (containsPlaceholder(whole)) {
            // 已嵌套另一种公式定界符，属于混合/不规范输入，不进行猜测性包装。
            continue;
        }
        const inner = text.slice(match.index + beginToken.length, end - endToken.length).trim();
        let replacement: string;
        if (INLINE_ENVIRONMENTS.has(env)) {
            replacement = `$${luteSafeInline(fixInlineMath(inner))}$`;
        } else if (STRIP_DISPLAY_ENVIRONMENTS.has(env)) {
            replacement = `$$\n${fixInsideMath(inner)}\n$$`;
        } else {
            replacement = `$$\n${fixInsideMath(whole).trim()}\n$$`;
        }
        out += text.slice(pos, match.index) + hold(replacement);
        pos = end;
        beginRe.lastIndex = end;
    }
    return out + text.slice(pos);
}

/** `( ... )` 内容像数学（含 LaTeX 命令或下标/上标）才转换 */
function looksLikeParenMath(content: string): boolean {
    if (content.includes("\n") || content.includes("://") ||
        /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(content)) {
        return false; // 跨行、URL、含中文/全角符号 → 是普通括号文本
    }
    // （"url", x_i）这类带引号的代码元组不是数学；\text{"..."} 含命令则放行
    if (/["']/.test(content) && !/\\[a-zA-Z]/.test(content)) {
        return false;
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
            !PAREN_GUARD_RE.test(text.slice(Math.max(0, i - 4), i)) &&
            !isInsideUrl(text, i)) {
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

/** 判断当前位置是否位于 Markdown 目标地址或裸 URL 中。 */
function isInsideUrl(text: string, index: number): boolean {
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    const before = text.slice(lineStart, index);
    const lastSpace = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\t"));
    const token = before.slice(lastSpace + 1);
    if (/^(?:https?:\/\/|www\.)/i.test(token) || /(?:https?:\/\/|www\.)[^\s]*$/i.test(before)) {
        return true;
    }
    const destination = before.lastIndexOf("](");
    if (destination >= 0) {
        // 只要目标地址还没出现顶层右括号，就视为 URL 区域。
        let depth = 1;
        for (let i = destination + 2; i < before.length; i++) {
            if (before[i] === "\\") {
                i++;
            } else if (before[i] === "(") {
                depth++;
            } else if (before[i] === ")") {
                depth--;
            }
        }
        return depth > 0;
    }
    return false;
}

/**
 * Lute 行内数学拒绝"开头 $ 后紧跟数字"（实测：$0<x\le1$、$2x$、$4^n$、$3.14$
 * 全部按纯文本处理）。数字打头的内容包一层花括号即可通过解析，
 * KaTeX 渲染 `{...}` 与原文完全等价。仅对"可靠像数学"的内容包装，
 * 金额（$5 and $、$100 元）不受影响。
 */
function luteSafeInline(content: string): string {
    return /^\d/.test(content) && isReliableDollarPair(content) ? `{${content}}` : content;
}

/** 单段（无代码围栏）修复 */
function fixTextSegment(seg: string): string {
    let s = separateCommandFromEnglishWord(restoreDecoratedCommand(seg));
    const codec = createPlaceholderCodec(seg);
    const {hold, restore, contains} = codec;
    // 1. 先保护已有公式。这样不规范的 $x+\(y\)+z$ 不会被改成嵌套美元公式。
    s = s.replace(BLOCK_DOLLAR_RE, (_m, inner: string) =>
        contains(inner) ? _m : hold("$$" + fixInsideMath(inner) + "$$"));
    // 行内 $...$：手工扫描。当配对内容"两侧空格且不像数学"（金额等）时只消费开头的 $，
    // 让后续 $ 有机会与更近的闭合配对（"费用 $ 100 与公式 $ x $" 中 $x$ 仍能转换）。
    {
        let outText = "";
        let pos = 0;
        INLINE_DOLLAR_RE.lastIndex = 0;
        let inlineMatch: RegExpExecArray | null;
        while ((inlineMatch = INLINE_DOLLAR_RE.exec(s))) {
            const inner = inlineMatch[1];
            const fixedInner = fixInlineMath(inner);
            if (/^\s/.test(inner) && /\s$/.test(inner) &&
                !looksLikeInlineTrimCore(inner.trim()) && fixedInner === inner) {
                outText += s.slice(pos, inlineMatch.index + 1);
                pos = inlineMatch.index + 1;
                INLINE_DOLLAR_RE.lastIndex = pos;
                continue;
            }
            outText += s.slice(pos, inlineMatch.index) + hold("$" + luteSafeInline(fixedInner) + "$");
            pos = inlineMatch.index + inlineMatch[0].length;
        }
        s = outText + s.slice(pos);
    }
    // 2. \[ ... \] → $$ ... $$；\( ... \) → $ ... $。
    // 内容含已有公式占位符说明是混合定界符，保持原定界符，不继续嵌套转换。
    s = s.replace(BLOCK_BRACKET_RE, (whole, inner: string) =>
        contains(inner) ? whole : hold("$$\n" + fixInsideMath(inner.trim()) + "\n$$"));
    s = s.replace(INLINE_BRACKET_RE, (whole, inner: string) => {
        if (contains(inner)) {
            return whole;
        }
        const t = inner.trim();
        // 跨行的 \( ... \) 按块级处理（与 \[ \] 对齐）
        return hold(t.includes("\n") ? "$$\n" + fixInsideMath(t) + "\n$$" : "$" + luteSafeInline(fixInlineMath(t)) + "$");
    });
    // 3. 完整裸环境 → 行内或块级公式。
    s = convertBareEnvironments(s, hold, contains);
    // 4. 裸 [ ... ] 块 → 占位
    s = convertBareBlocks(s, hold);
    // 5. 裸 ( ... ) 数学 → 占位
    s = convertParenMath(s, hold);
    // 6. 还原；restore 会处理混合输入产生的嵌套 token。
    return restore(s);
}

/** 固定长度检查 URL 协议，避免在超长输入的每个字符处 slice 到文末导致 O(n²)。 */
function startsHttpUrl(text: string, index: number): boolean {
    const head = text.slice(index, index + 8).toLowerCase();
    return head.startsWith("http://") || head.startsWith("https://");
}

/**
 * 收集 Markdown 中必须逐字保护的范围。
 *
 * 这是一个小型状态扫描器而不是完整 Markdown 解析器，只负责本插件需要的边界：
 * - 行首至多三个空格后的任意长度 ``` / ~~~ 围栏；闭合长度不得短于开头；
 * - 任意长度行内反引号，闭合 run 必须等长；
 * - Markdown 链接/图片目标地址、自动链接与裸 http(s) URL。
 *
 * 围栏或行内代码未闭合时保护到文末，符合“宁可不修复，也不破坏代码”的策略。
 */
function findProtectedMarkdownRanges(text: string): ProtectedRange[] {
    const ranges: ProtectedRange[] = [];
    let i = 0;
    let lineStart = 0;
    // 上一行是否为空行/纯空白（CommonMark 缩进代码块的起始条件之一）
    const prevLineBlank = (): boolean => {
        if (lineStart === 0) {
            return true;
        }
        const prevNl = lineStart - 1;
        const prevStart = text.lastIndexOf("\n", prevNl - 1) + 1;
        return text.slice(prevStart, prevNl).trim() === "";
    };
    while (i < text.length) {
        // 缩进代码块：前一行空行 + 本行 4 空格/Tab 起（普通段落缩进不满足前导空行条件，不受影响）
        if (i === lineStart && prevLineBlank()) {
            let q = i;
            let eff = 0;
            while (text[q] === " ") {
                eff++;
                q++;
            }
            if (text[q] === "\t") {
                eff += 4;
            }
            if (eff >= 4) {
                const start = i;
                let cursor = i;
                let end = text.length;
                while (cursor < text.length) {
                    const lineEnd = text.indexOf("\n", cursor);
                    const limit = lineEnd < 0 ? text.length : lineEnd;
                    if (text.slice(cursor, limit).trim() === "") {
                        cursor = lineEnd < 0 ? text.length : lineEnd + 1;
                        continue; // 空行暂续，后续非缩进行会收口
                    }
                    let r = cursor;
                    let eff2 = 0;
                    while (text[r] === " ") {
                        eff2++;
                        r++;
                    }
                    if (text[r] === "\t") {
                        eff2 += 4;
                    }
                    if (eff2 >= 4) {
                        cursor = lineEnd < 0 ? text.length : lineEnd + 1;
                    } else {
                        end = cursor;
                        break;
                    }
                }
                ranges.push({start, end});
                i = end;
                lineStart = text.lastIndexOf("\n", i - 1) + 1;
                continue;
            }
        }

        // 块围栏只允许出现在行首 0～3 个空格后。
        const column = i - lineStart;
        if ((text[i] === "`" || text[i] === "~") && column <= 3 &&
            text.slice(i - column, i).trim() === "") {
            const marker = text[i];
            let run = 1;
            while (text[i + run] === marker) run++;
            if (run >= 3) {
                const start = i - column;
                let cursor = text.indexOf("\n", i + run);
                if (cursor < 0) {
                    ranges.push({start, end: text.length});
                    break;
                }
                cursor++;
                let end = text.length;
                while (cursor < text.length) {
                    const lineEnd = text.indexOf("\n", cursor);
                    const limit = lineEnd < 0 ? text.length : lineEnd;
                    let p = cursor;
                    let spaces = 0;
                    while (spaces < 4 && text[p] === " ") {
                        spaces++;
                        p++;
                    }
                    let closeRun = 0;
                    while (text[p + closeRun] === marker) closeRun++;
                    if (spaces <= 3 && closeRun >= run && text.slice(p + closeRun, limit).trim() === "") {
                        end = lineEnd < 0 ? text.length : lineEnd + 1;
                        break;
                    }
                    cursor = lineEnd < 0 ? text.length : lineEnd + 1;
                }
                ranges.push({start, end});
                i = end;
                lineStart = text.lastIndexOf("\n", i - 1) + 1;
                continue;
            }
        }

        // 行内代码：相同长度的反引号 run 才能闭合。
        if (text[i] === "`") {
            let run = 1;
            while (text[i + run] === "`") run++;
            let cursor = i + run;
            let close = -1;
            while (cursor < text.length) {
                const next = text.indexOf("`", cursor);
                if (next < 0) break;
                let closeRun = 1;
                while (text[next + closeRun] === "`") closeRun++;
                if (closeRun === run) {
                    close = next + closeRun;
                    break;
                }
                cursor = next + closeRun;
            }
            const end = close < 0 ? text.length : close;
            ranges.push({start: i, end});
            i = end;
            lineStart = text.lastIndexOf("\n", i - 1) + 1;
            continue;
        }

        // Markdown 目标地址：保留 ]( 与最终 ) 给普通段，地址主体逐字保护。
        if (text[i] === "]" && text[i + 1] === "(") {
            let depth = 1;
            let cursor = i + 2;
            while (cursor < text.length && depth > 0) {
                if (text[cursor] === "\\") {
                    cursor += 2;
                    continue;
                }
                if (text[cursor] === "(") depth++;
                else if (text[cursor] === ")") depth--;
                cursor++;
            }
            if (depth === 0) {
                ranges.push({start: i + 2, end: cursor - 1});
                i = cursor;
                lineStart = text.lastIndexOf("\n", i - 1) + 1;
                continue;
            }
            // 未闭合链接目标同样 fail-closed。
            ranges.push({start: i + 2, end: text.length});
            break;
        }

        // <https://...> 自动链接。
        if (text[i] === "<" && startsHttpUrl(text, i + 1)) {
            const close = text.indexOf(">", i + 1);
            const end = close < 0 ? text.length : close + 1;
            ranges.push({start: i, end});
            i = end;
            lineStart = text.lastIndexOf("\n", i - 1) + 1;
            continue;
        }

        // 裸 URL 保护到空白或尖括号；末尾标点即使被纳入也只是原样输出。
        if (startsHttpUrl(text, i)) {
            let end = i;
            while (end < text.length && !/[\s<>]/.test(text[end])) end++;
            ranges.push({start: i, end});
            i = end;
            lineStart = text.lastIndexOf("\n", i - 1) + 1;
            continue;
        }
        if (text[i] === "\n") {
            lineStart = i + 1;
        }
        i++;
    }
    return ranges;
}

/** 将 Markdown 拆成可处理段与必须逐字保留段，供粘贴 DOM 生成器复用。 */
export function splitMarkdownSegments(text: string): MarkdownSegment[] {
    const ranges = findProtectedMarkdownRanges(text);
    const segments: MarkdownSegment[] = [];
    let last = 0;
    for (const range of ranges) {
        if (range.start < last) continue;
        if (range.start > last) {
            segments.push({text: text.slice(last, range.start), protected: false});
        }
        segments.push({text: text.slice(range.start, range.end), protected: true});
        last = range.end;
    }
    if (last < text.length) {
        segments.push({text: text.slice(last), protected: false});
    }
    return segments;
}

export interface MaskedMarkdown {
    /** 保护段替换为占位符后的文本：按 $$ 切块不会误伤代码/链接。 */
    masked: string;
    stash: string[];
    /** 把占位符还原为保护段原文；index 非法时保留原 token。 */
    restore: (s: string) => string;
}

export interface DollarMaskResult {
    /** 只把可能扰乱 Lute 配对的美元符号换成占位符后的 Markdown。 */
    masked: string;
    /** 被遮蔽的美元符号数量；为 0 时调用方可以继续走普通纯文本通道。 */
    count: number;
    /** Lute 完成 Markdown 解析后再调用，把占位符恢复成可见的普通 `$` 文本。 */
    restore: (s: string) => string;
}

/** 判断当前位置的美元符号是否已被奇数个反斜杠转义。 */
function isEscapedDollar(text: string, index: number): boolean {
    let slashes = 0;
    for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
        slashes++;
    }
    return slashes % 2 === 1;
}

/**
 * 判断一对单美元定界符中间是否足够像公式。
 *
 * 这里比通用的 looksLikeMath 更严格，因为目标不是“决定是否修复正文”，而是
 * “决定是否把这两个 `$` 交给 Lute 配对”。中文句子、金额范围和 Shell 片段
 * 一旦被误配，Lute 会把很长一段正文吞进 KaTeX；单个变量、数字、LaTeX 命令
 * 以及带常见运算符的表达式则可以安全视为公式。
 */
function isReliableDollarPair(content: string): boolean {
    const core = content.trim();
    if (!core || /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(core)) {
        return false;
    }
    if (/\s/.test(core) && !/\\[A-Za-z]+|[_^=+*/<>≤≥×÷∞α-ωΑ-Ω]/.test(core)) {
        return false;
    }
    return /\\[A-Za-z]+|[_^=+*/<>≤≥×÷∞α-ωΑ-Ω]|^[A-Za-z0-9.(),-]+$/.test(core);
}

export interface InlineMathToken {
    /** true=数学对（$...$ 且内容可靠），text 为不含定界符的公式本体；false=普通文本 */
    math: boolean;
    text: string;
}

/**
 * 把文本按可靠的 `$...$` 数学对切成片段（供手动转换、公式计数等共用）。
 *
 * 配对规则与 maskLuteUnsafeDollars 的行内分支一致（同一行、未转义闭合、内容
 * 通过 isReliableDollarPair）：`$5 and $10`、未闭合美元、转义美元都按普通文本
 * 保留，避免金额/Shell 变量被误当成公式。块级 `$$...$$` 不属于行内配对，原样
 * 留在文本片段中，由调用方决定如何处理。
 */
export function tokenizeInlineMath(markdown: string): InlineMathToken[] {
    const out: InlineMathToken[] = [];
    let buf = "";
    let i = 0;
    while (i < markdown.length) {
        if (markdown[i] === "$" && !isEscapedDollar(markdown, i)) {
            if (markdown[i + 1] === "$") {
                // 块级 $$...$$ 原子跳过：整块留在文本段，不参与行内配对
                let close = i + 2;
                while ((close = markdown.indexOf("$$", close)) >= 0) {
                    if (!isEscapedDollar(markdown, close)) {
                        break;
                    }
                    close += 2;
                }
                const end = close >= 0 ? close + 2 : markdown.length;
                buf += markdown.slice(i, end);
                i = end;
                continue;
            }
            let close = i + 1;
            while (close < markdown.length && markdown[close] !== "\n") {
                if (markdown[close] === "$" && !isEscapedDollar(markdown, close)) {
                    break;
                }
                close++;
            }
            if (close < markdown.length && markdown[close] === "$" &&
                isReliableDollarPair(markdown.slice(i + 1, close))) {
                if (buf) {
                    out.push({math: false, text: buf});
                    buf = "";
                }
                out.push({math: true, text: markdown.slice(i + 1, close)});
                i = close + 1;
                continue;
            }
        }
        buf += markdown[i];
        i++;
    }
    if (buf) {
        out.push({math: false, text: buf});
    }
    return out;
}

/**
 * 遮蔽会让 Lute 重新错配的孤立/非公式美元符号。
 *
 * 背景：`$4^n$ ... $2\cos` 里第一对是完整公式，最后一个 `$` 未闭合。
 * 修复文本若直接交给 Lute，它可能从第一个 `$` 一直配到最后一个 `$`，于是
 * 中间那个合法闭合符落入数学内容，KaTeX 报 “Can't use function '$'”。
 *
 * 扫描策略是 fail-closed：
 * - 完整 `$$...$$` 原样交给 Lute；未闭合 `$$` 遮蔽；
 * - 单美元只在内容可靠像数学时成对保留；否则先遮蔽当前 `$`，再从下一个
 *   美元重试，使 `费用 $ 100 与公式 $ x $` 仍能识别最后的 `$ x $`；
 * - 遮蔽只用于 Markdown→DOM 的中间过程。Lute 解析完后恢复为普通文本，
 *   因而用户看到的字符不变，也不改变 fixLatexText 的逐字保留约定。
 *
 * 调用方应先用 maskProtectedSegments 遮蔽代码、链接和 URL，再把其 masked
 * 结果传入本函数，避免检查这些保护结构内部本来就无需解析的美元符号。
 */
export function maskLuteUnsafeDollars(text: string): DollarMaskResult {
    let salt = 0;
    while (text.includes(`\u0001PFD${salt}:`)) {
        salt++;
    }
    const prefix = `\u0001PFD${salt}:`;
    const unsafe = new Set<number>();
    let i = 0;

    while (i < text.length) {
        if (text[i] !== "$" || isEscapedDollar(text, i)) {
            i++;
            continue;
        }

        // 块级 $$：只接受同一段中真实闭合的下一组 $$。
        if (text[i + 1] === "$" && !isEscapedDollar(text, i + 1)) {
            let close = i + 2;
            while ((close = text.indexOf("$$", close)) >= 0) {
                if (!isEscapedDollar(text, close)) {
                    break;
                }
                close += 2;
            }
            if (close >= 0) {
                i = close + 2;
                continue;
            }
            unsafe.add(i);
            unsafe.add(i + 1);
            i += 2;
            continue;
        }

        // 行内 $：只在本行寻找下一个未转义的单美元作为候选闭合符。
        let close = i + 1;
        while (close < text.length && text[close] !== "\n") {
            // 紧邻公式 `$x$$y$` 的中间两枚美元分别是前式闭合和后式开头，
            // 因此候选闭合符后面即使还是 `$` 也不能跳过。
            if (text[close] === "$" && !isEscapedDollar(text, close)) {
                break;
            }
            close++;
        }
        if (close < text.length && text[close] === "$" &&
            isReliableDollarPair(text.slice(i + 1, close))) {
            i = close + 1;
            continue;
        }

        // 当前候选不可靠时只遮蔽开头，下一枚 $ 仍可与其后的定界符配对。
        unsafe.add(i);
        i++;
    }

    if (!unsafe.size) {
        return {masked: text, count: 0, restore: (s: string) => s};
    }
    let tokenIndex = 0;
    const parts: string[] = [];
    for (let pos = 0; pos < text.length; pos++) {
        parts.push(unsafe.has(pos) ? `${prefix}${tokenIndex++}\u0002` : text[pos]);
    }
    const tokenRe = new RegExp(escapeRegExp(prefix) + "(\\d+)\\u0002", "g");
    return {
        masked: parts.join(""),
        count: unsafe.size,
        restore: (s: string): string =>
            s.replace(tokenRe, (_m, index: string) => +index < unsafe.size ? "$" : _m),
    };
}

/**
 * 遮蔽保护段供 DOM 生成器使用。
 * 与公式占位符分开编号（PFM），并按输入加盐，避免正文中的宿敌字符串碰撞。
 */
export function maskProtectedSegments(text: string): MaskedMarkdown {
    let salt = 0;
    while (text.includes(`\u0001PFM${salt}:`)) {
        salt++;
    }
    const tokenRe = new RegExp(`\u0001PFM${salt}:(\\d+)\u0002`, "g");
    const stash: string[] = [];
    const maskedParts: string[] = [];
    let last = 0;
    for (const range of findProtectedMarkdownRanges(text)) {
        if (range.start < last) {
            continue;
        }
        if (range.start > last) {
            maskedParts.push(text.slice(last, range.start));
        }
        stash.push(text.slice(range.start, range.end));
        maskedParts.push(`\u0001PFM${salt}:${stash.length - 1}\u0002`);
        last = range.end;
    }
    maskedParts.push(text.slice(last));
    return {
        masked: maskedParts.join(""),
        stash,
        restore: (s: string): string =>
            stash.length ? s.replace(tokenRe, (_m, i: string) => stash[+i] ?? _m) : s,
    };
}

/**
 * 修复整段文本。代码围栏（```）内部不处理。
 * 无数学信号时保证返回原字符串。
 */
export function fixLatexText(text: string): string {
    if (!text) {
        return text;
    }
    let out = "";
    for (const segment of splitMarkdownSegments(text)) {
        out += segment.protected ? segment.text : fixTextSegment(segment.text);
    }
    return out;
}
