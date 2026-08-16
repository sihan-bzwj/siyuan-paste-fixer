/**
 * MathML → LaTeX：
 * - 原生 MathML（Wikipedia 等网页）：mathml2latex 转换；
 * - MathJax（mjx-container 内含 assistive MathML）：转换后整块替换；
 * - KaTeX（<annotation encoding="application/x-tex"> 内含原始 TeX）：直接取源码。
 * 转换完成后把整个 HTML 提取为带换行的纯文本（公式已是 $...$ / $$...$$ 形式），
 * 供思源走 Markdown 粘贴路径解析成公式块。
 */

import mathml2latex from "mathml2latex";

// 匹配 <math>、<mml:math>、<m:math>（Word 的 <m:oMath> 不算，思源内核自行处理）
const MATHML_TAGS = 'math, mml\\:math, m\\:math';

export function hasMathML(html: string): boolean {
    return /<\/?(?:[a-z0-9]+:)?math[\s>]/i.test(html) ||
        /class="katex|annotation\s+encoding|mjx-container|class="MathJax/i.test(html);
}

const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
    "TR", "TD", "TH", "TABLE", "PRE", "BLOCKQUOTE", "SECTION", "ARTICLE",
    "HR", "DL", "DT", "DD", "HEADER", "FOOTER", "MAIN", "ASIDE",
]);
const IGNORE_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "HEAD", "TITLE", "META", "LINK", "TEMPLATE",
]);

export interface MathMLResult {
    text: string;
    count: number;
}

function htmlToText(root: Node): string {
    const parts: string[] = [];
    const walk = (node: Node): void => {
        if (node.nodeType === 3) {
            parts.push(node.nodeValue || "");
            return;
        }
        if (node.nodeType !== 1) {
            return;
        }
        const el = node as HTMLElement;
        const tag = el.tagName;
        if (IGNORE_TAGS.has(tag)) {
            return;
        }
        if (tag === "BR") {
            parts.push("\n");
            return;
        }
        if (tag === "IMG") {
            parts.push(el.getAttribute("alt") || "");
            return;
        }
        if (BLOCK_TAGS.has(tag)) {
            parts.push("\n");
        }
        el.childNodes.forEach(walk);
        if (BLOCK_TAGS.has(tag)) {
            parts.push("\n");
        }
    };
    walk(root);
    return parts.join("")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

export function convertMathMLInHTML(html: string): MathMLResult {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let count = 0;

    // 1. KaTeX 等渲染器的 TeX 源码注解，最保真
    Array.from(doc.querySelectorAll("annotation")).forEach((ann) => {
        const enc = (ann.getAttribute("encoding") || "").toLowerCase();
        if (!enc.includes("tex") || enc.includes("mathml")) {
            return;
        }
        const tex = (ann.textContent || "").trim();
        if (!tex) {
            return;
        }
        const katexRoot = ann.closest(".katex");
        const target = (katexRoot || ann) as HTMLElement;
        const isDisplay = !!ann.closest(".katex-display") ||
            ann.closest("mjx-container")?.getAttribute("display") === "true";
        target.replaceWith(doc.createTextNode(isDisplay ? "$$\n" + tex + "\n$$" : "$" + tex + "$"));
        count++;
    });

    // 2. 原生 MathML / MathJax assistive MathML
    Array.from(doc.querySelectorAll(MATHML_TAGS)).forEach((el) => {
        const mml = el as HTMLElement;
        try {
            const latex = mathml2latex.convert(mml.outerHTML);
            if (!latex || !latex.trim()) {
                return;
            }
            const container = (mml.closest("mjx-container") || mml) as HTMLElement;
            const isDisplay = mml.getAttribute("display") === "block" ||
                container.getAttribute("display") === "true";
            const wrapped = isDisplay ? "\n$$\n" + latex.trim() + "\n$$\n" : "$" + latex.trim() + "$";
            container.replaceWith(doc.createTextNode(wrapped));
            count++;
        } catch (e) {
            // 转换失败则保留原样
        }
    });

    if (count === 0) {
        return { text: "", count: 0 };
    }
    return { text: htmlToText(doc.body), count };
}
