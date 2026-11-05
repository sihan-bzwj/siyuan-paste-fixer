/**
 * MathML → LaTeX：
 * - 原生 MathML（Wikipedia 等网页）：mathml2latex 转换；
 * - MathJax（mjx-container 内含 assistive MathML）：转换后整块替换；
 * - KaTeX（<annotation encoding="application/x-tex"> 内含原始 TeX）：直接取源码；
 * - Office MathML（Word/WPS/PPT 的 <m:oMath>）：omml.ts 转 LaTeX（v0.3.0）。
 * 转换完成后 HTML 走 html-to-markdown 变成 Markdown（公式已是 $...$ / $$...$$ 形式），
 * 网页原有的加粗/链接/图片/列表/表格随之保留，供思源走 Markdown 粘贴路径解析成块。
 */

import mathml2latex from "mathml2latex";
import {htmlToMarkdown} from "./html-to-markdown";
import {convertOmmlElement, isOmmlElement} from "./omml";

// 匹配 <math>、<mml:math>、<m:math> 与 Word 的 <m:oMath>（v0.3.0 起 OMML 也由本插件转换）
const MATHML_TAGS = 'math, mml\\:math, m\\:math';

export function hasMathML(html: string): boolean {
    return /<\/?(?:[a-z0-9]+:)?math[\s>]/i.test(html) ||
        /<(?:[a-z0-9]+:)?oMath[\s>/]/i.test(html) ||
        /class="katex|annotation\s+encoding|mjx-container|class="MathJax/i.test(html) ||
        /<script[^>]*type=["']?math\/(?:tex|latex)/i.test(html);
}

export interface MathMLResult {
    text: string;
    count: number;
    /** exact 表示全部公式都来自网页携带的原始 TeX；derived 表示至少一个由 MathML 推导。 */
    quality: "exact" | "derived" | "none";
    /** 用于剪贴板裁决和诊断，顺序即首次遇到该来源的顺序。 */
    sourceKinds: MathSourceKind[];
}

export type MathSourceKind = "data-latex" | "annotation" | "mathjax-v2" | "alttext" | "mathml" | "omml";

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

/** TeX → 定界符文本：行内 $...$；块级 $$\n...\n$$（padded=块级前后再补空行，防与邻接文本粘连）。 */
function wrapMath(tex: string, isDisplay: boolean, padded = false): string {
    if (!isDisplay) {
        return "$" + tex + "$";
    }
    const block = "$$\n" + tex + "\n$$";
    return padded ? "\n" + block + "\n" : block;
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
        container.replaceWith(doc.createTextNode(wrapMath(tex.trim(), isDisplay)));
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
        target.replaceWith(doc.createTextNode(wrapMath(tex, isDisplay)));
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
        s.replaceWith(doc.createTextNode(wrapMath(tex, isDisplay)));
        record("mathjax-v2");
    });

    // 4. 原生 MathML / MathJax assistive MathML：alttext（Wikipedia）优先，mathml2latex 兜底
    Array.from(doc.querySelectorAll(MATHML_TAGS)).forEach((el) => {
        if (!el.isConnected) {
            return; // 已被 data-latex/annotation 步骤整体替换
        }
        const mml = el as HTMLElement;
        // Wikipedia 同时放置隐藏 MathML 与可见 fallback <img alt="原始 TeX">。
        // 必须整体替换渲染根节点，否则转 Markdown 时会把图片 alt 再提取一遍。
        const wikipediaRoot = mml.closest(".mwe-math-element") as HTMLElement | null;
        const alt = (mml.getAttribute("alttext") || "").trim();
        if (alt) {
            // Wikipedia alttext 形如 {\displaystyle ...}，剥掉样式组外壳
            const tex = stripWikiStyleWrapper(alt);
            if (tex) {
                const isDisplay = mml.getAttribute("display") === "block" ||
                    !!wikipediaRoot?.classList.contains("mwe-math-element-block");
                (wikipediaRoot || mml).replaceWith(doc.createTextNode(wrapMath(tex, isDisplay)));
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
            const wrapped = wrapMath(latex.trim(), isDisplay, true);
            container.replaceWith(doc.createTextNode(wrapped));
            record("mathml");
        } catch (e) {
            // 转换失败则保留原样
        }
    });

    // 5. Office MathML（Word/WPS/PPT）：<m:oMath> 行内、<m:oMathPara> 独立成块
    Array.from(doc.querySelectorAll("*")).forEach((node) => {
        const el = node as Element;
        if (!el.isConnected || !isOmmlElement(el)) {
            return;
        }
        if (el.parentElement && isOmmlElement(el.parentElement)) {
            return; // 内层 oMath 由外层 oMathPara 统一处理
        }
        const tex = convertOmmlElement(el);
        if (!tex || !tex.trim()) {
            return;
        }
        const isDisplay = /^omathpara$/i.test(el.localName || "");
        el.replaceWith(doc.createTextNode(wrapMath(tex.trim(), isDisplay, isDisplay)));
        record("omml");
    });

    if (count === 0) {
        return {text: "", count: 0, quality: "none", sourceKinds: []};
    }
    return {
        text: htmlToMarkdown(doc.body),
        count,
        quality: sourceKinds.includes("mathml") ? "derived" : "exact",
        sourceKinds,
    };
}
