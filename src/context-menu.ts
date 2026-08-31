/**
 * 右键菜单管理（v0.2.3 拆分自 index.ts）。
 *
 * 双路径：
 * 1. open-menu-content 事件（Tier 1，官方通路，行为与 text-process 一致：无条件加项）；
 * 2. contextmenu 兜底（Tier 2）：真实右键后开 500ms 观察窗，若事件通路未处理
 *    才把两项注入菜单 DOM；注入带 interactionId + 动作标记双重去重，观察自动断开。
 *
 * 手动动作一律使用右键事件的 range 快照（ManualContext），不依赖点击后读取选区。
 */

import { ManualContext, runManualAction } from "./manual-action";

export interface MenuDeps {
    i18n: Record<string, string>;
    fixText: (md: string) => string;
    convertToPlain: (md: string) => string;
    i18nGet: (key: string) => string;
    showMessage: (msg: string, timeout: number, type?: "error" | "info") => void;
}

const MENU_ACTION_ATTR = "data-paste-fixer-action";
const MENU_INTERACTION_ATTR = "data-paste-fixer-interaction";

export interface MenuHandlers {
    onOpenMenuContent: (event: CustomEvent<{menu: {addItem: (opt: unknown) => void}, range: Range}>) => void;
    onContextMenu: (event: MouseEvent) => void;
    dispose: () => void;
}

export function createMenuHandlers(deps: MenuDeps, getSettingsValue: (key: string) => unknown): MenuHandlers {
    let interactionSeq = 0;
    let pendingFallback: number | null = null;

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

    /** 从右键事件构建操作上下文（range 快照） */
    const captureContext = (
        menuRange: Range,
        protyle: unknown,
    ): ManualContext => {
        const range = menuRange.cloneRange();
        const startEl = range.startContainer.nodeType === 1
            ? range.startContainer as HTMLElement
            : (range.startContainer.parentElement as HTMLElement | null);
        const block = startEl?.closest?.("[data-node-id]") as HTMLElement | null;
        const blocks = Array.from(document.querySelectorAll(".protyle-wysiwyg [data-node-id]"))
            .filter((el) => range.intersectsNode(el) &&
                !(el.parentElement as HTMLElement | null)?.closest?.("[data-node-id]")) as HTMLElement[];
        const protyleEl = (protyle as {wysiwyg?: {element?: HTMLElement}} | null)?.wysiwyg?.element ?? null;
        return {
            range,
            protyleElement: protyleEl,
            block,
            blocks,
            selectedText: range.toString(),
            interactionId: ++interactionSeq,
            protyle,
        };
    };

    /** 条件注入：向全局菜单单例追加两项（带去重） */
    const injectIntoMenu = (ctx: ManualContext, tagInteraction: number): void => {
        const menuGlobal = (window as unknown as {
            siyuan?: {menus?: {menu?: {element?: HTMLElement}}},
        }).siyuan?.menus?.menu;
        const container = menuGlobal?.element;
        if (!container) {
            return;
        }
        if (container.querySelector(`[${MENU_INTERACTION_ATTR}="${tagInteraction}"]`)) {
            return;
        }
        const already = [...container.querySelectorAll(".b3-menu__text,.b3-menu__item")].some((el) =>
            (el.textContent || "").includes(deps.i18n.menuConvert));
        if (already) {
            return;
        }
        const mk = (label: string, kind: "fix" | "revert"): HTMLElement => {
            const el = document.createElement("div");
            el.className = "b3-menu__item";
            el.setAttribute(MENU_ACTION_ATTR, kind);
            el.setAttribute(MENU_INTERACTION_ATTR, String(tagInteraction));
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
        sep.setAttribute(MENU_INTERACTION_ATTR, String(tagInteraction));
        container.appendChild(sep);
        container.appendChild(mk(deps.i18n.menuConvert, "fix"));
        container.appendChild(mk(deps.i18n.menuRevert, "revert"));
    };

    // Tier 1：官方事件通路（与 text-process 行为一致：无条件加两项）
    const onOpenMenuContent = (event: CustomEvent<{menu: {addItem: (opt: unknown) => void}, range: Range}>) => {
        try {
            const { menu, range: menuRange } = event.detail || {};
            if (!menu || !menuRange) {
                return;
            }
            if (pendingFallback !== null) {
                window.clearTimeout(pendingFallback);
                pendingFallback = null;
            }
            const ctx = captureContext(menuRange, (event.detail as {protyle?: unknown}).protyle);
            menu.addItem(singleItem(deps.i18n.menuConvert, "fix", ctx));
            menu.addItem(singleItem(deps.i18n.menuRevert, "revert", ctx));
        } catch (e) {
            console.error("[paste-fixer] 菜单注册失败", e);
        }
    };

    // Tier 2：contextmenu 兜底（短窗观察，事件通路未处理才注入，观察自动断开）
    const onContextMenu = (event: MouseEvent) => {
        try {
            const target = event.target as HTMLElement | null;
            if (!target || typeof target.closest !== "function" || !target.closest(".protyle-wysiwyg")) {
                return;
            }
            const interaction = ++interactionSeq;
            const menuRange = window.getSelection()?.rangeCount
                ? window.getSelection()!.getRangeAt(0)
                : (() => {
                    const r = document.createRange();
                    r.setStart(target, 0);
                    r.collapse(true);
                    return r;
                })();
            const ctx = captureContext(menuRange, null);

            // 500ms 观察窗：事件通路若已处理（取消 fallback），否则注入一次并断开
            pendingFallback = window.setTimeout(() => {
                pendingFallback = null;
                injectIntoMenu(ctx, interaction);
            }, 500);
            // 事件通路（假如可用）把 pendingFallback 清零；注入由 injectIntoMenu 去重兜底
        } catch (e) {
            console.error("[paste-fixer] 菜单兜底失败", e);
        }
    };

    const dispose = (): void => {
        if (pendingFallback !== null) {
            window.clearTimeout(pendingFallback);
            pendingFallback = null;
        }
    };

    void getSettingsValue; // 保留依赖接口（便于未来按设置开关 Tier2）

    return {onContextMenu, onOpenMenuContent, dispose};
}