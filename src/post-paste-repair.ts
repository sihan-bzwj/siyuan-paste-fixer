/**
 * 粘贴后兜底修复（v0.2.8）。
 *
 * 富文本粘贴（剪贴板带复杂 HTML）走"原样放行"分支，插件不重写载荷，破损公式就
 * 留在文档里渲染报错。这里在粘贴落地后补一次"只修公式内容"的兜底：
 *
 * - 只处理**渲染失败**的公式节点（节点内有 .katex-error / 文本含 KaTeX parse error）；
 * - 只改 data-content，再走内核 /api/block/updateBlock（保 block ID，由内核重新渲染
 *   并落盘）；段落结构、加粗、链接、图片等一律不碰；
 * - 范围限定：本次粘贴新出现的块 + 粘贴后光标所在块，不扫无关内容；
 * - fail-closed：序列化器遇到白名单外结构（加粗/链接/图片/行内代码…）返回 null 时
 *   整块跳过并回滚，绝不为了公式丢格式。
 */
import {fixLatexText} from "./fix-latex";
import {applyWholeBlock, extractSourceMarkdown} from "./manual-action";

export const MATH_NODE_SELECTOR = '[data-type="inline-math"], [data-type="NodeMathBlock"]';

export type MathNodeKind = "inline" | "block";

/** 渲染失败判定：思源用 KaTeX（throwOnError:false），失败时留下 .katex-error 节点。 */
export function isBrokenMathNode(el: Element): boolean {
    if (el.querySelector(".katex-error")) {
        return true;
    }
    return /katex parse error/i.test(el.textContent || "");
}

/**
 * 公式节点内容修复（复用粘贴修复引擎）。返回 null 表示"不动"：
 * - 行内节点：结果必须仍是单个 $...$（跨行会被升级成块级、不能被原地替换）；
 * - 数字开头被 luteSafeInline 包成 {...} 的属于解析辅助，不是内容变更，也不动。
 */
export function fixMathNodeContent(
    kind: MathNodeKind,
    content: string,
    fixText: (markdown: string) => string = fixLatexText,
): string | null {
    if (!content.trim()) {
        return null;
    }
    if (kind === "inline") {
        const wrapped = fixText("$" + content + "$");
        if (!/^\$[^$]*\$$/.test(wrapped)) {
            return null;
        }
        const inner = wrapped.slice(1, -1);
        if (inner === content || inner === "{" + content + "}") {
            return null;
        }
        return inner.includes("\n") ? null : inner;
    }
    const wrapped = fixText("$$\n" + content + "\n$$");
    const m = /^\$\$\n?([\s\S]*?)\n?\$\$$/.exec(wrapped);
    if (!m) {
        return null;
    }
    const inner = m[1].trim();
    return inner === content ? null : inner;
}

export interface MathRepairCandidate {
    el: HTMLElement;
    kind: MathNodeKind;
    from: string;
    to: string;
}

/** 从给定块里收集"渲染失败且能修"的公式节点（纯函数，不写 DOM）。 */
export function collectMathRepairs(
    blocks: Iterable<Element>,
    fixText: (markdown: string) => string = fixLatexText,
): MathRepairCandidate[] {
    const out: MathRepairCandidate[] = [];
    for (const block of blocks) {
        // 公式块自身就是命中节点（querySelectorAll 只查后代，必须单独判一次）
        const scope = block.matches(MATH_NODE_SELECTOR)
            ? [block as Element, ...Array.from(block.querySelectorAll(MATH_NODE_SELECTOR))]
            : Array.from(block.querySelectorAll(MATH_NODE_SELECTOR));
        for (const el of scope) {
            if (!isBrokenMathNode(el)) {
                continue;
            }
            const kind: MathNodeKind = el.getAttribute("data-type") === "NodeMathBlock" ? "block" : "inline";
            const from = el.getAttribute("data-content") || "";
            const to = fixMathNodeContent(kind, from, fixText);
            if (to === null) {
                continue;
            }
            out.push({el: el as HTMLElement, kind, from, to});
        }
    }
    return out;
}

/** 块 → Markdown（复制路线，白名单外的结构返回 null）。 */
export function serializeBlockMarkdown(block: HTMLElement): string | null {
    if (block.getAttribute("data-type") === "NodeMathBlock") {
        return "$$\n" + (block.getAttribute("data-content") || "") + "\n$$";
    }
    const editable = block.querySelector('[contenteditable="true"]') as HTMLElement | null;
    // <wbr> 只是思源的换行/光标占位（空块里才有），对 Markdown 无语义：克隆后删掉再序列化
    const clone = (editable ?? block).cloneNode(true) as HTMLElement;
    clone.querySelectorAll("wbr").forEach((el) => el.remove());
    const range = document.createRange();
    range.selectNodeContents(clone);
    return extractSourceMarkdown(range, block, "whole-block");
}

export interface MathRepairDeps {
    serializeBlock?: (block: HTMLElement) => string | null;
    updateBlock?: (block: HTMLElement, markdown: string) => Promise<void>;
}

/**
 * 应用修复：块内先把修复后的 data-content 写进 DOM（序列化器读它），序列化成功
 * 才发 updateBlock（内核重新渲染，DOM 引用随之失效）；失败/白名单外一律回滚。
 * 返回真正修好的公式个数。
 */
export async function applyMathRepairs(
    candidates: readonly MathRepairCandidate[],
    deps: MathRepairDeps = {},
): Promise<number> {
    const serialize = deps.serializeBlock ?? serializeBlockMarkdown;
    const update = deps.updateBlock ?? applyWholeBlock;
    const byBlock = new Map<HTMLElement, MathRepairCandidate[]>();
    for (const c of candidates) {
        const block = c.el.closest("[data-node-id]") as HTMLElement | null;
        if (!block) {
            continue;
        }
        const list = byBlock.get(block);
        if (list) {
            list.push(c);
        } else {
            byBlock.set(block, [c]);
        }
    }
    const rollback = (list: readonly MathRepairCandidate[]): void => {
        for (const c of list) {
            if (c.el.isConnected) {
                c.el.setAttribute("data-content", c.from);
            }
        }
    };
    let fixed = 0;
    for (const [block, list] of byBlock) {
        for (const c of list) {
            c.el.setAttribute("data-content", c.to);
        }
        let markdown: string | null = null;
        try {
            markdown = serialize(block);
        } catch (e) {
            markdown = null;
        }
        if (markdown === null) {
            rollback(list);
            continue;
        }
        try {
            await update(block, markdown);
            fixed += list.length;
        } catch (e) {
            rollback(list);
        }
    }
    return fixed;
}

/** 光标所在块的 node-id（不在目标编辑器内返回 null）。 */
function caretBlockId(editor: Element): string | null {
    const sel = typeof window === "undefined" ? null : window.getSelection?.();
    if (!sel || sel.rangeCount === 0) {
        return null;
    }
    const node = sel.getRangeAt(0).startContainer;
    const el = node.nodeType === 1 ? node as Element : node.parentElement;
    const block = el?.closest?.("[data-node-id]") ?? null;
    return block && editor.contains(block) ? block.getAttribute("data-node-id") : null;
}

/**
 * 本次粘贴涉及的块：粘贴前不存在的块（新块）+ 光标所在块（粘进已有空块的场景）。
 * knownIds 为 null（没有抓到粘贴前快照）时只认光标块，绝不全文档乱修。
 */
export function collectPasteTargetBlocks(
    editor: Element,
    knownIds: Set<string> | null,
): HTMLElement[] {
    const caretId = caretBlockId(editor);
    const out: HTMLElement[] = [];
    for (const el of Array.from(editor.querySelectorAll("[data-node-id]"))) {
        const id = el.getAttribute("data-node-id") || "";
        if (!id) {
            continue;
        }
        if (caretId !== null && id === caretId) {
            out.push(el as HTMLElement);
            continue;
        }
        if (knownIds && !knownIds.has(id)) {
            out.push(el as HTMLElement);
        }
    }
    return out;
}
