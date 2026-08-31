/**
 * 手动转换动作层（v0.2.3 拆分自 index.ts）。
 *
 * 核心安全原则（与自动粘贴不同，手动操作默认保守）：
 * - 局部选中：原地替换 range 内容，不删除整个块、不新建 block ID；
 * - 完整单块：走内核 updateBlock（保留原 block ID）；
 * - 跨块：拒绝执行，提示逐块操作，绝不 delete+insert 重建。
 * - 块级公式出现在局部选择中：提示先选中完整段落。
 *
 * 所有动作基于右键事件传入的 range 快照（event.detail.range 的 clone），
 * 不依赖点击后可能失效的 window.getSelection()。
 */

export interface ManualContext {
    /** 右键事件传入 range 的快照（唯一操作上下文） */
    range: Range;
    /** 所在编辑器（.protyle-wysiwyg），用于持久化 input 派发 */
    protyleElement: HTMLElement | null;
    /** range 起点所在顶层块 */
    block: HTMLElement | null;
    /** 覆盖的顶层块列表（跨块判定的依据） */
    blocks: HTMLElement[];
    selectedText: string;
    interactionId: number;
    /** 原始 event.detail.protyle 引用（text-process 同款使用方式） */
    protyle: unknown;
}

export type ManualActionKind =
    | "local-inline"   // 局部行内：原地替换
    | "whole-block"    // 完整单块：updateBlock 保 ID
    | "cross-block"    // 跨块：拒绝
    | "collapsed-at-math" // 光标在公式内：直接还原该公式
    | "collapsed-text"    // 光标在普通文字：提示选择
    | "none";

export interface ManualActionPlan {
    kind: ManualActionKind;
    messageKey: string | null;
}

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

/** 判定选区类型：局部行内 / 完整单块 / 跨块。 */
export function classifyRange(
    range: Range,
    blocks: HTMLElement[],
): ManualActionKind {
    if (range.collapsed) {
        return collapsedAtMath(range) ? "collapsed-at-math" : "collapsed-text";
    }
    if (blocks.length === 0) {
        return "none";
    }
    if (blocks.length > 1) {
        return "cross-block"; // 跨块保守拒绝
    }
    // 完整单块：range 覆盖块的全部内容
    const block = blocks[0];
    const blockRange = document.createRange();
    blockRange.selectNodeContents(block);
    const full =
        range.startContainer === blockRange.startContainer &&
        range.startOffset === blockRange.startOffset &&
        range.endContainer === blockRange.endContainer &&
        range.endOffset === blockRange.endOffset;
    return full ? "whole-block" : "local-inline";
}

/** 局部行内替换：删除选中内容并插入公式片段。 */
export function applyLocalInline(
    range: Range,
    inlineMath: string,
    protyleElement: HTMLElement | null,
): void {
    range.deleteContents();
    range.insertNode(buildInlineMathElement(inlineMath));
    // 光标移到公式后
    const sel = window.getSelection();
    if (sel) {
        const r2 = document.createRange();
        r2.setStartAfter(range.endContainer.nodeType === 1
            ? range.endContainer as Node
            : range.endContainer);
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
 * 用于"还原为纯文本"与"修复"之前的源码获取。
 */
export function extractSourceMarkdown(range: Range, blocks: HTMLElement[]): string {
    // 单块局部：只序列化 range 内部（inline-math -> $content$，文本原样）
    const container = document.createElement("div");
    const cloned = range.cloneContents();
    container.appendChild(cloned);
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
    const local = container.textContent || "";
    if (blocks.length === 1 && local.trim()) {
        return local.trim();
    }
    // 完整多块/整块：逐个块序列化
    const parts: string[] = [];
    for (const block of blocks) {
        if (block.getAttribute("data-type") === "NodeMathBlock") {
            parts.push("$$\n" + (block.getAttribute("data-content") || "") + "\n$$");
            continue;
        }
        const clone = block.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('[data-type="NodeMathBlock"]').forEach((n) => n.remove());
        clone.querySelectorAll('[data-type="inline-math"]').forEach((m) => {
            const t = document.createElement("span");
            t.textContent = "$" + (m as HTMLElement).getAttribute("data-content") + "$";
            m.replaceWith(t);
        });
        parts.push((clone.textContent || "").trim());
    }
    return parts.join("\n\n");
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
    const kind = classifyRange(ctx.range, ctx.blocks);

    // 光标在公式内：两种动作都做"还原该公式"（内联公式无选区时修复无意义）
    if (kind === "collapsed-at-math") {
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

    // 取源码
    const source = extractSourceMarkdown(ctx.range, ctx.blocks);
    if (!source.trim()) {
        return "noSelection";
    }
    const out = action === "fix" ? fixText(source) : convertToPlain(source);
    if (out === source.trim()) {
        return "noChange";
    }

    if (kind === "cross-block") {
        return "crossBlockRefuse";
    }

    const needsBlock = /\$\$/.test(out);
    if (kind === "whole-block") {
        await applyWholeBlock(ctx.blocks[0], out);
        return action === "fix" ? "done" : "revertDone";
    }
    // local-inline
    if (action === "revert") {
        // 局部还原仍走原地替换（结果是纯文本）
        ctx.range.deleteContents();
        ctx.range.insertNode(document.createTextNode(out));
        commitEditorChange(ctx.protyleElement);
        return "revertDone";
    }
    if (needsBlock) {
        return "blockNeedsWholeBlock"; // 局部选中出现块级公式：提示选整段
    }
    // 局部行内修复：提取第一个 $...$ 内容生成 inline-math
    const m = out.match(/\$([^$\n]+?)\$/);
    if (!m) {
        return "noChange";
    }
    applyLocalInline(ctx.range, m[1], ctx.protyleElement);
    return "done";
}