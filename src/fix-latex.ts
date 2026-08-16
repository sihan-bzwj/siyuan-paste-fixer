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
const INLINE_BRACKET_RE = /\\\(([^()\n]+?)\\\)/g; // \( ... \)（不跨行）
const BLOCK_DOLLAR_RE = /\$\$([\s\S]+?)\$\$/g; // $$ ... $$
const INLINE_DOLLAR_RE = /\$([^$\n]+)\$/g; // $ ... $（单行）
const FENCE_RE = /```[\s\S]*?(?:```|$)/g; // 代码围栏

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

/**
 * Markdown 转义还原：思源复制文本 / AI 渲染器导出时会给特殊字符加反斜杠。
 * - `\\frac` → `\frac`（命令前的双反斜杠折叠；矩阵行分隔 `\\ ` 后跟非字母不动）
 * - `\=` `\{` `\}` `\_` `\^` `\#` `\*` `\~` → 原字符
 */
function deEscapeMath(content: string): string {
    let s = content;
    s = s.replace(/\\\\(?=[a-zA-Z])/g, "\\");
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
        s = s.trim();
    }
    return s;
}

/** `[ ... ]` 内容像 LaTeX 才转换 */
function looksLikeLatexBlock(content: string): boolean {
    if (/\](\(|\[)/.test(content)) {
        return false; // Markdown 链接/引用 [text](url)、[ref][id]
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
    // 无反斜杠：跨行块有下标/上标/等号即数学；单行需等号（且非逗号数组）或多处上下标
    if (content.includes("\n")) {
        return /[_^=]/.test(content); // 如 [ y_i ]、[ z_1,z_2,z_3 ]
    }
    if (/=/.test(content) && !/,/.test(content)) {
        return true; // 如 [ y=Wx ]、[ a=x ]
    }
    const marks = content.match(/[_^]/g) || [];
    if (marks.length >= 2) {
        return true; // 如 [ z_1,z_2,z_3 ]
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
        return true; // LaTeX 命令，如 (a\in\mathbb R^{4096})
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
    s = s.replace(INLINE_BRACKET_RE, (_m, inner: string) => hold("$" + inner.trim() + "$"));
    // 2. 现有 $$ 块和 $ 行内 → 占位 + 区域内修复（保持原有定界形式，不额外加换行）
    s = s.replace(BLOCK_DOLLAR_RE, (_m, inner: string) => hold("$$" + fixInsideMath(inner) + "$$"));
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
