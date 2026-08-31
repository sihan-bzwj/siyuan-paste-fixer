/**
 * 右键菜单管理（v0.2.3 拆分自 index.ts）。
 *
 * 双路径：
 * 1. open-menu-content 事件（Tier 1，官方通路，行为与 text-process 一致：无条件加项）；
 * 2. contextmenu 兜底（Tier 2）：真实右键后开观察窗，监控本次新菜单的出现，
 *    事件通路未处理时才把两项注入菜单 DOM；一次右键一个 interaction，新右键
 *    先取消旧任务，注入后立即断开观察；超时（500ms）自动放弃。
 *
 * 手动动作一律使用右键事件的 range 快照（ManualContext），不依赖点击后读取选区。
 * protyleElement 从 range 推导（captureManualContext），分屏时不会发给错误编辑器。
 */

import { captureManualContext, ManualContext, runManualAction } from "./manual-action";

export interface MenuDeps {
    i18n: Record<string, string>;
    fixText: (md: string) => string;
    convertToPlain: (md: string) => string;
    i18nGet: (key: string) => string;
    showMessage: (msg: string, timeout: number, type?: "error" | "info") => void;
}

const MENU_ACTION_ATTR = "data-paste-fixer-action";
const MENU_INTERACTION_ATTR = "data-paste-fixer-interaction";
/** 观察窗上限：超过即认为事件通路接管，放弃兜底 */
const FALLBACK_WINDOW_MS = 500;

export interface MenuHandlers {
    onOpenMenuContent: (event: CustomEvent<{menu: {addItem: (opt: unknown) => void}, range: Range}>) => void;
    onContextMenu: (event: MouseEvent) => void;
    dispose: () => void;
}

export function createMenuHandlers(deps: MenuDeps): MenuHandlers {
    let interactionSeq = 0;
    let observer: MutationObserver | null = null;
    let fallbackTimer: number | null = null;
    let activeContext: ManualContext | null = null;
    let knownMenus = new Set<Element>();

    /** 取消当前兜底任务（观察器 + 定时器），新右键/事件通路/dispose 都会调用。 */
    const cancelFallback = (): void => {
        if (fallbackTimer !== null) {
            window.clearTimeout(fallbackTimer);
            fallbackTimer = null;
        }
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        activeContext = null;
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

    /** 条件注入：向指定菜单的 .b3-menu__items 容器追加两项（带去重、先清旧） */
    const injectIntoMenu = (ctx: ManualContext, menu: HTMLElement): void => {
        if (menu.querySelector(`[${MENU_INTERACTION_ATTR}="${ctx.interactionId}"]`)) {
            return;
        }
        // 同一菜单内保留上次注入的旧项会撑宽布局，先清理
        menu.querySelectorAll(`[${MENU_ACTION_ATTR}]`).forEach((n) => n.remove());
        const already = [...menu.querySelectorAll(".b3-menu__text,.b3-menu__item")].some((el) =>
            (el.textContent || "").includes(deps.i18n.menuConvert));
        if (already) {
            return; // 事件总线路径已添加
        }
        // 真实菜单项容器（滚动列表）；找不到时退回菜单根
        const container = (menu.querySelector(".b3-menu__items") as HTMLElement | null) || menu;
        const mk = (label: string, kind: "fix" | "revert"): HTMLElement => {
            const el = document.createElement("button");
            el.className = "b3-menu__item";
            el.setAttribute(MENU_ACTION_ATTR, kind);
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
        container.appendChild(sep);
        container.appendChild(mk(deps.i18n.menuConvert, "fix"));
        container.appendChild(mk(deps.i18n.menuRevert, "revert"));
    };

    // Tier 1：官方事件通路（与 text-process 行为一致：无条件加两项），并接管取消兜底
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

    // Tier 2：contextmenu 兜底（观察本次新菜单出现；事件通路到来时自动取消）
    const onContextMenu = (event: MouseEvent) => {
        try {
            const target = event.target as HTMLElement | null;
            if (!target || typeof target.closest !== "function" || !target.closest(".protyle-wysiwyg")) {
                return;
            }
            cancelFallback(); // 新一次右键永远先取消上一次的兜底
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
            const ctx = captureContext(menuRange, null);
            activeContext = ctx;
            knownMenus = new Set(document.querySelectorAll(".b3-menu"));
            observer = new MutationObserver(() => {
                const menus = document.querySelectorAll(".b3-menu");
                for (const el of Array.from(menus)) {
                    if (!knownMenus.has(el)) {
                        knownMenus.add(el);
                        injectIntoMenu(activeContext ?? ctx, el as HTMLElement);
                        cancelFallback(); // 注入一次，立即断开
                        return;
                    }
                }
            });
            observer.observe(document.body, {childList: true, subtree: true});
            fallbackTimer = window.setTimeout(() => {
                cancelFallback(); // 观察窗超时：事件通路未处理也不强注入
            }, FALLBACK_WINDOW_MS);
        } catch (e) {
            console.error("[paste-fixer] 菜单兜底失败", e);
        }
    };

    const dispose = (): void => {
        cancelFallback();
        // 清理可能残留的注入项
        document.querySelectorAll(`[${MENU_ACTION_ATTR}]`).forEach((n) => n.remove());
    };

    return {onContextMenu, onOpenMenuContent, dispose};
}