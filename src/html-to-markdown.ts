/**
 * HTML → Markdown（保留网页排版）。
 *
 * v0.3.0 之前 MathML 路径把所有 HTML 拍成纯文本，网页里的加粗/链接/图片/列表/
 * 表格全部丢失。这里做一层受限转换：只认识常见排版标签，未知标签降级为子内容
 * （不丢字），公式（已由 mathml.ts 换成 $...$ / $$...$$ 文本节点）原样保留；
 * 表格按 GFM 输出，单元格内的块级公式降级为行内、裸 | 转 \vert，避免撕表。
 */

const IGNORE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "TITLE", "META", "LINK", "TEMPLATE", "SVG"]);
const BLOCK_TAGS = new Set([
    "P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE",
    "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "FORM", "FIELDSET", "ADDRESS",
    "CENTER", "BODY", "LI",
]);
const CELL_TAGS = new Set(["TD", "TH"]);
const MATH_SEGMENT_RE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/;

/** 文本节点：HTML 语义下连续空白折叠成一个空格（pre 走 textContent，不经过这里）。 */
function textOf(node: Node): string {
    return (node.nodeValue || "").replace(/\s+/g, " ");
}

function renderChildren(node: Node, cell: boolean): string {
    let out = "";
    node.childNodes.forEach((child) => {
        out += renderNode(child, cell);
    });
    return out;
}

/** 列表项里的嵌套列表单独渲染，正文只取非列表部分。 */
function renderChildrenExceptLists(node: Node, cell: boolean): string {
    let out = "";
    node.childNodes.forEach((child) => {
        if (child.nodeType === 1 && /^(UL|OL)$/.test((child as HTMLElement).tagName)) {
            return;
        }
        out += renderNode(child, cell);
    });
    return out;
}

function renderList(el: HTMLElement, depth: number, cell: boolean): string {
    if (cell) {
        return renderChildren(el, true);
    }
    const ordered = el.tagName.toUpperCase() === "OL";
    const indent = "    ".repeat(depth);
    let out = "";
    let index = 1;
    Array.from(el.children).forEach((child) => {
        if (child.tagName.toUpperCase() !== "LI") {
            out += renderNode(child, false);
            return;
        }
        const inline = renderChildrenExceptLists(child, false).replace(/\s+/g, " ").trim();
        const marker = ordered ? `${index++}. ` : "- ";
        out += indent + marker + inline + "\n";
        Array.from(child.children).forEach((nested) => {
            const tag = nested.tagName.toUpperCase();
            if (tag === "UL" || tag === "OL") {
                out += renderList(nested as HTMLElement, depth + 1, false);
            }
        });
    });
    return out + (depth === 0 ? "\n" : "");
}

/** 单元格内容：块级公式降级为行内；公式内的 | 转 \vert，正文的 | 转义，二者都不撕表。 */
function cellContent(cell: HTMLElement): string {
    const raw = renderChildren(cell, true);
    const inline = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => "$" + tex.trim() + "$");
    const parts = inline.split(MATH_SEGMENT_RE);
    const escaped = parts.map((part, i) => (i % 2 === 1
        ? part.replace(/\|/g, "\\vert ")
        : part.replace(/\|/g, "\\|")));
    return escaped.join("").replace(/\s+/g, " ").trim();
}

function renderTable(el: HTMLElement): string {
    const rows: HTMLElement[][] = [];
    el.querySelectorAll("tr").forEach((tr) => {
        const cells = Array.from(tr.children).filter(
            (child) => CELL_TAGS.has(child.tagName.toUpperCase()),
        ) as HTMLElement[];
        if (cells.length > 0) {
            rows.push(cells);
        }
    });
    if (rows.length === 0) {
        return "";
    }
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const line = (cells: HTMLElement[]): string => {
        const parts = cells.map(cellContent);
        while (parts.length < width) {
            parts.push("");
        }
        return "| " + parts.join(" | ") + " |";
    };
    const out: string[] = [line(rows[0]), "| " + new Array(width).fill("---").join(" | ") + " |"];
    rows.slice(1).forEach((row) => {
        out.push(line(row));
    });
    return out.join("\n") + "\n\n";
}

function renderPre(el: HTMLElement): string {
    const code = el.querySelector("code");
    const raw = (code || el).textContent || "";
    const className = (code ? code.className : el.className) || "";
    const lang = /language-([\w+-]+)/.exec(className);
    const fence = raw.includes("```") ? "~~~~" : "```";
    return fence + (lang ? lang[1] : "") + "\n" + raw.replace(/\s+$/, "") + "\n" + fence + "\n\n";
}

/** 行内数学/正文之外的连续空格折叠掉，公式原样。 */
function tidy(text: string): string {
    const clean = text.replace(/[\u200b-\u200d\ufeff\u2060]/g, ""); // 网页 DOM 常见的零宽字符/BOM
    const parts = clean.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/);
    const joined = parts.map((part, i) => (i % 2 === 1 ? part : part.replace(/[ \t]{2,}/g, " "))).join("");
    return joined.split("\n").map((line) => line.replace(/[ \t]+$/, "")).join("\n")
        .replace(/\n{3,}/g, "\n\n").trim();
}

function renderNode(node: Node, cell: boolean): string {
    if (node.nodeType === 3) {
        return textOf(node);
    }
    if (node.nodeType !== 1) {
        return "";
    }
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (IGNORE_TAGS.has(tag)) {
        return "";
    }
    if (tag === "BR") {
        return cell ? " " : "\n";
    }
    if (tag === "IMG") {
        const src = el.getAttribute("src") || "";
        if (!src) {
            return "";
        }
        return "![" + (el.getAttribute("alt") || "") + "](" + src + ")";
    }
    if (tag === "A") {
        const href = (el.getAttribute("href") || "").trim();
        const text = renderChildren(el, cell).replace(/\s+/g, " ").trim();
        if (!text) {
            return "";
        }
        if (!href || /^javascript:/i.test(href) || text === href) {
            return text;
        }
        return "[" + text + "](" + href.replace(/\s+/g, "") + ")";
    }
    if (tag === "CODE" && el.parentElement?.tagName.toUpperCase() !== "PRE") {
        const raw = el.textContent || "";
        if (!raw.trim()) {
            return "";
        }
        const ticks = raw.includes("`") ? "``" : "`";
        return ticks + raw + ticks;
    }
    if (tag === "PRE") {
        return renderPre(el);
    }
    if (tag === "TABLE") {
        return cell ? renderChildren(el, true) : renderTable(el);
    }
    if (tag === "HR") {
        return cell ? " " : "---\n\n";
    }
    if (/^H[1-6]$/.test(tag)) {
        const text = renderChildren(el, cell).replace(/\s+/g, " ").trim();
        if (!text) {
            return "";
        }
        const prefix = "#".repeat(Number(tag.slice(1)));
        return cell ? text : prefix + " " + text + "\n\n";
    }
    if (tag === "BLOCKQUOTE") {
        const inner = renderChildren(el, cell).trim();
        if (!inner) {
            return "";
        }
        if (cell) {
            return inner;
        }
        return inner.split("\n").map((line) => (line ? "> " + line : ">")).join("\n") + "\n\n";
    }
    if (tag === "UL" || tag === "OL") {
        return renderList(el, 0, cell);
    }
    if (tag === "STRONG" || tag === "B") {
        const inner = renderChildren(el, cell);
        return inner.trim() ? "**" + inner.trim() + "**" : inner;
    }
    if (tag === "EM" || tag === "I") {
        const inner = renderChildren(el, cell);
        return inner.trim() ? "*" + inner.trim() + "*" : inner;
    }
    if (tag === "DEL" || tag === "S" || tag === "STRIKE") {
        const inner = renderChildren(el, cell);
        return inner.trim() ? "~~" + inner.trim() + "~~" : inner;
    }
    if (BLOCK_TAGS.has(tag)) {
        const inner = renderChildren(el, cell);
        return cell ? " " + inner + " " : "\n\n" + inner + "\n\n";
    }
    return renderChildren(el, cell);
}

export function htmlToMarkdown(root: Node): string {
    return tidy(renderChildren(root, false));
}
