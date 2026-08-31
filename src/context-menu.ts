/**
 * 右键菜单管理（v0.2.3 拆分自 index.ts，第二轮重构）。
 *
 * 思源 v3.8.2 的菜单是**全局单例**（window.siyuan.menus.menu）：关闭时只清空
 * `element` 内容并隐藏，再次弹出不会新建 `.b3-menu`。因此“观察是否有新菜单”
 * 的兜底方案不可靠，改为使用思源公开的菜单生命周期事件：
 *
 * 1. `open-menu-content`（官方通路，行为与 text-process 一致：无条件 menu.addItem）；
 * 2. `common-menu-open`（兜底 1）：本次右键未处理时，向该菜单注入两项；
 * 3. 超时末班车（兜底 2）：两个事件都失效时，直接向当前可见菜单 DOM 注入一次。
 *
 * 注入项（按钮+分隔线）统一带 `data-paste-fixer-owned` 标记，清理时整体移除，
 * 菜单复用时不会残留空分隔线。手动动作一律使用右键事件的 range 快照。
 */

import { captureManualContext, ManualContext, runManualAction } from "./manual-action";

export interface MenuDeps {
    i18n: Record<string, string>;
    fixText: (md: string) => string;
    convertToPlain: (md: string) => string;
    i18nGet: (key: string) => string;
    showMessage: (msg: string, timeout: number, type?: "error" | "info") => void;
}

/** 插件注入节点统一标记（按钮 + 分隔线一起清） */
const OWNED_ATTR = "data-paste-fixer-owned";
const MENU_INTERACTION_ATTR = "data-paste-fixer-interaction";
/** 末班车窗口：事件通路晚于此时仍未处理，直接注入当前可见菜单 */
const FALLBACK_WINDOW_MS = 500;

export interface MenuHandlers {
    onOpenMenuContent: (event: CustomEvent<{menu: {addItem: (opt: unknown) => void}, range: Range}>) => void;
    onCommonMenuOpen: (event: CustomEvent<unknown>) => void;
    onContextMenu: (event: MouseEvent) => void;
    dispose: () => void;
}

export function createMenuHandlers(deps: MenuDeps): MenuHandlers {
    let interactionSeq = 0;
    let fallbackTimer: number | null = null;
    let activeContext: ManualContext | null = null;
    let armed = false;
    let handled = false;

    /** 取消本次右键的待办（新右键/处理完成/dispose 都会调用）。 */
    const cancelFallback = (): void => {
        if (fallbackTimer !== null) {
            window.clearTimeout(fallbackTimer);
            fallbackTimer = null;
        }
        armed = false;
        handled = false;
        activeContext = null;
    };

    /** 清理菜单内所有插件注入节点（按钮 + 分隔线，统一标记）。 */
    const cleanOwned = (root: HTMLElement): void => {
        root.querySelectorAll(`[${OWNED_ATTR}]`).forEach((n) => n.remove());
    };

    const singleItem = (label: string, kind: "fix" | "revert", ctx: ManualContext) => ({
        icon: "iconMath",
        label,
        click: (): void => {
            void runManualAction(ctx, kind, deps.fixText, deps.convertToPlain)
                .then((key) => deps.showMessage(deps.i18nGet(key), 3000))
                .catch((e) => {
                    console.error("[paste-fixer] 手动动作失败", e);
                    deps.showMessage(deps.i18nGet("fail") + ": " + (e instanceof Error ? e.message : String(e)), 5000, "error");
                });
        },
    });

    /** 从右键事件构建操作上下文，并分配本次 interaction 编号 */
    const captureContext = (menuRange: Range, protyle: unknown): ManualContext => {
        const ctx = captureManualContext(menuRange, protyle);
        ctx.interactionId = ++interactionSeq;
        return ctx;
    };

    /** DOM 注入两项（含分隔线；同一次 interaction 去重，先清同类旧节点）。 */
    const injectIntoMenu = (ctx: ManualContext, root: HTMLElement): void => {
        if (root.querySelector(`[${MENU_INTERACTION_ATTR}="${ctx.interactionId}"]`)) {
            return;
        }
        // 同一菜单复用：先移除上一次注入的按钮与分隔线，避免残留/重复
        cleanOwned(root);
        const container = (root.querySelector(".b3-menu__items") as HTMLElement | null) || root;
        const mk = (label: string, kind: "fix" | "revert"): HTMLElement => {
            const el = document.createElement("button");
            el.className = "b3-menu__item";
            el.setAttribute(OWNED_ATTR, "1");
            el.setAttribute("data-paste-fixer-action", kind);
            el.setAttribute(MENU_INTERACTION_ATTR, String(ctx.interactionId));
            el.innerHTML = '<svg class="b3-menu__icon"><use xlink:href="#iconMath"></use></svg>' +
                '<span class="b3-menu__text"></span>';
            (el.querySelector(".b3-menu__text") as HTMLElement).textContent = label;
            el.addEventListener("click", () => {
                void runManualAction(ctx, kind, deps.fixText, deps.convertToPlain)
                    .then((key) => deps.showMessage(deps.i18nGet(key), 3000))
                    .catch((e) => {
                        console.error("[paste-fixer] 手动动作失败", e);
                        deps.showMessage(deps.i18nGet("fail") + ": " + (e instanceof Error ? e.message : String(e)), 5000, "error");
                    });
            });
            return el;
        };
        const sep = document.createElement("div");
        sep.className = "b3-menu__separator";
        sep.setAttribute(OWNED_ATTR, "1");
        container.appendChild(sep);
        container.appendChild(mk(deps.i18n.menuConvert, "fix"));
        container.appendChild(mk(deps.i18n.menuRevert, "revert"));
    };

    // 一级：官方事件通路（无条件加项），并接管取消其它注入路径
    const onOpenMenuContent = (event: CustomEvent<{menu: {addItem: (opt: unknown) => void}, range: Range}>) => {
        try {
            const { menu, range: menuRange } = event.detail || {};
            if (!menu || !menuRange) {
                return;
            }
            cancelFallback();
            const ctx = captureContext(menuRange, (event.detail as {protyle?: unknown}).protyle);
            menu.addItem(singleItem(deps.i18n.menuConvert, "fix", ctx));
            menu.addItem(singleItem(deps.i18n.menuRevert, "revert", ctx));
        } catch (e) {
            console.error("[paste-fixer] 菜单注册失败", e);
        }
    };

    // 二级：common-menu-open（思源菜单单例复用，等待“本次弹出”事件本身）
    const onCommonMenuOpen = (event: CustomEvent<unknown>) => {
        try {
            if (!armed || handled || !activeContext) {
                return;
            }
            const detail = event.detail as {menu?: {addItem?: (opt: unknown) => void, element?: HTMLElement}};
            // 菜单对象带官方 addItem API 时优先 API（与一级通路一致）
            if (detail?.menu && typeof detail.menu.addItem === "function") {
                detail.menu.addItem(singleItem(deps.i18n.menuConvert, "fix", activeContext));
                detail.menu.addItem(singleItem(deps.i18n.menuRevert, "revert", activeContext));
            } else {
                const root = detail?.menu?.element ??
                    Array.from(document.querySelectorAll(".b3-menu")).pop() as HTMLElement | undefined;
                if (root) {
                    injectIntoMenu(activeContext, root);
                }
            }
            handled = true;
            cancelFallback();
        } catch (e) {
            console.error("[paste-fixer] common-menu-open 注入失败", e);
        }
    };

    // 三级：contextmenu 兜底（事件通路全部失效时的末班车 DOM 注入）
    const onContextMenu = (event: MouseEvent) => {
        try {
            const target = event.target as HTMLElement | null;
            if (!target || typeof target.closest !== "function" || !target.closest(".protyle-wysiwyg")) {
                return;
            }
            cancelFallback(); // 新一次右键永远先取消上一次的待办
            const editor = target.closest(".protyle-wysiwyg");
            // 选区只在与右键目标同一编辑器时才可信（分屏时不拿旧编辑器选区）
            let menuRange: Range | null = null;
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const r = sel.getRangeAt(0);
                const el = r.startContainer.nodeType === 1
                    ? r.startContainer as Element
                    : (r.startContainer.parentElement as Element | null);
                if (el?.closest?.(".protyle-wysiwyg") === editor) {
                    menuRange = r;
                }
            }
            if (!menuRange) {
                menuRange = document.createRange();
                menuRange.setStart(target, 0);
                menuRange.collapse(true);
            }
            activeContext = captureContext(menuRange, null);
            armed = true;
            handled = false;
            fallbackTimer = window.setTimeout(() => {
                // 事件通路均未处理：向当前可见菜单注入一次（不猜新菜单）
                if (armed && !handled && activeContext) {
                    const root = Array.from(document.querySelectorAll(".b3-menu")).pop() as HTMLElement | undefined;
                    if (root) {
                        injectIntoMenu(activeContext, root);
                    }
                }
                cancelFallback();
            }, FALLBACK_WINDOW_MS);
        } catch (e) {
            console.error("[paste-fixer] 菜单兜底失败", e);
        }
    };

    const dispose = (): void => {
        cancelFallback();
        // 清理可能残留的注入项（按钮 + 分隔线）
        document.querySelectorAll(`[${OWNED_ATTR}]`).forEach((n) => n.remove());
    };

    return {onContextMenu, onOpenMenuContent, onCommonMenuOpen, dispose};
}