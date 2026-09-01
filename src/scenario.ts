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
 * 强特征（单个即可判定，即使内容含 LaTeX 命令——代码字符串里的 `\frac` 不是数学）：
 * - 行首代码关键词行：const/let/function/class/import/def 等；
 * - CSS 规则体：行首选择器 + `{ ... }`；
 * - JSON 对象字面量：{"key": value}；
 * - HTML 标签带引号属性；`[attr="v"]` 引号形态选择器。
 *
 * 弱特征（需 ≥2 个且无强 LaTeX 信号才判定为代码）：
 * - CSS 声明：#hex 色值与 px/em/rem/vw/vh 单位；
 * - 运算符形态：=>、===、!==、::、->；; 结尾。
 *
 * 单个弱特征（如一句带 `=>` 或 `;` 的正文）不再算代码，避免“完成了 80%”
 * 这类普通句子被误判为 code-content。
 */
export function looksLikeCode(text: string): boolean {
    const t = text.slice(0, 4000);
    // 强特征：行首关键词行
    if (/^\s*(const|let|var|function|class|import|export|def|return|if|else|for|while|switch|case|using|package|public|private|static|async)\b/m.test(t)) {
        return true;
    }
    // 强特征：SCSS/LESS 变量声明行（$name: value;）
    if (/^\s*\$[\w-]+\s*:/.test(t)) {
        return true;
    }
    // 强特征：CSS 规则体（行首选择器 + {...}；选择器不允许反斜杠，避免误吞 \begin{...}）
    if (/^\s*[.#@:\w-]+[\w.#:@>+~()[\]*="' -]*\{[^{}]*\}/m.test(t)) {
        return true;
    }
    // 强特征：JSON 对象字面量
    if (/\{\s*"[^"]+"\s*:\s*(?:"[^"]*"|\d+|true|false|null|\[|\{)/.test(t)) {
        return true;
    }
    // 强特征：HTML 标签带引号属性 / [attr="v"] 引号形态选择器
    if (/<[a-zA-Z][\w-]*\b[^>]*["'][^>]*["'][^>]*>/.test(t)) {
        return true;
    }
    if (/\[[a-zA-Z][\w-]*(?:[~^$*|]?=)\s*["'][^\]"']+["']\]/.test(t)) {
        return true;
    }
    // 弱特征累计
    let weak = 0;
    if (/#[0-9a-fA-F]{3,8}\b/.test(t)) {
        weak++;
    }
    if (/(?:\d+(?:\.\d+)?)(?:px|em|rem|vw|vh)\b/.test(t)) {
        weak++;
    }
    if (/=>|===|!==|::|->/.test(t)) {
        weak++;
    }
    if (/\.\w+\s*\[["'][^"']+["']\]/.test(t)) {
        weak++; // obj["k"] 成员访问形态
    }
    if (/;\s*$/.test(t)) {
        weak++;
    }
    // 强 LaTeX 信号存在时弱特征不生效（数学文本优先）
    return weak >= 2 && !STRONG_LATEX_RE.test(t);
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
    // 4. 代码/配置文本：只看非保护段（fenced code 不参与代码/数学竞争，
    //    外部有公式 + 内部有 JS 时只按外部正文判定）
    if (looksLikeCode(nonProtectedText(textPlain))) {
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

/** 计算修复后文本中的公式数量（提示文案用；统一扫描器口径：inline+block，允许跨行，跳过保护段） */
export function countMathFormulas(markdown: string): number {
    let count = 0;
    for (const segment of splitMarkdownSegments(markdown)) {
        if (segment.protected) {
            continue;
        }
        for (const t of tokenizeMath(segment.text, {multiline: true})) {
            if (t.kind !== "text") {
                count++;
            }
        }
    }
    return count;
}

export interface PastePlanInput {
    textPlain: string;
    textHTML: string;
    siyuanHTML: string;
    /** 原生 paste 快照提供的目标上下文（DOM 捕获通道；事件总线自身无法感知） */
    inCodeTarget: boolean;
    getPolicy: (scenario: PasteScenario) => ScenarioPolicy;
}

/**
 * 复杂富文本结构判定（链接/图片/表格/列表/标题/引用）：这些结构无法无损重写，
 * 粘贴时插件 fail-closed 原样放行（绝不为了公式丢结构）。
 */
export function hasComplexRichHTML(textHTML: string): boolean {
    return /<(a|img|table|pre|ul|ol|li|h[1-6]|blockquote)[\s>]/i.test(textHTML);
}

export interface PastePlan {
    scenario: PasteScenario;
    /** pass=原样放行（含需要提示的情况）；fix=进入修复管线 */
    action: "pass" | "fix";
    /** pass 时是否给出场景提示（提示文案与数量由上层处理） */
    hint: boolean;
}

/**
 * 粘贴路由的唯一决策入口（EventBus paste 事件调用）。
 *
 * 固定放行场景（siyuan-internal / code-target / plain-prose）直接原样；
 * code-content 智能策略与所有 pass 策略原样 + 提示；其余进入修复管线。
 */
export function planPasteHandling(input: PastePlanInput): PastePlan {
    const scenario = detectPasteScenario({
        textPlain: input.textPlain,
        textHTML: input.textHTML,
        siyuanHTML: input.siyuanHTML,
        inCodeTarget: input.inCodeTarget,
    });
    if (scenario === "siyuan-internal" || scenario === "code-target" || scenario === "plain-prose") {
        return {scenario, action: "pass", hint: false};
    }
    const policy = input.getPolicy(scenario);
    if (policy === "pass" || (policy === "smart" && scenario === "code-content")) {
        return {scenario, action: "pass", hint: true};
    }
    return {scenario, action: "fix", hint: false};
}

// 避免循环依赖：hasMathML 与 looksLikeMath 在各自模块导出
import { looksLikeMath, nonProtectedText, splitMarkdownSegments, tokenizeMath } from "./fix-latex";
import { hasMathML } from "./mathml";