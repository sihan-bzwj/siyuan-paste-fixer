import { Menu, Plugin, showMessage } from "siyuan";
import type { IEventBusMap } from "siyuan";
import {
    fixLatexText,
    maskLuteUnsafeDollars,
    maskProtectedSegments,
} from "./fix-latex";
import {selectClipboardMarkdown} from "./clipboard";
import {countMathFormulas, DEFAULT_POLICY, detectPasteScenario, PasteScenario, ScenarioPolicy} from "./scenario";
import {hasMathML} from "./mathml";
import {ManualContext, runManualAction} from "./manual-action";
import {createMenuHandlers, MenuHandlers} from "./context-menu";
import {createSettingsPanel, loadSettingsFromFile, PasteFixerSettings, saveSettingsToFile} from "./settings";

type PasteDetail = IEventBusMap["paste"];

/** Lute 实例的最小接口 */
interface ILiteLute {
    Md2BlockDOM: (s: string) => string;
    NewNodeID: () => string;
    SetInlineMath: (b: boolean) => void;
    SetInlineAsterisk: (b: boolean) => void;
    SetGFMStrikethrough: (b: boolean) => void;
    SetSub: (b: boolean) => void;
    SetSup: (b: boolean) => void;
    SetTag: (b: boolean) => void;
    SetInlineUnderscore: (b: boolean) => void;
}

/** 自建全局 Lute 实例（window.Lute.New()），与编辑器共享的语法开关保持一致 */
let cachedLute: ILiteLute | null = null;
function getLute(): ILiteLute | null {
    if (cachedLute) {
        return cachedLute;
    }
    try {
        const L = (window as unknown as {Lute?: {New: () => ILiteLute, NewNodeID: () => string}}).Lute;
        if (!L || typeof L.New !== "function") {
            return null;
        }
        const inst = L.New();
        inst.SetInlineMath(true);
        inst.SetInlineAsterisk(true);
        inst.SetGFMStrikethrough(true);
        inst.SetSub(true);
        inst.SetSup(true);
        inst.SetTag(true);
        inst.SetInlineUnderscore(true);
        cachedLute = inst;
    } catch (e) {
        return null;
    }
    return cachedLute;
}

/**
 * 把修复后的 Markdown 转成思源内部块 DOM。
 * 思源前端 Lute 只解析行内数学（$$ 块会被降级成行内公式），
 * 因此 $$ 块在这里手工生成真公式块 DOM，其余内容交给 Lute 的 Md2BlockDOM。
 * 代码/链接/URL 等保护段先遮蔽成占位符：整段 Markdown 一次性交给 Lute 渲染
 * （拆段渲染会切断行内结构），还原只发生在 Lute 输出的纯文本片段上；
 * Lute 会把链接/行内代码渲染成 span，占位符落在 span 的纯文本里。
 */
function mdToSiyuanHTML(md: string, lute: ILiteLute): string {
    const protectedMask = maskProtectedSegments(md);
    // 代码/链接先遮蔽，再检查剩余 Markdown 中的孤立美元。两层恢复顺序与
    // 遮蔽顺序相反：先把美元恢复为普通 DOM 文本，再还原保护段原文。
    const dollarMask = maskLuteUnsafeDollars(protectedMask.masked);
    const masked = dollarMask.masked;
    const restore = (html: string): string =>
        protectedMask.restore(dollarMask.restore(html));
    const out: string[] = [];
    const newId = (): string => {
        // 优先用 Lute 实例的 NewNodeID，全局 Lute 类作为兜底
        if (typeof lute.NewNodeID === "function") {
            return lute.NewNodeID();
        }
        const globalLute = (window as unknown as {Lute?: {NewNodeID: () => string}}).Lute;
        return globalLute?.NewNodeID() ?? `${Date.now()}-pastefix`;
    };
    const parts = masked.split(/(\$\$[\s\S]+?\$\$)/g);
    for (const part of parts) {
        if (!part.trim()) {
            continue;
        }
        if (part.startsWith("$$") && part.endsWith("$$") && !part.includes("\u0001")) {
            const latex = part.slice(2, -2).trim();
            const attr = latex.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
            out.push(`<div data-node-id="${newId()}" data-type="NodeMathBlock" class="render-node"` +
                ` data-content="${attr}" data-subtype="math"><div spin="1"></div></div>`);
        } else {
            out.push(restore(lute.Md2BlockDOM(part)));
        }
    }
    return out.join("");
}

/** 把标准公式形态还原为纯文本（右键"还原为纯文本"）：$$/$ 去定界符、包装花括号还原。 */
function convertMathToPlainText(text: string): string {
    return text
        .replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => inner.trim())
        .replace(/\$([^$\n\u0001\u0002]+?)\$/g, (_m, inner: string) => {
            const core = inner.trim();
            return /^\{.*\}$/.test(core) ? core.slice(1, -1) : core;
        });
}

/**
 * 双通道粘贴修复：
 * 1. 事件总线通道（官方 paste 事件）
 * 2. DOM 通道（document 捕获阶段原生 paste 事件，修复后重新派发，作为总线失效时的兜底）
 */
export default class PasteFixer extends Plugin {
    /** 运行设置（settings.ts 持久化；不依赖 SDK 基类的 this.data 加载机制） */
    private settings: PasteFixerSettings = {};
    /** 右键菜单双路径管理器（context-menu.ts） */
    private menuHandlers: MenuHandlers | null = null;
    /** 顶栏按钮元素（addTopBar 返回，避免按 id 猜 DOM） */
    private topBarElement: HTMLElement | null = null;

    /** 通道 1：官方事件总线 paste 事件 */
    private onPaste = (event: CustomEvent<PasteDetail>) => {
        const detail = event.detail;
        const resolve = detail.resolve as unknown as (value: unknown) => void;
        try {
            const textHTML = detail.textHTML || "";
            const textPlain = detail.textPlain || "";
            const siyuanHTML = detail.siyuanHTML || "";
            const files = detail.files;

            // 场景路由：固定放行场景直接原样
            const scenario = detectPasteScenario({textPlain, textHTML, siyuanHTML, inCodeTarget: false});
            if (scenario === "siyuan-internal" || scenario === "code-target" || scenario === "plain-prose") {
                resolve(detail);
                return;
            }
            const policy = this.scenarioPolicy(scenario);
            if (policy === "pass" || (policy === "smart" && scenario === "code-content")) {
                // 代码内容/pass 策略：原样粘贴 + 提示可用右键修复
                this.maybeHint(scenario, 0);
                resolve(detail);
                return;
            }

            const decision = selectClipboardMarkdown(textHTML, textPlain, siyuanHTML);
            const fixed = decision?.markdown ?? null;
            const plain = fixed ?? textPlain;

            // 无需修复的文本，若含 $$ 块也升级为真公式块内部格式（前端 Lute 会把 $$ 降级成行内）
            if (!siyuanHTML && /\$\$/.test(plain)) {
                const lute = getLute();
                if (lute) {
                    let sy = "";
                    try {
                        sy = mdToSiyuanHTML(plain, lute);
                    } catch (e) {
                        // 生成失败走纯文本
                    }
                    if (sy) {
                        const hasFiles = !!files && files.length > 0;
                        if (!hasFiles) {
                            this.maybeHint(scenario, countMathFormulas(plain));
                            resolve({textHTML: "", textPlain: plain, siyuanHTML: sy, files});
                            return;
                        }
                    }
                }
            }

            if (fixed === null) {
                this.maybeHint(scenario, countMathFormulas(plain));
                resolve(detail);
                return;
            }

            const hasFiles = !!files && files.length > 0;
            const richHTML = /<(h[1-6]|li|ul|ol|table|img|pre|blockquote|strong|b|i|em|a)[\s>]/i.test(textHTML);
            // 修复后的 Markdown 若仍含孤立/非公式美元，不能直接交给思源重新
            // 配对；必须先走 mdToSiyuanHTML，让占位符把它固定成普通文本。
            const protectedForCheck = maskProtectedSegments(fixed);
            const needsDollarShield = maskLuteUnsafeDollars(protectedForCheck.masked).count > 0;
            if (!hasFiles && (!richHTML || hasMathML(textHTML)) && !needsDollarShield) {
                this.maybeHint(scenario, countMathFormulas(fixed));
                resolve({textHTML: "", textPlain: fixed, siyuanHTML: "", files});
                return;
            }
            // 富文本但无 MathML：修复后的 Markdown 交给内核转 DOM（牺牲富格式，保住公式修复）
            if (!hasFiles) {
                const lute = getLute();
                if (lute) {
                    try {
                        const sy = mdToSiyuanHTML(fixed, lute);
                        if (sy) {
                            this.maybeHint(scenario, countMathFormulas(fixed));
                            resolve({textHTML: "", textPlain: fixed, siyuanHTML: sy, files});
                            return;
                        }
                    } catch (e) {
                        console.error("[paste-fixer] 富文本转换失败，按原样粘贴", e);
                    }
                }
            }
        } catch (e) {
            console.error("[paste-fixer] 修复失败，按原样粘贴", e);
        }
        resolve(detail);
    };

    /** 通道 2：DOM 捕获阶段拦截原生 paste，修复后重新派发（不依赖事件总线） */
    private onDomPaste = (event: ClipboardEvent) => {
        try {
            if ((event as unknown as { __pasteFixer?: boolean }).__pasteFixer) {
                return; // 自己重发的事件，放行
            }
            const target = event.target as HTMLElement | null;
            if (!target || typeof target.closest !== "function" || !target.closest(".protyle-wysiwyg")) {
                return; // 只处理正文编辑器内的粘贴
            }
            if (target.closest('[data-type="NodeCodeBlock"], [data-type="NodeInlineCode"]')) {
                return; // 粘贴目标是代码块/行内代码：代码内容一律不参与公式修复
            }
            const cd = event.clipboardData;
            if (!cd) {
                return;
            }
            const textPlain = cd.getData("text/plain") || "";
            const textHTML = cd.getData("text/html") || "";
            const siyuanHTML = cd.getData("text/siyuan") || "";
            if (siyuanHTML && /data-type="(?:NodeMathBlock|inline-math)"/.test(siyuanHTML)) {
                return;
            }

            // 场景路由：固定放行 / pass 策略 / 智能代码内容 → 放行原始粘贴
            const scenario = detectPasteScenario({textPlain, textHTML, siyuanHTML, inCodeTarget: false});
            if (scenario === "siyuan-internal" || scenario === "plain-prose") {
                return;
            }
            const policy = this.scenarioPolicy(scenario);
            if (policy === "pass" || (policy === "smart" && scenario === "code-content")) {
                this.maybeHint(scenario, 0);
                return;
            }

            const decision = selectClipboardMarkdown(textHTML, textPlain, siyuanHTML);
            const fixed = decision?.markdown ?? null;
            if (fixed === null || fixed === textPlain) {
                this.maybeHint(scenario, countMathFormulas(textPlain));
                return; // 无需修复，放行原始粘贴
            }
            // 阻断原始粘贴，用修复后的内容重发；text/siyuan 保证公式以块级形态插入
            event.preventDefault();
            event.stopImmediatePropagation();
            const dt = new DataTransfer();
            dt.setData("text/plain", fixed);
            const lute = getLute();
            if (lute) {
                try {
                    dt.setData("text/siyuan", mdToSiyuanHTML(fixed, lute));
                } catch (e) {
                    // 生成失败走纯文本（公式会降级为行内）
                }
            }
            this.maybeHint(scenario, countMathFormulas(fixed));
            const redispatch = new ClipboardEvent("paste", {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
            });
            (redispatch as unknown as { __pasteFixer: boolean }).__pasteFixer = true;
            target.dispatchEvent(redispatch);
        } catch (e) {
            console.error("[paste-fixer] DOM 通道修复失败", e);
        }
    };

    /** 场景 → 生效策略（设置可覆盖默认值） */
    private scenarioPolicy(scenario: PasteScenario): ScenarioPolicy {
        const s = this.settings as unknown as Record<string, ScenarioPolicy>;
        switch (scenario) {
            case "code-content": return s.codePolicy || DEFAULT_POLICY["code-content"];
            case "ai-latex": return s.aiPolicy || DEFAULT_POLICY["ai-latex"];
            case "web-math": return s.webPolicy || DEFAULT_POLICY["web-math"];
            case "mixed": return s.mixedPolicy || DEFAULT_POLICY["mixed"];
            default: return DEFAULT_POLICY[scenario];
        }
    }

    /** 提示去重：DOM 通道提示后重发事件，总线通道会再触发一次，1s 内只提示一次 */
    private lastHintAt = 0;

    /** 场景提示（设置可关闭；提示失败不影响粘贴） */
    private maybeHint(scenario: PasteScenario, count: number): void {
        try {
            const now = Date.now();
            if (now - this.lastHintAt < 1000) {
                return;
            }
            this.lastHintAt = now;
            if (this.settings.hintsEnabled === false) {
                return;
            }
            const text = this.hintText(scenario, count);
            if (text) {
                showMessage(text, scenario === "code-content" ? 6000 : 4000);
            }
        } catch (e) {
            /* 提示失败不影响粘贴 */
        }
    }

    private hintText(scenario: PasteScenario, count: number): string {
        switch (scenario) {
            case "code-content":
                return this.i18n.hintCode;
            case "ai-latex":
                return this.i18n.hintAI.replace("{n}", String(count));
            case "web-math":
                return this.i18n.hintWeb.replace("{n}", String(count));
            case "mixed":
                return this.i18n.hintMixed.replace("{n}", String(count));
            default:
                return "";
        }
    }

    /** 顶栏按钮弹出开关菜单（仿 text-process）：场景策略开关即时生效 */
    private showQuickMenu(): void {
        try {
            let btn: HTMLElement | null = this.topBarElement;
            const b = btn && btn.getBoundingClientRect();
            if (!btn || (b && b.width === 0)) {
                btn = document.querySelector("#barMore") ||
                    document.querySelector("#barPlugins");
            }
            const rect = btn ? btn.getBoundingClientRect() : null;
            const menu = new Menu("paste-fixer-quick", () => {});
            const toggle = (
                key: "codePolicy" | "aiPolicy" | "webPolicy" | "mixedPolicy",
                scenario: PasteScenario,
                label: string,
            ): void => {
                const current = this.scenarioPolicy(scenario);
                const on = current === "fix";
                menu.addItem({
                    icon: on ? "iconSelect" : "iconClose",
                    label,
                    click: () => {
                        (this.settings as unknown as Record<string, unknown>)[key] = on ? "smart" : "fix";
                        void saveSettingsToFile(this.settings);
                        setTimeout(() => this.showQuickMenu(), 60);
                    },
                });
            };
            toggle("codePolicy", "code-content", this.i18n.quickCode);
            toggle("aiPolicy", "ai-latex", this.i18n.quickAI);
            toggle("webPolicy", "web-math", this.i18n.quickWeb);
            toggle("mixedPolicy", "mixed", this.i18n.quickMixed);
            const hintsOn = this.settings.hintsEnabled !== false;
            menu.addItem({
                icon: hintsOn ? "iconSelect" : "iconClose",
                label: this.i18n.quickHints,
                click: () => {
                    this.settings.hintsEnabled = !hintsOn;
                    void saveSettingsToFile(this.settings);
                    setTimeout(() => this.showQuickMenu(), 60);
                },
            });
            menu.addSeparator();
            menu.addItem({
                icon: "iconMath",
                label: this.i18n.menuConvert,
                click: () => void this.runSelectionAction("fix"),
            });
            menu.addItem({
                icon: "iconMath",
                label: this.i18n.menuRevert,
                click: () => void this.runSelectionAction("revert"),
            });
            if (rect) {
                menu.open({x: Math.round(rect.right - 240), y: Math.round(rect.bottom + 8)});
            }
        } catch (e) {
            console.error("[paste-fixer] 顶栏菜单打开失败", e);
        }
    }

    /** 统一手动动作入口（命令/顶栏兜底用，右键走 context-menu 的 range 快照） */
    private async runSelectionAction(action: "fix" | "revert"): Promise<void> {
        const sel = getSelection();
        if (!sel || sel.rangeCount === 0) {
            showMessage(this.i18n.noSelection, 3000);
            return;
        }
        const range = sel.getRangeAt(0);
        const startEl = range.startContainer.nodeType === 1
            ? range.startContainer as HTMLElement
            : (range.startContainer.parentElement as HTMLElement | null);
        const blocks = Array.from(document.querySelectorAll(".protyle-wysiwyg [data-node-id]"))
            .filter((el) => range.intersectsNode(el) &&
                !(el.parentElement as HTMLElement | null)?.closest?.("[data-node-id]")) as HTMLElement[];
        const ctx: ManualContext = {
            range: range.cloneRange(),
            protyleElement: document.querySelector(".protyle:not(.fn__none) .protyle-wysiwyg") as HTMLElement | null,
            block: startEl?.closest?.("[data-node-id]") as HTMLElement | null,
            blocks,
            selectedText: range.toString(),
            interactionId: 0,
            protyle: null,
        };
        try {
            const key = await runManualAction(ctx, action, fixLatexText, convertMathToPlainText);
            showMessage(this.i18n[key] || key, 3000);
        } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            console.error("[paste-fixer] 手动动作失败", e);
            showMessage(this.i18n.fail + ": " + err, 5000, "error");
        }
    }

    onload() {
        void this.bootstrap();
    }

    /** 启动顺序：先加载设置，再注册菜单/设置面板/UI（避免顶栏第一次打开仍读默认值） */
    private async bootstrap(): Promise<void> {
        try {
            this.settings = await loadSettingsFromFile();
        } catch (e) {
            /* 加载失败用默认值 */
        }
        try {
            createSettingsPanel(this.i18n, this.settings, (s) => void saveSettingsToFile(s));
        } catch (e) {
            console.error("[paste-fixer] 设置面板注册失败", e);
        }
        const menuHandlers = createMenuHandlers({
            i18n: this.i18n,
            fixText: fixLatexText,
            convertToPlain: convertMathToPlainText,
            i18nGet: (key) => (this.i18n[key] as string | undefined) || key,
            showMessage,
        }, () => this.settings.hintsEnabled);
        this.menuHandlers = menuHandlers;

        // 通道 1：事件总线
        this.eventBus.on("paste", this.onPaste);
        this.eventBus.on("open-menu-content", menuHandlers.onOpenMenuContent as never);
        // 通道 2：DOM 原生 paste（捕获阶段，编辑器内才处理）
        document.addEventListener("paste", this.onDomPaste as EventListener, true);
        // 通道 3：右键菜单兜底（短窗注入，自动断开）
        document.addEventListener("contextmenu", menuHandlers.onContextMenu as EventListener, true);
        // 其余 UI 注册放最后，失败也不影响粘贴修复
        try {
            this.addCommand({
                langKey: "convertSelection",
                callback: () => void this.runSelectionAction("fix"),
            });
        } catch (e) {
            console.error("[paste-fixer] 命令注册失败", e);
        }
        try {
            this.topBarElement = this.addTopBar({
                icon: "iconMath",
                title: this.i18n.name,
                position: "right",
                callback: () => void this.showQuickMenu(),
            });
        } catch (e) {
            console.error("[paste-fixer] 顶栏按钮注册失败", e);
        }
        showMessage(this.i18n.name + " 已加载", 2000);
    }

    onunload() {
        document.removeEventListener("paste", this.onDomPaste as EventListener, true);
        if (this.menuHandlers) {
            document.removeEventListener("contextmenu", this.menuHandlers.onContextMenu as EventListener, true);
            this.menuHandlers.dispose();
        }
        this.eventBus.off("paste", this.onPaste);
        if (this.menuHandlers) {
            this.eventBus.off("open-menu-content", this.menuHandlers.onOpenMenuContent as never);
        }
    }
}
