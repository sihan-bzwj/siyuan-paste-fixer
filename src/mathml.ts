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
        /class="katex|annotation\s+encoding|mjx-container|class="MathJax/i.test(html) ||
        /<script[^>]*type=["']?math\/(?:tex|latex)/i.test(html);
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
    /** exact 表示全部公式都来自网页携带的原始 TeX；derived 表示至少一个由 MathML 推导。 */
    quality: "exact" | "derived" | "none";
    /** 用于剪贴板裁决和诊断，顺序即首次遇到该来源的顺序。 */
    sourceKinds: MathSourceKind[];
}

export type MathSourceKind = "data-latex" | "annotation" | "mathjax-v2" | "alttext" | "mathml";

/**
 * mathml2latex 输出的已知问题消毒（KaTeX 解析不通过的部分）：
 * - `\left{`（花括号定界符漏转义）→ `\left\{`；`\right}` → `\right\}`
 * - `\right]\limits^{...}` 等：`\limits` 不在运算符后是非法位置，去掉（只影响排版位置）
 * - `^{undefined}` / `_{undefined}`：缺省上下标占位，去掉
 * - U+2061（隐式函数应用符）：KaTeX 不识别，去掉
 */
function sanitizeLatex(latex: string): string {
    return latex
        .replace(/\\left\{(?!\\)/g, "\\left\\{")
        .replace(/\\right\}(?!\\)/g, "\\right\\}")
        .replace(/\\limits/g, "")
        .replace(/[_^]\{undefined\}/g, "")
        .replace(/\u2061/g, "");
}

/**
 * Wikipedia alttext 常用 `{\displaystyle ...}` 包一层样式组。
 * 显式用匹配长度切片，避免复杂公式末尾大量花括号时替换分组产生歧义。
 */
function stripWikiStyleWrapper(alt: string): string {
    const head = alt.match(/^\{\s*\\(?:displaystyle|textstyle|scriptstyle)\s+/);
    if (head && alt.endsWith("}")) {
        return alt.slice(head[0].length, -1).trim();
    }
    return alt.trim();
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
    const sourceKinds: MathSourceKind[] = [];
    const record = (kind: MathSourceKind): void => {
        count++;
        if (!sourceKinds.includes(kind)) {
            sourceKinds.push(kind);
        }
    };

    // 1. MathJax v3 的 data-latex 属性（OI Wiki 等），完整 TeX 源码，最保真
    Array.from(doc.querySelectorAll("mjx-container")).forEach((container) => {
        const texEl = container.querySelector("mjx-math[data-latex]");
        const tex = ((texEl || container).getAttribute("data-latex") || "").trim();
        if (!tex) {
            return;
        }
        const isDisplay = container.getAttribute("display") === "true" ||
            /\\begin\{equation|\\\[/.test(tex);
        container.replaceWith(doc.createTextNode(isDisplay ? "$$\n" + tex.trim() + "\n$$" : "$" + tex.trim() + "$"));
        record("data-latex");
    });

    // 2. KaTeX 等渲染器的 TeX 源码注解
    Array.from(doc.querySelectorAll("annotation")).forEach((ann) => {
        if (!ann.isConnected) {
            return;
        }
        const enc = (ann.getAttribute("encoding") || "").toLowerCase();
        if (!enc.includes("tex") || enc.includes("mathml")) {
            return;
        }
        const rawTex = (ann.textContent || "").trim();
        const wikipediaRoot = ann.closest(".mwe-math-element") as HTMLElement | null;
        const tex = wikipediaRoot ? stripWikiStyleWrapper(rawTex) : rawTex;
        if (!tex) {
            return;
        }
        // KaTeX/Wikipedia 都整体替换渲染根节点，防止视觉 fallback 再产生一份公式。
        // 其他原生 MathML 替换整个 math，避免第 4 步二次转换覆盖注解结果。
        const katexRoot = ann.closest(".katex");
        const mathEl = ann.closest(MATHML_TAGS);
        const target = (katexRoot || wikipediaRoot || mathEl || ann) as HTMLElement;
        const isDisplay = !!ann.closest(".katex-display") ||
            ann.closest("mjx-container")?.getAttribute("display") === "true" ||
            mathEl?.getAttribute("display") === "block" ||
            !!wikipediaRoot?.classList.contains("mwe-math-element-block");
        target.replaceWith(doc.createTextNode(isDisplay ? "$$\n" + tex + "\n$$" : "$" + tex + "$"));
        record("annotation");
    });

    // 3. MathJax v2 源码嵌入：<script type="math/tex; mode=display"> ... </script>
    Array.from(doc.querySelectorAll("script")).forEach((s) => {
        const type = (s.getAttribute("type") || "").toLowerCase();
        if (!type.startsWith("math/tex") && !type.startsWith("math/latex")) {
            return;
        }
        const tex = (s.textContent || "").trim();
        if (!tex) {
            return;
        }
        const isDisplay = /display/.test(type);
        s.replaceWith(doc.createTextNode(isDisplay ? "$$\n" + tex + "\n$$" : "$" + tex + "$"));
        record("mathjax-v2");
    });

    // 4. 原生 MathML / MathJax assistive MathML：alttext（Wikipedia）优先，mathml2latex 兜底
    Array.from(doc.querySelectorAll(MATHML_TAGS)).forEach((el) => {
        if (!el.isConnected) {
            return; // 已被 data-latex/annotation 步骤整体替换
        }
        const mml = el as HTMLElement;
        // Wikipedia 同时放置隐藏 MathML 与可见 fallback <img alt="原始 TeX">。
        // 必须整体替换渲染根节点，否则 htmlToText 会把图片 alt 再提取一遍。
        const wikipediaRoot = mml.closest(".mwe-math-element") as HTMLElement | null;
        const alt = (mml.getAttribute("alttext") || "").trim();
        if (alt) {
            // Wikipedia alttext 形如 {\displaystyle ...}，剥掉样式组外壳
            const tex = stripWikiStyleWrapper(alt);
            if (tex) {
                const isDisplay = mml.getAttribute("display") === "block" ||
                    !!wikipediaRoot?.classList.contains("mwe-math-element-block");
                (wikipediaRoot || mml).replaceWith(doc.createTextNode(
                    isDisplay ? "$$\n" + tex + "\n$$" : "$" + tex + "$"));
                record("alttext");
                return;
            }
        }
        try {
            const latex = sanitizeLatex(mathml2latex.convert(mml.outerHTML));
            if (!latex || !latex.trim()) {
                return;
            }
            const container = (mml.closest("mjx-container") || wikipediaRoot || mml) as HTMLElement;
            const isDisplay = mml.getAttribute("display") === "block" ||
                container.getAttribute("display") === "true";
            const wrapped = isDisplay ? "\n$$\n" + latex.trim() + "\n$$\n" : "$" + latex.trim() + "$";
            container.replaceWith(doc.createTextNode(wrapped));
            record("mathml");
        } catch (e) {
            // 转换失败则保留原样
        }
    });

    if (count === 0) {
        return {text: "", count: 0, quality: "none", sourceKinds: []};
    }
    return {
        text: htmlToText(doc.body),
        count,
        quality: sourceKinds.includes("mathml") ? "derived" : "exact",
        sourceKinds,
    };
}
