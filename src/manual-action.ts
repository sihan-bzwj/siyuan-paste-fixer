/**
 * 手动转换动作层（v0.2.4 语义重做）。
 *
 * 与自动粘贴的分工：
 * - 自动粘贴 → 保守、智能判断，宁可漏掉不乱改；
 * - 手动操作 → 用户明确表达意图：
 *   「强制转换为公式」把选中内容包装为公式（先复用修复引擎清破损，单行 → $...$，
 *   多行 → $$...$$；含可靠数学对的内容保持修复结果，不整体包装）；
 *   「还原为纯文本」去掉公式定界符。
 *
 * 安全原则：
 * - 局部选中：结果整段解析成 文本+公式 片段一次性原地替换，正文绝不丢失；
 * - 完整单块：内核 updateBlock（保留原 block ID）；白名单外元素（加粗/链接/
 *   行内代码/未知语义节点）一律拒绝，绝不静默丢格式；
 * - 跨块：逐块批处理——每块独立 updateBlock、保留各自 block ID，不再一刀切拒绝；
 * - 多行段落（<br>）经 serializeSafeSelection 还原为 \n，不再丢换行；
 * - 编辑器从 range 推导（分屏不会发给错误编辑器）。
 */

import {
    fixLatexText,
    MathToken,
    scanDollarMath,
    tokenizeMath,
} from "./fix-latex";

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
    | "cross-block"    // 跨块：逐块批处理
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

/**
 * 统一构建操作上下文（右键/顶栏/命令三个入口共用）。
 * 编辑器来源：range 推导优先（Range 才是实际操作对象），事件 detail 兜底。
 */
export function captureManualContext(range: Range, protyle: unknown): ManualContext {
    const clone = range.cloneRange();
    const detailProtyle = (protyle as {wysiwyg?: {element?: HTMLElement}} | null)?.wysiwyg?.element ?? null;
    return {
        range: clone,
        protyleElement: deriveProtyleElement(clone) ?? detailProtyle,
        block: resolveLeafBlock(clone.startContainer),
        endBlock: resolveLeafBlock(clone.endContainer),
        selectedText: clone.toString(),
        interactionId: 0,
        protyle,
    };
}

/**
 * 安全序列化：只允许 文本/br/inline-math/公式块/纯容器，遇到白名单外元素返回 null。
 * 与整块富格式保护同口径，保证手动操作永远不丢语义节点；<br> 还原为 \n。
 */
function serializeSafeSelection(root: Node): string | null {
    if (root.nodeType === 3) {
        return (root as Text).data;
    }
    if (root.nodeType === 11) { // DocumentFragment
        let out = "";
        for (const child of root.childNodes) {
            const s = serializeSafeSelection(child);
            if (s === null) {
                return null;
            }
            out += s;
        }
        return out;
    }
    if (root.nodeType !== 1) {
        return null;
    }
    const el = root as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
        return "\n";
    }
    if (el.getAttribute("data-type") === "inline-math") {
        return "$" + (el.getAttribute("data-content") || "") + "$";
    }
    if (el.getAttribute("data-type") === "NodeMathBlock") {
        return "$$\n" + (el.getAttribute("data-content") || "") + "\n$$";
    }
    if (tag === "div" || tag === "span" || tag === "p") {
        let out = "";
        for (const child of el.childNodes) {
            const s = serializeSafeSelection(child);
            if (s === null) {
                return null;
            }
            out += s;
        }
        return out;
    }
    return null; // 白名单之外的一切语义元素：拒绝
}

/** 片段是否含“有效内容”（整块判定用）：非空文本、思源语义节点、图像/链接等
 *  都算有效；空 Text、<wbr>/<br>、纯容器节点忽略。 */
function hasMeaningfulContent(node: Node): boolean {
    if (node.nodeType === 3) {
        return Boolean((node as Text).data.trim());
    }
    if (node.nodeType === 11) {
        return Array.from(node.childNodes).some(hasMeaningfulContent);
    }
    if (node.nodeType !== 1) {
        return true;
    }
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "wbr" || tag === "br") {
        return false;
    }
    if (el.hasAttribute("data-type") || el.hasAttribute("data-subtype")) {
        return true; // inline-math 等思源语义节点（无文本但承载公式）
    }
    if (tag === "div" || tag === "span" || tag === "p") {
        return Array.from(el.childNodes).some(hasMeaningfulContent);
    }
    return true; // img/a/code/strong/... 一律有效
}

/**
 * 选区前后是否还有未选中的有效内容。
 *
 * 整块判定不能只看“首尾文本节点”：inline-math 等无文本元素在块首/块尾时，
 * 只选正文也会被误判为整块，updateBlock 会覆盖掉未选中的公式。因此比较
 * 块开头→range 起点、range 终点→块末尾 两段 cloneContents 是否含有效内容。
 */
function hasUnselectedContent(block: HTMLElement, range: Range): boolean {
    const prefix = document.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(range.startContainer, range.startOffset);
    const suffix = document.createRange();
    suffix.selectNodeContents(block);
    suffix.setStart(range.endContainer, range.endOffset);
    return hasMeaningfulContent(prefix.cloneContents()) || hasMeaningfulContent(suffix.cloneContents());
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
    if (block.getAttribute("data-type") === "NodeMathBlock") {
        return "whole-block";
    }
    // 前后都无未选中内容才算完整选中整块
    return hasUnselectedContent(block, range) ? "local-inline" : "whole-block";
}

/** 块内是否含白名单之外的语义元素（整块转换保护，fail-closed）。 */
function hasUnsafeRichElement(node: Node): boolean {
    if (node.nodeType === 3) {
        return false;
    }
    if (node.nodeType !== 1) {
        return true;
    }
    const el = node as Element;
    if (el.getAttribute("data-type") === "inline-math") {
        return false;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
        return false; // 多行段落：serialize 会还原为 \n
    }
    if (tag === "div" || tag === "span" || tag === "p") {
        return Array.from(el.childNodes).some(hasUnsafeRichElement);
    }
    return true;
}

/** 块内是否含需要拒绝整块转换的语义元素。 */
export function hasRichFormatting(block: HTMLElement | null): boolean {
    if (!block) {
        return false;
    }
    return Array.from(block.childNodes).some(hasUnsafeRichElement);
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

/** 局部行内替换：把转换结果整段解析成文本/公式片段，一次替换选区（正文不丢失）。 */
export function applyLocalFragment(
    range: Range,
    tokens: MathToken[],
    protyleElement: HTMLElement | null,
): void {
    range.deleteContents();
    const frag = document.createDocumentFragment();
    for (const token of tokens) {
        if (token.kind === "inline") {
            frag.appendChild(buildInlineMathElement(token.text));
        } else if (token.kind === "text" && token.text) {
            frag.appendChild(document.createTextNode(token.text));
        }
        // block token 不应出现在局部替换中（调用方先用 $$ 检查拦截）
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

/**
 * 手动强制转换前的轻量保护：选中内容是否像公式表达式。
 * 只用于用户明确表达“这就是公式”的场景，不参与自动粘贴分类：
 * - 已有公式定界符 / LaTeX 命令 / 数学运算符 → 接受；
 * - 纯中文句子、纯普通英文句子 → 拒绝；
 * - 中文与数学符号混合（如 \text{核} x_1）→ 接受。
 */
export function looksLikeRawMathExpression(source: string): boolean {
    const t = source.trim();
    if (!t) {
        return false;
    }
    if (/\$\$|\\\[|\\\]|\\\(|\\\)|\\begin\{/.test(t)) {
        return true;
    }
    if (/\\[A-Za-z]+/.test(t)) {
        return true;
    }
    if (/[_^=+*/<>≤≥×÷∞α-ωΑ-Ω]/.test(t)) {
        return true;
    }
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(t)) {
        return false; // 无数学信号的纯中文句子：拒绝
    }
    return false;
}

/**
 * 手动「强制转换为公式」：
 * 1. 先复用修复引擎清理破损（\[...\]、\(...\)、== 碎片、\rightarrowEdge 等）；
 * 2. 修复结果若已含可靠数学对（内容=公式+正文混合，如 "A $x$ B"）→ 直接使用修复结果，
 *    不整体包装（避免嵌套 $...$）；此时输出**保留原输入（含两侧空格）**，局部选区不丢空格；
 * 3. 否则把整段内容包装：单行 → $...$，多行 → $$...$$；已是完整公式对则原样。
 * 返回 null 表示“选中内容不像公式”。
 */
export function forceConvertMath(source: string, fixText: (md: string) => string): string | null {
    if (!looksLikeRawMathExpression(source)) {
        return null;
    }
    const fixed = fixText(source);
    const t = fixed.trim();
    if (!t) {
        return null;
    }
    // 混合内容（修复后含可靠数学对）：保持修复结果（原文姿态，空格不丢）
    if (scanDollarMath(fixed, {multiline: true}).length > 0) {
        return fixed;
    }
    if (t.includes("\n")) {
        return /^\$\$[\s\S]+\$\$$/.test(t) ? fixed : "$$\n" + t + "\n$$";
    }
    return /^\$[^$\n]+\$$/.test(t) ? fixed : "$" + t + "$";
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
    if (!r.ok) {
        throw new Error("updateBlock http " + r.status);
    }
    const j = await r.json() as {code: number, msg?: string};
    if (j.code !== 0) {
        throw new Error(j.msg || "updateBlock failed");
    }
}

/** 块 → 源码（公式块读 data-content；普通块走安全序列化，<br>→\n）。 */
function blockSource(block: HTMLElement): string {
    if (block.getAttribute("data-type") === "NodeMathBlock") {
        return "$$\n" + (block.getAttribute("data-content") || "") + "\n$$";
    }
    return serializeSafeSelection(block) ?? "";
}

/** 被 range 覆盖的叶子块列表（无子块的 [data-node-id]；跨块批处理用）。 */
function collectIntersectingLeafBlocks(range: Range): HTMLElement[] {
    const startEl = range.startContainer.nodeType === 1
        ? range.startContainer as Element
        : (range.startContainer.parentElement as Element | null);
    const scope = (startEl?.closest?.(".protyle-wysiwyg") as HTMLElement | null) || document.body;
    return Array.from(scope.querySelectorAll("[data-node-id]"))
        .filter((el) => !el.querySelector("[data-node-id]") && range.intersectsNode(el)) as HTMLElement[];
}

/**
 * 跨块批处理：每块独立转换、独立 updateBlock（保留各自 block ID）。
 * 不再一刀切拒绝；含富格式的块跳过，全块不转换时返回对应提示。
 */
async function convertBlocks(
    range: Range,
    action: "fix" | "revert",
    fixText: (md: string) => string,
    convertToPlain: (md: string) => string,
): Promise<string> {
    const blocks = collectIntersectingLeafBlocks(range);
    if (!blocks.length) {
        return "noSelection";
    }
    let changed = 0;
    let refused = 0;
    for (const b of blocks) {
        if (hasRichFormatting(b)) {
            refused++;
            continue;
        }
        const source = blockSource(b);
        const trimmed = source.trim();
        if (!trimmed) {
            continue;
        }
        if (action === "revert") {
            const out = convertToPlain(source);
            if (out === source) {
                continue;
            }
            await applyWholeBlock(b, out);
            changed++;
        } else {
            const out = forceConvertMath(source, fixText);
            if (out === null || out === source) {
                continue;
            }
            await applyWholeBlock(b, out);
            changed++;
        }
    }
    if (changed === 0 && refused > 0) {
        return "blockRichRefuse";
    }
    return changed > 0 ? "done" : "noChange";
}

/**
 * 从选区还原源码形态（safe serializer：唯一会丢换行/格式的路径已封死）。
 * 遇到白名单外元素返回 null（调用方按“拒绝”处理）。
 * 局部选区**绝不 trim**（两侧空格必须保留）；完整块由调用方按块语义 trim。
 */
export function extractSourceMarkdown(
    range: Range,
    block: HTMLElement | null,
    kind: ManualActionKind,
): string | null {
    if (block?.getAttribute("data-type") === "NodeMathBlock") {
        return "$$\n" + (block.getAttribute("data-content") || "") + "\n$$";
    }
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
    return serializeSafeSelection(container);
}

/**
 * 统一手动动作入口：
 * - fix = 强制转换为公式（用户明确意图；先清破损再包装）；
 * - revert = 还原为纯文本（只还原可靠公式对，金额/Shell 美元不动）。
 * 返回最终给用户的消息 key；失败抛错由调用方兜底提示。
 */
export async function runManualAction(
    ctx: ManualContext,
    action: "fix" | "revert",
    fixText: (md: string) => string,
    convertToPlain: (md: string) => string,
): Promise<string> {
    const kind = classifyRange(ctx.range, ctx.block, ctx.endBlock);

    // 光标在公式内：强制转换无意义（已是公式），只有“还原”才动作
    if (kind === "collapsed-at-math") {
        if (action === "fix") {
            return "alreadyMath";
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
    // 跨块：逐块批处理（每块保留自己的 block ID）
    if (kind === "cross-block") {
        return convertBlocks(ctx.range, action, fixText, convertToPlain);
    }
    // 完整块含白名单外元素：宁可拒绝，也不静默丢格式
    if (kind === "whole-block" && hasRichFormatting(ctx.block)) {
        return "blockRichRefuse";
    }

    const source = extractSourceMarkdown(ctx.range, ctx.block, kind);
    if (source === null) {
        return "blockRichRefuse"; // 白名单外元素出现在局部选区
    }
    if (!source.trim()) {
        return "noSelection";
    }

    if (action === "revert") {
        const out = convertToPlain(source);
        if (out === source) {
            return "noChange";
        }
        if (kind === "whole-block") {
            await applyWholeBlock(ctx.block!, out);
            return "revertDone";
        }
        // 局部还原仍走原地替换（结果是纯文本）
        ctx.range.deleteContents();
        const textNode = document.createTextNode(out);
        ctx.range.insertNode(textNode);
        removeEmptySplitTail(textNode);
        commitEditorChange(ctx.protyleElement);
        return "revertDone";
    }

    // fix = 强制转换为公式
    const out = forceConvertMath(source, fixText);
    if (out === null) {
        return "looksNotMath";
    }
    if (out === source) {
        return "noChange";
    }
    if (kind === "whole-block") {
        await applyWholeBlock(ctx.block!, out);
        return "done";
    }
    if (/\$\$/.test(out)) {
        return "blockNeedsWholeBlock"; // 局部选中出现块级公式：提示选整段
    }
    // 局部行内：整段结果（文本+公式）片段替换
    applyLocalFragment(ctx.range, tokenizeMath(out), ctx.protyleElement);
    return "done";
}