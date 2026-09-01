/**
 * 剪贴板来源裁决。
 *
 * 浏览器通常同时提供 text/plain 与 text/html。两份内容可能来自不同渲染层：
 * plain 可能保留原始 LaTeX，也可能只是视觉文本；HTML 可能携带原始 TeX，
 * 也可能只剩需要反推的 MathML。这里把优先级集中成纯函数，两个粘贴通道
 * 共用同一套规则，也能在 Node/jsdom 中直接测试。
 */

import {fixLatexText, scanDollarMath, splitMarkdownSegments} from "./fix-latex";
import {convertMathMLInHTML, hasMathML, MathSourceKind} from "./mathml";

export interface ClipboardDecision {
    markdown: string;
    source: "plain" | "html";
    /** HTML 公式是网页原始 TeX 还是从 MathML 反推。plain 固定为 none。 */
    htmlQuality: "exact" | "derived" | "none";
    sourceKinds: MathSourceKind[];
}

const COMPLETE_ENV_RE = /\\begin\{(math|displaymath|equation\*?|align\*?|gather\*?|multline\*?|cases|(?:p|b|B|v|V)?matrix|smallmatrix|array|split|aligned|alignedat|gathered)\}[\s\S]*?\\end\{\1\}/;

/**
 * 判断 plain 是否含可独立使用的完整公式。
 * 单个 `$HOME`、金额和未闭合定界符不算；完整环境、\(...\)、\[...\]、
 * $$...$$ 以及内容带数学信号的 $...$（统一扫描器口径，允许跨行）才能参与
 * “plain 优先”裁决；只扫描非保护段，代码围栏里的 $ 不算信号。
 */
export function hasReliablePlainMath(text: string): boolean {
    if (/\\\[[\s\S]+?\\\]|\\\([\s\S]{1,500}?\\\)|\$\$[\s\S]+?\$\$/.test(text) ||
        COMPLETE_ENV_RE.test(text)) {
        return true;
    }
    for (const segment of splitMarkdownSegments(text)) {
        if (segment.protected) {
            continue;
        }
        if (scanDollarMath(segment.text, {multiline: true}).length > 0) {
            return true;
        }
    }
    return false;
}

function hasExactTexSource(kinds: MathSourceKind[]): boolean {
    return kinds.some((kind) => kind !== "mathml");
}

/** 无需插件干预时返回 null。 */
export function selectClipboardMarkdown(
    textHTML: string,
    textPlain: string,
    siyuanHTML: string,
): ClipboardDecision | null {
    // 思源内部复制已经带公式节点，结构最完整，任何二次处理都可能造成重复。
    if (siyuanHTML && /data-type="(?:NodeMathBlock|inline-math)"/.test(siyuanHTML)) {
        return null;
    }

    const fixedPlain = fixLatexText(textPlain);
    const plainChanged = fixedPlain !== textPlain;
    const plainReliable = hasReliablePlainMath(textPlain);

    if (hasMathML(textHTML)) {
        const htmlResult = convertMathMLInHTML(textHTML);
        if (htmlResult.count > 0) {
            // 极少数 HTML 片段会把 math/tex script 解析进 <head>，导致公式计数成功
            // 但正文提取为空。此时绝不能用空字符串覆盖剪贴板，退回 plain。
            if (!htmlResult.text.trim()) {
                if (!textPlain) return null;
                return {
                    markdown: fixedPlain,
                    source: "plain",
                    htmlQuality: htmlResult.quality,
                    sourceKinds: htmlResult.sourceKinds,
                };
            }
            // HTML 携带原始 TeX 时始终优先。只有纯 MathML 推导且 plain 已有完整
            // 定界公式时才选 plain，避免反推过程损失命令或排版语义。
            if (hasExactTexSource(htmlResult.sourceKinds) || !plainReliable) {
                return {
                    markdown: fixLatexText(htmlResult.text),
                    source: "html",
                    htmlQuality: htmlResult.quality,
                    sourceKinds: htmlResult.sourceKinds,
                };
            }
            return {
                markdown: fixedPlain,
                source: "plain",
                htmlQuality: htmlResult.quality,
                sourceKinds: htmlResult.sourceKinds,
            };
        }
    }

    if (plainChanged) {
        return {markdown: fixedPlain, source: "plain", htmlQuality: "none", sourceKinds: []};
    }
    return null;
}
