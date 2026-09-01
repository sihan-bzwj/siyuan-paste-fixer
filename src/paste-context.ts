/**
 * 原生 paste 上下文捕获（v0.2.3 单通道改造）。
 *
 * 原生 paste 事件不再拦截/修改/重派发（拿不到 files 会丢附件、重派发会与其他
 * 插件冲突、stopImmediatePropagation 会破坏思源自身处理）。这里只做只读快照：
 * - 粘贴目标是否在代码块/行内代码内（事件总线通道无法感知，issue #1 的漏口）；
 * - 所在编辑器（.protyle-wysiwyg）、是否携带文件、文本内容。
 *
 * EventBus paste 事件消费最近一次快照，统一决定是否修复。快照短有效期
 * （PASTE_CONTEXT_WINDOW_MS），过期或不匹配直接忽略，行为回到无快照默认。
 */

export interface PasteContextSnapshot {
    /** 捕获时刻（Date.now()），供消费方做时效校验 */
    time: number;
    inCodeTarget: boolean;
    /** 粘贴所在编辑器（用于事件总线通道缺 detail.protyle 时的兜底） */
    protyleElement: HTMLElement | null;
    hasFiles: boolean;
    textPlain: string;
    textHTML: string;
}

export const PASTE_CONTEXT_WINDOW_MS = 500;

/** 代码目标判定：代码块 / 行内代码（官方 DOM 行内代码是 span[data-type="code"]，
 *  历史形态 NodeInlineCode 兼容保留）。 */
const CODE_TARGET_SELECTOR = '[data-type="NodeCodeBlock"], [data-type="NodeInlineCode"], [data-type="code"]';

/** caret 是否落在**当前编辑器**的代码目标内（paste 的 event.target 常是外层
 *  contenteditable，真正光标可能在内部的行内代码 span 上；且分屏时另一编辑器
 *  的残留 selection 不能污染本次粘贴的判定）。 */
function selectionInCodeTarget(expectedEditor: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        return false;
    }
    const node = sel.getRangeAt(0).startContainer;
    const el = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!el) {
        return false;
    }
    if (el.closest?.(".protyle-wysiwyg") !== expectedEditor) {
        return false; // selection 不属于本次粘贴的编辑器
    }
    return el.closest?.(CODE_TARGET_SELECTOR) !== null;
}

/** 捕获原生 paste 上下文；不在正文编辑器内或没有剪贴板数据时返回 null。 */
export function capturePasteContext(
    event: {
        target: EventTarget | null;
        clipboardData: {files: ArrayLike<unknown> | null, getData: (type: string) => string} | null;
    },
): PasteContextSnapshot | null {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") {
        return null;
    }
    const protyleElement = target.closest(".protyle-wysiwyg") as HTMLElement | null;
    if (!protyleElement || !event.clipboardData) {
        return null;
    }
    const inCodeTarget = !!target.closest(CODE_TARGET_SELECTOR) || selectionInCodeTarget(protyleElement);
    return {
        time: Date.now(),
        inCodeTarget,
        protyleElement,
        hasFiles: (event.clipboardData.files?.length ?? 0) > 0,
        textPlain: event.clipboardData.getData("text/plain") || "",
        textHTML: event.clipboardData.getData("text/html") || "",
    };
}

/**
 * 时效与指纹校验：快照在窗口期内**且**文本指纹一致才视为本次粘贴的上下文。
 * 若上一次快照未被消费、2 秒（窗口）内又发生另一次粘贴，指纹不匹配的快照
 * 会被忽略，避免吃到旧 context。
 */
export function consumePasteContext(
    snapshot: PasteContextSnapshot | null,
    now: number,
    expected?: {textPlain?: string, textHTML?: string},
): PasteContextSnapshot | null {
    if (!snapshot) {
        return null;
    }
    if (now - snapshot.time > PASTE_CONTEXT_WINDOW_MS) {
        return null;
    }
    if (expected) {
        if (expected.textPlain && snapshot.textPlain && expected.textPlain !== snapshot.textPlain) {
            return null;
        }
        if (expected.textHTML && snapshot.textHTML && expected.textHTML !== snapshot.textHTML) {
            return null;
        }
    }
    return snapshot;
}