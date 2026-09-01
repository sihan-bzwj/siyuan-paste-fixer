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

/** 代码目标判定选择器（全插件统一；官方 DOM 行内代码是 span[data-type="code"]）。 */
export const CODE_TARGET_SELECTOR = '[data-type="NodeCodeBlock"], [data-type="NodeInlineCode"], [data-type="code"]';

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

/**
 * 用 EventBus 自带 detail.protyle 实时判定代码目标（与快照互为备份：
 * 快照指纹可能因思源 normalize（CRLF→LF、HTML sanitize）与 EventBus 内容不一致
 * 而无法匹配，此时安全标志仍应可用）。
 */
export function codeTargetFromProtyle(protyle: unknown): boolean {
    const el = (protyle as {wysiwyg?: {element?: HTMLElement}} | null)?.wysiwyg?.element;
    if (!el) {
        return false;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        return false;
    }
    const node = sel.getRangeAt(0).startContainer;
    const nEl = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!nEl) {
        return false;
    }
    if (nEl.closest?.(".protyle-wysiwyg") !== el) {
        return false;
    }
    return nEl.closest?.(CODE_TARGET_SELECTOR) !== null;
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

export interface PasteContextResolution {
    /** 指纹匹配的内容上下文（null = 内容不匹配，仅安全标志可信） */
    context: PasteContextSnapshot | null;
    /** 安全标志：窗口期内最新快照的代码目标（指纹不一致也采纳——错误修改代码
     *  内容比少修一次公式危险得多） */
    codeTarget: boolean;
    hasFiles: boolean;
}

/**
 * 快照解析：安全标志（inCodeTarget/hasFiles）与内容指纹解耦——
 * 思源会在原生 paste 与 EventBus 之间 normalize 文本（CRLF→LF、HTML sanitize），
 * 严格指纹匹配会误丢 inCodeTarget，导致代码块保护失效（issue #1 绕过）。
 * 窗口期内：安全标志始终可信；内容上下文仅在指纹一致时提供。
 */
export function resolvePasteContext(
    snapshot: PasteContextSnapshot | null,
    now: number,
    expected?: {textPlain?: string, textHTML?: string},
): PasteContextResolution {
    if (!snapshot) {
        return {context: null, codeTarget: false, hasFiles: false};
    }
    const fresh = now - snapshot.time <= PASTE_CONTEXT_WINDOW_MS;
    if (!fresh) {
        return {context: null, codeTarget: false, hasFiles: false};
    }
    let matched = true;
    if (expected) {
        if (expected.textPlain && snapshot.textPlain && expected.textPlain !== snapshot.textPlain) {
            matched = false;
        }
        if (expected.textHTML && snapshot.textHTML && expected.textHTML !== snapshot.textHTML) {
            matched = false;
        }
    }
    return {
        context: matched ? snapshot : null,
        codeTarget: snapshot.inCodeTarget,
        hasFiles: snapshot.hasFiles,
    };
}

/**
 * 时效与指纹校验：快照在窗口期内**且**文本指纹一致才视为本次粘贴的上下文。
 * 若上一次快照未被消费、窗口内又发生另一次粘贴，指纹不匹配的快照会被忽略，
 * 避免吃到旧 context。（安全标志见 resolvePasteContext，两者用途不同。）
 */
export function consumePasteContext(
    snapshot: PasteContextSnapshot | null,
    now: number,
    expected?: {textPlain?: string, textHTML?: string},
): PasteContextSnapshot | null {
    return resolvePasteContext(snapshot, now, expected).context;
}