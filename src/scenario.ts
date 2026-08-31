/**
 * 粘贴场景识别。
 *
 * 插件面向前端各种粘贴来源（AI 聊天、网页公式、代码/配置、普通散文、
 * 思源内部复制），不同来源的破坏模式和期望行为不同。本模块把此前堆叠的
 * 启发式守卫整理成显式的有序分类器，上层（index.ts）按场景路由策略。
 *
 * 分类结果只影响"策略选择"，不改变任何修复/转换函数本身。
 */

/** 强 LaTeX 定界符：这些信号出现时内容几乎必然是数学（代码/配置文本不会写这些） */
const STRONG_LATEX_RE = /\\\[|\\\(|\\begin\{|\$\$|\\[a-zA-Z]{2,}/;

/**
 * 代码/配置文本的启发式判定。
 *
 * 特征（任一命中即累计）：
 * - CSS 属性/HTML 属性/JS 成员等引号形态：[attr="v"]、<tag attr="v">、obj["k"]
 * - CSS 声明：#hex 色值、px/em/rem 单位、{...} 含 ":" 规则体
 * - JSON 形态：{"key": value}
 * - 代码关键词行：const/let/function/class/import/def 等（行首）
 * - 运算符形态：=>、===、!==、::、->、; 结尾密度
 *
 * 判定：代码特征 ≥2 个，或 1 个强代码特征（选择器/关键词行/JSON/HTML 标签）
 * 且不存在强 LaTeX 信号（含真实 LaTeX 命令的数学文本不会被误判为代码）。
 */
export function looksLikeCode(text: string): boolean {
    let score = 0;
    const t = text.slice(0, 4000);
    // CSS/HTML/JS 引号形态
    if (/\[[a-zA-Z][\w-]*(?:[~^$*|]?=)\s*["'][^\]"']+["']\]/.test(t) || // [attr="v"]
        /<[a-zA-Z][\w-]*\b[^>]*["'][^>]*["'][^>]*>/.test(t) || // <tag a="v">
        /\.\w+\s*\[["'][^"']+["']\]/.test(t)) { // obj["k"]
        score += 2;
    }
    // JSON 形态
    if (/\{\s*"[^"]+"\s*:/.test(t) && t.includes("}")) {
        score += 2;
    }
    // CSS 规则体：选择器 + 花括号体（@media 等）
    if (/[\w.#][\w.#:@>-]*\s*\{[^{}]*\}/.test(t)) {
        score += 2;
    }
    // CSS 声明特征
    if (/#[0-9a-fA-F]{3,8}\b/.test(t) || /(?:\d+(?:\.\d+)?)(?:px|em|rem|vw|vh|%)\b/.test(t)) {
        score += 1;
    }
    // 代码关键词行（去空白后行首）
    if (/^\s*(const|let|var|function|class|import|export|def|return|if|else|for|while|switch|case|using|package|public|private|static)\b/m.test(t)) {
        score += 2;
    }
    // 运算符形态
    if (/=>|===|!==|::|->/.test(t) || /;\s*$/.test(t)) {
        score += 1;
    }
    if (score < 1) {
        return false;
    }
    // 强 LaTeX 信号存在时不是代码（数学文本优先）
    return !STRONG_LATEX_RE.test(t);
}

export type PasteScenario =
    | "siyuan-internal" // 思源内部复制（siyuanHTML 含公式节点）
    | "code-target"     // 粘贴目标在代码块/行内代码内
    | "code-content"    // 内容判为代码/配置文本
    | "web-math"        // text/html 携带 MathML/KaTeX/MathJax
    | "ai-latex"        // plain 含强 LaTeX 定界符（\[ \( \begin $$ 等）
    | "mixed"           // 有数学信号且与普通正文混合
    | "plain-prose";    // 无任何数学信号

export interface ScenarioInput {
    textPlain: string;
    textHTML: string;
    siyuanHTML: string;
    /** DOM 通道能拿到粘贴目标；事件总线通道传 false（无法感知目标） */
    inCodeTarget: boolean;
}

export type ScenarioPolicy = "smart" | "fix" | "pass";

/** 场景 → 默认策略。smart=智能（见 index.ts 路由）；fix=强制修复；pass=原样。 */
export const DEFAULT_POLICY: Record<PasteScenario, ScenarioPolicy> = {
    "siyuan-internal": "pass",
    "code-target": "pass",
    "code-content": "smart", // 智能=原样+提示（代码不参与公式修复）
    "web-math": "smart",
    "ai-latex": "smart",
    "mixed": "smart",
    "plain-prose": "pass",
};

export function detectPasteScenario(input: ScenarioInput): PasteScenario {
    const {textPlain, textHTML, siyuanHTML, inCodeTarget} = input;
    // 1. 思源内部复制：公式节点齐备，任何二次处理都可能造成重复
    if (siyuanHTML && /data-type="(?:NodeMathBlock|inline-math)"/.test(siyuanHTML)) {
        return "siyuan-internal";
    }
    // 2. 粘贴目标在代码块/行内代码内：代码内容永不参与公式修复
    if (inCodeTarget) {
        return "code-target";
    }
    // 3. 网页公式：HTML 携带 MathML/KaTeX/MathJax 时，以网页内容为准
    if (hasMathML(textHTML)) {
        return "web-math";
    }
    // 4. 代码/配置文本：代码特征强且无强 LaTeX 信号
    if (looksLikeCode(textPlain)) {
        return "code-content";
    }
    // 5. 纯散文：无数学信号
    if (!looksLikeMath(textPlain)) {
        return "plain-prose";
    }
    // 6. 强 LaTeX 定界符 → AI 数学文本
    if (STRONG_LATEX_RE.test(textPlain)) {
        return "ai-latex";
    }
    // 7. 其余有数学信号的内容（弱信号与正文混合）
    return "mixed";
}

/** 计算修复后文本中的公式数量（提示文案用） */
export function countMathFormulas(markdown: string): number {
    const blocks = (markdown.match(/\$\$[\s\S]+?\$\$/g) || []).length;
    const rest = markdown.replace(/\$\$[\s\S]+?\$\$/g, "");
    const inlines = (rest.match(/\$([^$\n]+?)\$/g) || []).length;
    return blocks + inlines;
}

// 避免循环依赖：hasMathML 与 looksLikeMath 在各自模块导出
import { looksLikeMath } from "./fix-latex";
import { hasMathML } from "./mathml";