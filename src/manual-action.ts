/**
 * 手动转换动作层（v0.2.6 语义收敛）。
 *
 * 与自动粘贴的分工：
 * - 自动粘贴 → 保守、智能判断，宁可漏掉不乱改；
 * - 手动操作 → 用户明确表达意图：
 *   「强制转换为公式」把选中内容包装为公式（先复用修复引擎清破损，单行 → $...$，
 *   多行 → $$...$$；含可靠数学对的内容保持修复结果，不整体包装）；
 *   「还原为纯文本」优先节点级：只还原完全覆盖的渲染公式节点（inline-math 原地
 *   替换、公式块按 id 更新），其余结构（<br>/加粗/链接/代码）天然保持；无渲染
 *   公式的纯源码选区才走文本路径（\n 还原为 <br>）。
 *
 * 安全原则：
 * - 代码区域（代码块/行内代码）是硬边界：fix 一律拒绝、命令面板拒绝；
 *   revert 仅当端点本身在代码内才拒绝（选区含代码则跳过代码、仍还原其它公式）；
 * - 局部选中：结果整段解析成 文本+公式 片段一次性原地替换，正文绝不丢失；
 * - 完整单块：updateBlock（保留原 block ID）仅限 NodeParagraph/NodeMathBlock，
 *   Heading/CodeBlock/未知块拒绝整块写回（防块类型被意外改写）；
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
    | "cross-block"    // 跨块：fix 拒绝；revert 节点级（只还原完整覆盖的公式节点）
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

/** 代码目标选择器：代码块 / 行内代码（官方 DOM 为 span[data-type="code"]）。 */
export const CODE_TARGET_SELECTOR = '[data-type="NodeCodeBlock"], [data-type="NodeInlineCode"], [data-type="code"]';

/** range 端点（start/end 容器）是否落在代码区域内。 */
function rangeEndpointsInCode(range: Range): boolean {
    const check = (node: Node): boolean => {
        const el = node.nodeType === 1 ? node as Element : node.parentElement;
        return el?.closest?.(CODE_TARGET_SELECTOR) !== null;
    };
    return check(range.startContainer) || check(range.endContainer);
}

/** 选中内容里是否出现代码节点（code span 可能落在选区中间）。 */
function rangeContainsCode(range: Range): boolean {
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
    return container.querySelector(CODE_TARGET_SELECTOR) !== null;
}

/**
 * 统一代码边界门禁：任意操作源（自动 paste / 右键菜单 / 命令面板）只要触及
 * 代码块/行内代码就整体排除——issue #1 的“限制插件功能范围”硬边界。
 * 返回 true 表示该 range 落在代码区域内，插件不参与。
 */
export function isCodeRange(range: Range): boolean {
    return rangeEndpointsInCode(range) || rangeContainsCode(range);
}

/** 块正文根（editable 子树）：安全检查与源码提取统一只看这里，排除 .protyle-attr 等编辑器结构。 */
export function getBlockContentRoot(block: HTMLElement): HTMLElement {
    return (block.querySelector('[contenteditable="true"]') as HTMLElement | null) ?? block;
}

/** 允许整块 updateBlock 的块类型（fail-closed：其余一律拒绝）。
 *  - NodeParagraph：允许（必要时段落→公式块是预期转换）
 *  - NodeMathBlock：只用于还原（转回文本段落）
 *  - Heading/CodeBlock/未知：拒绝整块写回，避免块类型被意外改写 */
const WHOLE_BLOCK_SAFE_TYPES = new Set(["NodeParagraph", "NodeMathBlock"]);

/** 整块操作是否允许（按块类型授写权限）。 */
export function wholeBlockAllowed(block: HTMLElement | null): boolean {
    return block !== null && WHOLE_BLOCK_SAFE_TYPES.has(block.getAttribute("data-type") || "");
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
 * 安全序列化：只允许无语义标记的文本/纯容器 + 明确允许的数学节点。
 * fail-closed——span[data-type="code"]、标签、块引用等一切带 data-type/data-subtype
 * 的语义节点一律拒绝（返回 null），绝不扁平化丢格式。
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
    // 其余带语义标记的节点（行内代码/标签/引用/未来插件节点）一律拒绝
    if (el.hasAttribute("data-type") || el.hasAttribute("data-subtype")) {
        return null;
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
    return null; // 其它元素（img/a/code/strong/...）一律拒绝
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
 * 选区前后是否还有未选中的有效内容（基于正文 contenteditable root）。
 *
 * 整块判定不能只看“首尾文本节点”：inline-math 等无文本元素在块首/块尾时，
 * 只选正文也会被误判为整块，updateBlock 会覆盖掉未选中的公式。因此比较
 * 正文开头→range 起点、range 终点→正文末尾 两段 cloneContents 是否含有效内容。
 */
function hasUnselectedContent(block: HTMLElement, range: Range): boolean {
    const root = getBlockContentRoot(block);
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    const suffix = document.createRange();
    suffix.selectNodeContents(root);
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
    // 任一 data-type/data-subtype（行内代码/标签/引用等语义节点）→ 拒绝
    if (el.hasAttribute("data-type") || el.hasAttribute("data-subtype")) {
        return true;
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

/** 块内是否含需要拒绝整块转换的语义元素（基于正文 contenteditable root）。 */
export function hasRichFormatting(block: HTMLElement | null): boolean {
    if (!block) {
        return false;
    }
    return Array.from(getBlockContentRoot(block).childNodes).some(hasUnsafeRichElement);
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
 * 手动强制转换前的轻量保护：信任用户的明确意图（按钮叫「强制转换为公式」）。
 * 只拒绝空选择与纯中文/全角句子（无任何数学信号，防误点）；x、f(x)、a,b、123
 * 等简单表达式直接放行。
 */
export function looksLikeRawMathExpression(source: string): boolean {
    const t = source.trim();
    if (!t) {
        return false;
    }
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(t) &&
        !/\\[A-Za-z]+|[_^=+*/<>≤≥×÷]/.test(t)) {
        return false; // 纯中文句子（无数学信号）
    }
    return true;
}

/**
 * 手动「强制转换为公式」：
 * 1. 先复用修复引擎清理破损（\[...\]、\(...\)、== 碎片、\rightarrowEdge 等）；
 * 2. 修复结果若已含可靠数学对（内容=公式+正文混合，如 "A $x$ B"）→ 直接使用修复结果，
 *    不整体包装（避免嵌套 $...$）；此时输出**保留原输入（含两侧空格）**；
 * 3. 否则把整段内容包装：单行 → $...$，多行 → $$...$$；已是完整公式对则原样。
 *    包装分支保留源码两侧空白（局部 "A x B" 选 " x " → " $x$ "，空格不丢）。
 * 返回 null 表示“选中内容不像公式”。
 */
export function forceConvertMath(source: string, fixText: (md: string) => string): string | null {
    if (!looksLikeRawMathExpression(source)) {
        return null;
    }
    const fixed = fixText(source);
    const trimmed = fixed.trim();
    if (!trimmed) {
        return null;
    }
    // 混合内容（修复后含可靠数学对）：保持修复结果（原文姿态，空格不丢）
    if (scanDollarMath(fixed, {multiline: true}).length > 0) {
        return fixed;
    }
    // 包装分支：源码两侧空白由调用方决定保留（局部保留、整块 trim）
    const leading = fixed.slice(0, fixed.length - fixed.trimStart().length);
    const trailing = fixed.slice(fixed.trimEnd().length);
    if (trimmed.includes("\n")) {
        return leading + (/^\$\$[\s\S]+\$\$$/.test(trimmed) ? trimmed : "$$\n" + trimmed + "\n$$") + trailing;
    }
    return leading + (/^\$[^$\n]+\$$/.test(trimmed) ? trimmed : "$" + trimmed + "$") + trailing;
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

/** 块 → 源码：公式块读 data-content；普通块只序列化正文 editable 子树
 *  （排除 .protyle-attr 等编辑器结构）。 */
function blockSource(block: HTMLElement): string {
    if (block.getAttribute("data-type") === "NodeMathBlock") {
        return "$$\n" + (block.getAttribute("data-content") || "") + "\n$$";
    }
    const editable = block.querySelector('[contenteditable="true"]') as HTMLElement | null;
    return serializeSafeSelection(editable ?? block) ?? "";
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
 * 节点是否被 range 完整覆盖（节点级还原的判定：只处理完整选中的公式节点，
 * 普通文字/块结构绝不触碰）。
 */
function nodeFullyCovered(node: Node, range: Range): boolean {
    // selectNodeContents：边界为元素内容 (el,0)..(el,childLen)；无子元素时为
    // (el,0)-(el,0)，与 range 同容器同偏移时精确相等（selectNode 用父容器索引
    // 边界，会与 range.start=(el,0) 形式的选区失配）。
    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(node);
    // compare 结果：range 起点相对节点内容起点（<=0 = 不晚于）；range 终点相对
    // 节点内容终点（>=0 = 不早于）。起点在元素内部（offset>0 或子代里）→ >0 判 false。
    return range.compareBoundaryPoints(0, nodeRange) <= 0 &&
        range.compareBoundaryPoints(2, nodeRange) >= 0;
}

/** 被 range 完整覆盖的公式节点（跳过代码区域内的节点；收集与执行分离）。 */
function collectCoveredMathNodes(
    range: Range,
): {inline: Element[], blocks: Array<{id: string, content: string}>} {
    // 从 range 公共祖先开始扫描：普通局部选区只扫一个块/段落，跨块时才自然
    // 扩大到共同祖先（不再每次右键扫整个编辑器）
    const ancestor = range.commonAncestorContainer;
    const rootEl = (ancestor.nodeType === 1 ? ancestor : ancestor.parentElement) as Element | null;
    const walker = document.createTreeWalker(rootEl ?? document.body, NodeFilter.SHOW_ELEMENT);
    const inline: Element[] = [];
    const blocks: Array<{id: string, content: string}> = [];
    let node: Node | null = walker.nextNode();
    while (node) {
        const el = node as Element;
        const dt = el.getAttribute("data-type");
        if ((dt === "inline-math" || dt === "NodeMathBlock") && nodeFullyCovered(el, range)) {
            if (!el.closest?.(CODE_TARGET_SELECTOR)) {
                if (dt === "inline-math") {
                    inline.push(el);
                } else {
                    blocks.push({
                        id: el.getAttribute("data-node-id") || "",
                        content: el.getAttribute("data-content") || "",
                    });
                }
            }
        }
        node = walker.nextNode();
    }
    return {inline, blocks};
}

/**
 * 节点级还原（跨块/局部/整段统一入口）：
 * - inline-math：原地替换为纯文本（DOM 修改），有变更才派发一次 input；
 * - NodeMathBlock：按块 id 走内核 updateBlock（转回文本段落），API 路径不再
 *   派发 input（避免与前端自动保存竞争）；id/content 在 await 前固化为数据，
 *   不依赖可能被内核重新渲染替换的 DOM 引用。
 * 只还原完全覆盖的渲染公式；<br>/加粗/链接/代码等其他结构完全不碰。
 * 返回 "revertDone" / "noChange"。
 */
async function revertCoveredMathNodes(
    ctx: ManualContext,
    convertToPlain: (md: string) => string,
): Promise<string> {
    const {inline, blocks} = collectCoveredMathNodes(ctx.range);
    if (!inline.length && !blocks.length) {
        return "noChange";
    }
    let inlineChanged = 0;
    for (const el of inline) {
        const content = el.getAttribute("data-content") || "";
        el.replaceWith(document.createTextNode(convertToPlain("$" + content + "$")));
        inlineChanged++;
    }
    if (inlineChanged > 0) {
        commitEditorChange(ctx.protyleElement);
    }
    for (const b of blocks) {
        // 还原 = 字面文本：不经过 Markdown 解析（"* x" 不会被变成列表）
        await applyPlainTextBlockById(b.id, convertToPlain("$$\n" + b.content + "\n$$"));
    }
    return "revertDone";
}

/** 按块 id 更新（保 block ID；block 的 DOM 引用可能被内核重新渲染替换）。 */
async function applyWholeBlockById(id: string, markdown: string): Promise<void> {
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

/**
 * 公式块 → 纯文本（**不经过 Markdown 解析**）：
 * 以 dom 类型明确构造 NodeParagraph，公式内容中的 `*`/`#`/`1.`/`_`/`[`
 * 全部作为字面文本（revert 不应该让普通文本重新被 Markdown 解释成列表/标题等）。
 * 换行还原为 <br>，< & > 转义。
 */
async function applyPlainTextBlockById(id: string, text: string): Promise<void> {
    if (!id) {
        throw new Error("block id missing");
    }
    const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
    const dom = `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true">${escaped}</div></div>`;
    const r = await fetch("/api/block/updateBlock", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id, dataType: "dom", data: dom}),
    });
    if (!r.ok) {
        throw new Error("updateBlock http " + r.status);
    }
    const j = await r.json() as {code: number, msg?: string};
    if (j.code !== 0) {
        throw new Error(j.msg || "updateBlock failed");
    }
}

/**
 * 手动动作能力判定（右键菜单与执行入口共用同一口径，避免“菜单能点、执行拒绝”分叉）。
 * - fix：端点不在代码、非跨块、整块时块类型安全、选区内容可安全序列化；
 * - revert：存在被 range 完整覆盖的渲染公式节点（节点级还原路径）；
 *   代码只跳过不阻塞；端点本身在代码内时整体拒绝。
 * can=false 时 reason 给出与执行层一致的拒绝 key（供提示/诊断）。
 */
export interface ManualCapabilities {
    canFix: boolean;
    canRevert: boolean;
    fixReason?: string;
    revertReason?: string;
}

export function getManualCapabilities(ctx: ManualContext): ManualCapabilities {
    if (ctx.range.collapsed) {
        const at = collapsedAtMath(ctx.range);
        return {
            canFix: false,
            fixReason: "alreadyMath",
            canRevert: at !== null,
            revertReason: at === null ? "noSelection" : undefined,
        };
    }
    // 端点本身在代码内：整体不参与
    if (rangeEndpointsInCode(ctx.range)) {
        return {canFix: false, fixReason: "inCodeRange", canRevert: false, revertReason: "inCodeRange"};
    }
    const covered = collectCoveredMathNodes(ctx.range);
    const canRevert = covered.inline.length > 0 || covered.blocks.length > 0;
    // fix：选区碰到任何代码 → 拒绝（与执行层 isCodeRange 同源）
    if (rangeContainsCode(ctx.range)) {
        return {canFix: false, fixReason: "inCodeRange", canRevert, revertReason: canRevert ? undefined : "noChange"};
    }
    if (ctx.block !== ctx.endBlock) {
        // 跨块：fix 拒绝（整块语义无法保证）；revert 节点级安全（含代码跳过）
        return {
            canFix: false,
            fixReason: "crossBlockRefuse",
            canRevert,
            revertReason: canRevert ? undefined : "noChange",
        };
    }
    let canFix = true;
    let fixReason: string | undefined;
    // 整块写回按块类型授权限
    if (ctx.block !== null) {
        const isWhole = !hasUnselectedContent(ctx.block, ctx.range);
        if (isWhole && !wholeBlockAllowed(ctx.block)) {
            canFix = false;
            fixReason = "blockTypeRefuse";
        }
    }
    // fix 需要能安全序列化选中内容（含白名单外语义元素 → 执行层必拒，菜单同步隐藏）
    if (canFix) {
        const container = document.createElement("div");
        container.appendChild(ctx.range.cloneContents());
        if (serializeSafeSelection(container) === null) {
            canFix = false;
            fixReason = "blockRichRefuse";
        }
    }
    return {
        canFix,
        fixReason: canFix ? undefined : fixReason,
        canRevert,
        revertReason: canRevert ? undefined : "noChange",
    };
}

/**
 * 统一手动动作入口：
 * - fix = 强制转换为公式（用户明确意图；先清破损再包装）；
 * - revert = 还原为纯文本：优先节点级（只还原完整覆盖的渲染公式节点，
 *   <br>/加粗/链接/代码等结构天然保持）；无渲染公式的源码选区走文本路径
 *   （\n 还原为 <br>，不压平结构）。
 * 代码区域：fix 一律拒绝；revert 仅当端点本身在代码内才拒绝（选区含代码时
 * 跳过代码、仍还原其它公式）。跨块：fix 拒绝（整块语义无法保证），revert 节点级。
 * 返回最终给用户的消息 key；失败抛错由调用方兜底提示。
 */
export async function runManualAction(
    ctx: ManualContext,
    action: "fix" | "revert",
    fixText: (md: string) => string,
    convertToPlain: (md: string) => string,
): Promise<string> {
    // 代码区域硬边界：fix 一律拒绝；revert 仅端点本身在代码内才拒绝
    if (action === "fix" && isCodeRange(ctx.range)) {
        return "inCodeRange";
    }
    if (rangeEndpointsInCode(ctx.range)) {
        return "inCodeRange";
    }
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
            // 还原 = 字面文本（不经过 Markdown 解析）
            await applyPlainTextBlockById(block.getAttribute("data-node-id") || "",
                convertToPlain("$$\n" + (block.getAttribute("data-content") || "") + "\n$$"));
            return "revertDone";
        }
    }
    if (kind === "collapsed-text" || kind === "none") {
        return "noSelection";
    }
    // revert：节点级优先，且**先于**整块类型/富格式门禁——节点级还原不动块结构
    // 与类型（Heading/rich 块内的公式也可以安全还原），门禁只保护 fix/整块重写
    if (action === "revert") {
        const covered = collectCoveredMathNodes(ctx.range);
        if (covered.inline.length > 0 || covered.blocks.length > 0) {
            return revertCoveredMathNodes(ctx, convertToPlain);
        }
        if (kind === "cross-block") {
            return "noChange"; // 跨块且无完整覆盖的公式节点：无可还原
        }
    }
    // 跨块 fix：拒绝（跨块部分选择会改写整个首尾块/块类型）
    if (kind === "cross-block") {
        return "crossBlockRefuse";
    }
    // 整块写回按块类型授权限（Heading/CodeBlock/未知块拒绝，防类型被意外改写）
    if (kind === "whole-block" && !wholeBlockAllowed(ctx.block)) {
        return "blockTypeRefuse";
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
        // 局部源码还原：\n 还原为 <br>，不把多行压成一个 Text 节点
        ctx.range.deleteContents();
        const parts = out.split("\n");
        const frag = document.createDocumentFragment();
        parts.forEach((part, i) => {
            if (i > 0) {
                frag.appendChild(document.createElement("br"));
            }
            if (part) {
                frag.appendChild(document.createTextNode(part));
            }
        });
        const lastNode = frag.lastChild ? frag.lastChild : document.createTextNode("");
        ctx.range.insertNode(frag);
        removeEmptySplitTail(lastNode);
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
    // 局部多行（<br>）：force 把整段包成 $$...$$——用 inline-math span 保留换行；
    // 两侧空格（如 "  x_i\n+y_i  "）单独保留，公式本体用 trim 后判定
    if (/\$\$/.test(out)) {
        const core = out.trim();
        if (/^\$\$\n?[\s\S]+?\n?\$\$$/.test(core)) {
            const leading = out.slice(0, out.length - out.trimStart().length);
            const trailing = out.slice(out.trimEnd().length);
            const content = core.slice(2, -2).trim();
            ctx.range.deleteContents();
            const frag = document.createDocumentFragment();
            if (leading) {
                frag.appendChild(document.createTextNode(leading));
            }
            frag.appendChild(buildInlineMathElement(content));
            if (trailing) {
                frag.appendChild(document.createTextNode(trailing));
            }
            const last = frag.childNodes[frag.childNodes.length - 1];
            ctx.range.insertNode(frag);
            removeEmptySplitTail(last);
            commitEditorChange(ctx.protyleElement);
            return "done";
        }
        return "blockNeedsWholeBlock"; // 混合内容中真带块级公式：仍提示选整段
    }
    // 局部行内：整段结果（文本+公式）片段替换
    applyLocalFragment(ctx.range, tokenizeMath(out), ctx.protyleElement);
    return "done";
}