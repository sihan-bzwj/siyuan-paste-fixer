/**
 * 手动转换动作层（v0.2.3 拆分自 index.ts）。
 *
 * 核心安全原则（与自动粘贴不同，手动操作默认保守）：
 * - 局部选中：把修复结果整段解析成 文本+公式 片段，一次性原地替换 range，
 *   任何非公式正文都不能因为手动修复而消失；
 * - 完整单块：走内核 updateBlock（保留原 block ID）；块内含复杂格式时拒绝，
 *   绝不静默丢加粗/链接/行内代码；
 * - 跨块：拒绝执行，提示逐块操作，绝不 delete+insert 重建；
 * - 光标落在已有公式上：“修复为公式”不动作（已是公式），“还原为纯文本”才还原；
 * - 块级公式出现在局部选择中：提示先选中完整段落。
 *
 * 编辑器（protyleElement）一律从 range 推导（startContainer → closest
 * .protyle-wysiwyg），分屏/多编辑器时不会把 input 发给错误编辑器。
 */

import { tokenizeInlineMath, InlineMathToken } from "./fix-latex";

export interface ManualContext {
    /** 右键事件传入 range 的快照（唯一操作上下文） */
    range: Range;
    /** 所在编辑器（.protyle-wysiwyg），用于持久化 input 派发；从 range 推导 */
    protyleElement: HTMLElement | null;
    /** range 起点所在最近块 */
    block: HTMLElement | null;
    /** range 终点所在最近块（跨块判定用起止两块，不扫描全文档） */
    endBlock: HTMLElement | null;
    selectedText: string;
    interactionId: number;
    /** 原始 event.detail.protyle 引用（text-process 同款使用方式） */
    protyle: unknown;
}

export type ManualActionKind =
    | "local-inline"   // 局部行内：原地替换
    | "whole-block"    // 完整单块：updateBlock 保 ID
    | "cross-block"    // 跨块：拒绝
    | "collapsed-at-math" // 光标在公式内：fix 不动作 / revert 还原
    | "collapsed-text"    // 光标在普通文字：提示选择
    | "none";

/** 生成真实 inline-math span（思源渲染节点形态）。 */
export function buildInlineMathElement(content: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.setAttribute("data-type", "inline-math");
    span.setAttribute("data-subtype", "math");
    span.setAttribute("data-content", content);
    return span;
}

/** 让编辑器持久化最近的 DOM 变更（思源 wysiwyg 监听 input 事件自动保存）。 */
export function commitEditorChange(protyleElement: HTMLElement | null): void {
    if (!protyleElement) {
        return;
    }
    protyleElement.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText"}));
}

/** 光标（collapsed）是否落在公式节点上。 */
export function collapsedAtMath(range: Range): "inline" | "block" | null {
    if (!range.collapsed) {
        return null;
    }
    const node = range.startContainer.nodeType === 1
        ? range.startContainer as Element
        : (range.startContainer.parentElement as Element | null);
    const inline = node?.closest?.('[data-type="inline-math"]');
    if (inline) {
        return "inline";
    }
    const block = node?.closest?.('[data-type="NodeMathBlock"]');
    if (block) {
        return "block";
    }
    return null;
}

/** 节点所在最近块（含自身）：从 range 端点推导，不扫描整个文档。 */
export function resolveLeafBlock(node: Node): HTMLElement | null {
    if (!node) {
        return null;
    }
    const el = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!el || typeof el.closest !== "function") {
        return null;
    }
    return el.closest("[data-node-id]") as HTMLElement | null;
}

/** 从 range 推导所在编辑器（.protyle-wysiwyg）；分屏时不会选错编辑器。 */
export function deriveProtyleElement(range: Range): HTMLElement | null {
    const el = range.startContainer.nodeType === 1
        ? range.startContainer as Element
        : (range.startContainer.parentElement as Element | null);
    if (!el || typeof el.closest !== "function") {
        return null;
    }
    return el.closest(".protyle-wysiwyg") as HTMLElement | null;
}

/** 统一构建操作上下文（右键/顶栏/命令三个入口共用）。 */
export function captureManualContext(range: Range, protyle: unknown): ManualContext {
    const clone = range.cloneRange();
    const detailProtyle = (protyle as {wysiwyg?: {element?: HTMLElement}} | null)?.wysiwyg?.element ?? null;
    return {
        range: clone,
        protyleElement: detailProtyle ?? deriveProtyleElement(clone),
        block: resolveLeafBlock(clone.startContainer),
        endBlock: resolveLeafBlock(clone.endContainer),
        selectedText: clone.toString(),
        interactionId: 0,
        protyle,
    };
}

/** 选区是否覆盖块的完整文本内容（首尾文本节点边界对齐；无文本块按元素边界比较）。 */
function selectionCoversBlockText(range: Range, block: HTMLElement): boolean {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let n: Node | null = walker.nextNode();
    while (n) {
        textNodes.push(n as Text);
        n = walker.nextNode();
    }
    if (textNodes.length === 0) {
        // 无文本（如 NodeMathBlock）：范围必须恰好覆盖块元素本身
        return range.startContainer === block && range.startOffset === 0 &&
            range.endContainer === block && range.endOffset === block.childNodes.length;
    }
    const first = textNodes[0];
    const last = textNodes[textNodes.length - 1];
    return range.startContainer === first && range.startOffset === 0 &&
        range.endContainer === last && range.endOffset === last.length;
}

/** 判定选区类型：局部行内 / 完整单块 / 跨块（起止最近块不同即跨块）。 */
export function classifyRange(
    range: Range,
    block: HTMLElement | null,
    endBlock: HTMLElement | null,
): ManualActionKind {
    if (range.collapsed) {
        return collapsedAtMath(range) ? "collapsed-at-math" : "collapsed-text";
    }
    if (!block || !endBlock) {
        return "none";
    }
    if (block !== endBlock) {
        return "cross-block";
    }
    return selectionCoversBlockText(range, block) ? "whole-block" : "local-inline";
}

/** 完整块可能因转换丢掉的复杂行内格式（加粗/链接/行内代码/标签/引用等）；公式节点不算。 */
const RICH_FORMAT_SELECTOR = [
    "strong", "b", "em", "i", "u", "s", "del", "mark", "ins", "sub", "sup",
    "a[href]", "code", "blockquote",
    '[data-type="NodeCodeSpan"]', '[data-type="NodeInlineCode"]',
    '[data-type="tag"]', '[data-type="footnotes-ref"]', '[data-type="block-ref"]',
].join(",");

/** 块内是否含复杂格式：有则整块转换会静默丢格式，0.2.3 暂时拒绝。 */
export function hasRichFormatting(block: HTMLElement | null): boolean {
    if (!block) {
        return false;
    }
    return block.querySelector(RICH_FORMAT_SELECTOR) !== null;
}

/** insertNode 在文本节点边界插入时会把容器文本劈开、留下空 Text 尾巴，清掉（不影响内容）。 */
function removeEmptySplitTail(last: Node): void {
    let next: Node | null = last.nextSibling;
    while (next && next.nodeType === 3 && !(next as Text).data) {
        const tail = next;
        next = tail.nextSibling;
        (tail as Text).remove();
    }
}

/** 局部行内替换：把修复结果整段解析成文本/公式片段，一次替换选区（正文不丢失）。 */
export function applyLocalFragment(
    range: Range,
    tokens: InlineMathToken[],
    protyleElement: HTMLElement | null,
): void {
    range.deleteContents();
    const frag = document.createDocumentFragment();
    for (const token of tokens) {
        if (token.math) {
            frag.appendChild(buildInlineMathElement(token.text));
        } else if (token.text) {
            frag.appendChild(document.createTextNode(token.text));
        }
    }
    if (!frag.childNodes.length) {
        return;
    }
    const last = frag.childNodes[frag.childNodes.length - 1];
    range.insertNode(frag);
    removeEmptySplitTail(last);
    // 光标移到最后一个节点之后
    const sel = window.getSelection();
    if (sel) {
        const r2 = document.createRange();
        r2.setStartAfter(last);
        r2.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r2);
    }
    commitEditorChange(protyleElement);
}

/** 完整单块：内核 updateBlock（保留原 block ID，不删除重建）。 */
export async function applyWholeBlock(
    block: HTMLElement,
    markdown: string,
): Promise<void> {
    const id = block.getAttribute("data-node-id");
    if (!id) {
        throw new Error("block id missing");
    }
    const r = await fetch("/api/block/updateBlock", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id, dataType: "markdown", data: markdown}),
    });
    const j = await r.json() as {code: number, msg?: string};
    if (j.code !== 0) {
        throw new Error(j.msg || "updateBlock failed");
    }
}

/**
 * 从选区还原源码形态（渲染公式 span 无文本内容，需要从 DOM 取回 $...$ 源码）。
 * 局部选区只序列化 range 内部；完整公式块直接取 data-content。
 */
export function extractSourceMarkdown(range: Range, block: HTMLElement | null): string {
    if (block?.getAttribute("data-type") === "NodeMathBlock") {
        return "$$\n" + (block.getAttribute("data-content") || "") + "\n$$";
    }
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
    container.querySelectorAll('[data-type="inline-math"]').forEach((m) => {
        const t = document.createElement("span");
        t.textContent = "$" + (m as HTMLElement).getAttribute("data-content") + "$";
        m.replaceWith(t);
    });
    container.querySelectorAll('[data-type="NodeMathBlock"]').forEach((m) => {
        const t = document.createElement("span");
        t.textContent = "$$\n" + (m as HTMLElement).getAttribute("data-content") + "\n$$";
        m.replaceWith(t);
    });
    return (container.textContent || "").trim();
}

/**
 * 统一手动动作入口：fix（修复为公式）或 revert（还原为纯文本）。
 * 返回最终给用户的消息 key；失败抛错由调用方兜底提示。
 */
export async function runManualAction(
    ctx: ManualContext,
    action: "fix" | "revert",
    fixText: (md: string) => string,
    convertToPlain: (md: string) => string,
): Promise<string> {
    const kind = classifyRange(ctx.range, ctx.block, ctx.endBlock);

    // 光标在公式内：已有公式时“修复”无意义，只有“还原”才动作
    if (kind === "collapsed-at-math") {
        if (action === "fix") {
            return "noChange";
        }
        const node = ctx.range.startContainer.nodeType === 1
            ? ctx.range.startContainer as HTMLElement
            : (ctx.range.startContainer.parentElement as HTMLElement | null);
        const inline = node?.closest('[data-type="inline-math"]') as HTMLElement | null;
        if (inline) {
            const content = inline.getAttribute("data-content") || "";
            inline.replaceWith(document.createTextNode(convertToPlain("$" + content + "$")));
            commitEditorChange(ctx.protyleElement);
            return "revertDone";
        }
        const block = node?.closest('[data-type="NodeMathBlock"]') as HTMLElement | null;
        if (block) {
            await applyWholeBlock(block, convertToPlain("$$\n" + (block.getAttribute("data-content") || "") + "\n$$"));
            return "revertDone";
        }
    }
    if (kind === "collapsed-text" || kind === "none") {
        return "noSelection";
    }
    if (kind === "cross-block") {
        return "crossBlockRefuse";
    }
    // 完整块含复杂格式：宁可拒绝，也不静默丢格式
    if (kind === "whole-block" && hasRichFormatting(ctx.block)) {
        return "blockRichRefuse";
    }

    const source = extractSourceMarkdown(ctx.range, ctx.block);
    if (!source) {
        return "noSelection";
    }
    const out = action === "fix" ? fixText(source) : convertToPlain(source);
    if (out === source) {
        return "noChange";
    }

    if (kind === "whole-block") {
        await applyWholeBlock(ctx.block!, out);
        return action === "fix" ? "done" : "revertDone";
    }
    // local-inline
    if (action === "revert") {
        // 局部还原仍走原地替换（结果是纯文本）
        ctx.range.deleteContents();
        const textNode = document.createTextNode(out);
        ctx.range.insertNode(textNode);
        removeEmptySplitTail(textNode);
        commitEditorChange(ctx.protyleElement);
        return "revertDone";
    }
    if (/\$\$/.test(out)) {
        return "blockNeedsWholeBlock"; // 局部选中出现块级公式：提示选整段
    }
    // 局部行内修复：整个结果为片段（正文与公式全部保留）
    const tokens = tokenizeInlineMath(out);
    if (!tokens.some((t) => t.math)) {
        return "noChange";
    }
    applyLocalFragment(ctx.range, tokens, ctx.protyleElement);
    return "done";
}