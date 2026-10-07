/**
 * 未定界 LaTeX 行级识别（v0.2.9，opt-in）。
 *
 * 场景：AI 聊天复制的纯文本把定界符全丢——`\lor`、`\land`、`\neg`、
 * `\sum m(1, 3, 5)` 等裸 LaTeX 命令散布在中文正文里，无任何 $ / \( / $$ 定界。
 * 此类文本默认判 plain-prose 原样放行；用户在设置中把「未定界 LaTeX 策略」
 * 改为「始终修复公式」后，才走这里的行级片段包裹。
 *
 * 判定与切分全部基于 v0.2.7 的 KaTeX 已知命令表（LATEX_COMMANDS，1149 项）：
 * - 强 token：已知命令、`^`、`_`（紧跟操作数）；
 * - 片段：从起点连续吞噬 math token（命令/上下标/运算符/数字/单字母变量/
 *   平衡括号组/中间空格——空格后必须仍是 math token 才继续）；
 * - 片段有效条件：含 ≥1 个强 token——"T 换成 F"、"Page 94-96"、"小项编号 +
 *   大项编号" 这类无强 token 的正文不会被转；
 * - CJK/全角/未知命令一律终止片段（保守）。
 */

import {splitMarkdownSegments} from "./fix-latex";
import {LATEX_COMMANDS} from "./latex-commands";

const MATH_PUNCT = "=+-*/<>,.;:!?'`|~&";

/** `\command`（已知命令）；未知命令返回 null（保守终止）。 */
function matchCommand(text: string, i: number): number {
    if (text[i] !== "\\") {
        return -1;
    }
    const m = /^\\([a-zA-Z]+)/.exec(text.slice(i));
    if (!m || !LATEX_COMMANDS.has(m[1])) {
        return -1;
    }
    return m[0].length;
}

/** 平衡组（( ) / [ ] / { }）扫描；未闭合返回 -1。 */
function findBalanced(text: string, open: number, openCh: string, closeCh: string): number {
    let depth = 0;
    let j = open;
    for (; j < text.length && j - open <= 500; j++) {
        const c = text[j];
        if (c === "\\") {
            j++;
            continue;
        }
        if (c === openCh) {
            depth++;
        } else if (c === closeCh) {
            depth--;
            if (depth === 0) {
                return j;
            }
        }
    }
    return -1;
}

/** 位置 k 是否为 math token 起点（空格 lookahead 用）。 */
function isMathTokenStart(text: string, k: number): boolean {
    const c = text[k];
    if (c === "\\") {
        return matchCommand(text, k) > 0;
    }
    if (c === "^" || c === "_") {
        return true;
    }
    if (MATH_PUNCT.includes(c)) {
        return true;
    }
    if (/[0-9({[]/.test(c)) {
        return true;
    }
    // 单字母变量（后随非字母才成立，避免吞英文单词）
    if (/[A-Za-z]/.test(c) && !/[A-Za-z]/.test(text[k + 1] ?? "")) {
        return true;
    }
    return false;
}

/**
 * 从 start 起贪婪匹配一个连续 LaTeX 片段。
 * 返回片段结束位置与是否含强 token；无效片段返回 null。
 */
function parseMathFragment(line: string, start: number): {end: number, strong: boolean} | null {
    let j = start;
    let strong = false;
    let lastEnd = -1;
    while (j < line.length) {
        const c = line[j];
        if (c === "\\") {
            const len = matchCommand(line, j);
            if (len < 0) {
                break; // 未知命令：保守终止（不吞不转）
            }
            strong = true;
            j += len;
            lastEnd = j;
            continue;
        }
        if (c === "^" || c === "_") {
            strong = true;
            j++;
            if (line[j] === "\\") {
                const len = matchCommand(line, j);
                if (len < 0) {
                    break;
                }
                j += len;
            } else if (line[j] === "{") {
                const close = findBalanced(line, j, "{", "}");
                if (close < 0) {
                    break;
                }
                j = close + 1;
            } else if (j < line.length && (/[A-Za-z0-9]/.test(line[j]) || MATH_PUNCT.includes(line[j]))) {
                // 操作数：单字符、或上标符号（A^* 的 *）
                j++;
            } else {
                break;
            }
            lastEnd = j;
            continue;
        }
        if (MATH_PUNCT.includes(c)) {
            j++;
            lastEnd = j;
            continue;
        }
        if (c === "(" || c === "[" || c === "{") {
            const close = findBalanced(line, j, c, c === "(" ? ")" : c === "[" ? "}" : "]");
            if (close < 0) {
                break;
            }
            // 组内含命令/上下标/反斜杠 → 视为强（如 (\neg P_1)）
            if (/[\\^_]/.test(line.slice(j, close + 1))) {
                strong = true;
            }
            j = close + 1;
            lastEnd = j;
            continue;
        }
        if (/[0-9]/.test(c)) {
            while (j < line.length && /[0-9.]/.test(line[j])) {
                j++;
            }
            lastEnd = j;
            continue;
        }
        if (/[A-Za-z]/.test(c)) {
            let k = j;
            while (k < line.length && /[A-Za-z]/.test(line[k])) {
                k++;
            }
            if (k - j === 1) {
                j = k; // 单字母变量
                lastEnd = j;
                continue;
            }
            break; // 多字母英文单词 = 正文
        }
        if (/\s/.test(c)) {
            let k = j;
            while (k < line.length && /\s/.test(line[k])) {
                k++;
            }
            if (k < line.length && isMathTokenStart(line, k)) {
                j = k;
                continue;
            }
            break;
        }
        break; // CJK/全角/其它 → 片段终止
    }
    if (lastEnd <= start || !strong) {
        return null;
    }
    return {end: lastEnd, strong};
}

/** 非保护段强 token（已知命令、跟随操作数的 ^/_）计数 ≥2 → 未定界 LaTeX 场景。 */
export function needsUndelimitedDetection(text: string): boolean {
    let count = 0;
    for (const segment of splitMarkdownSegments(text)) {
        if (segment.protected) {
            continue;
        }
        const t = segment.text;
        let i = 0;
        while (i < t.length) {
            if (t[i] === "\\") {
                const len = matchCommand(t, i);
                if (len > 0) {
                    count++;
                    i += len;
                    continue;
                }
            }
            if ((t[i] === "^" || t[i] === "_") && !/[\^_]/.test(t[i - 1] ?? "") &&
                /[A-Za-z0-9{\\]/.test(t[i + 1] ?? "")) {
                count++;
                i++;
                continue;
            }
            i++;
        }
        if (count >= 2) {
            return true;
        }
    }
    return false;
}

/**
 * 行级片段包裹：每行独立扫描，有效片段包成 `$...$`（片段首尾空格归到行文本）。
 * 保护段（代码围栏/行内代码/链接/URL）原样；无有效片段的行逐字保留。
 */
export function convertUndelimitedLatex(text: string): string {
    return splitMarkdownSegments(text)
        .map((segment) => segment.protected ? segment.text : convertLines(segment.text))
        .join("");
}

function convertLines(block: string): string {
    return block.split("\n").map(convertLine).join("\n");
}

function convertLine(line: string): string {
    let out = "";
    let i = 0;
    while (i < line.length) {
        // 空格直接输出：片段必须从非空格 token 开始（避免片段吞前导空格后
        // trim 把"· \lor"的空格吃掉）
        if (/\s/.test(line[i])) {
            out += line[i];
            i++;
            continue;
        }
        const frag = parseMathFragment(line, i);
        if (frag) {
            out += "$" + line.slice(i, frag.end).trim() + "$";
            // 片段后的尾随空格保留在行文本里
            i = frag.end;
            continue;
        }
        out += line[i];
        i++;
    }
    return out;
}