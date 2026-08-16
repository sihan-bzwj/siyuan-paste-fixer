import { Plugin, showMessage } from "siyuan";
import type { IEventBusMap, IMenu, IMenuBaseDetail } from "siyuan";
import { fixLatexText, looksLikeMath } from "./fix-latex";
import { hasMathML, convertMathMLInHTML } from "./mathml";

type PasteDetail = IEventBusMap["paste"];
type MenuContentDetail = IMenuBaseDetail & { range: Range };

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
 */
function mdToSiyuanHTML(md: string, lute: ILiteLute): string {
    const parts = md.split(/(\$\$[\s\S]+?\$\$)/g);
    const out: string[] = [];
    const newId = (): string => {
        // 优先用 Lute 实例的 NewNodeID，全局 Lute 类作为兜底
        if (typeof lute.NewNodeID === "function") {
            return lute.NewNodeID();
        }
        const globalLute = (window as unknown as {Lute?: {NewNodeID: () => string}}).Lute;
        return globalLute?.NewNodeID() ?? `${Date.now()}-pastefix`;
    };
    for (const part of parts) {
        if (!part.trim()) {
            continue;
        }
        if (part.startsWith("$$") && part.endsWith("$$")) {
            const latex = part.slice(2, -2).trim();
            const attr = latex.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
            out.push(`<div data-node-id="${newId()}" data-type="NodeMathBlock" class="render-node"` +
                ` data-content="${attr}" data-subtype="math"><div spin="1"></div></div>`);
        } else {
            out.push(lute.Md2BlockDOM(part));
        }
    }
    return out.join("");
}

async function postJSON(url: string, data: unknown): Promise<void> {
    await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
    });
}

/**
 * 双通道粘贴修复：
 * 1. 事件总线通道（官方 paste 事件）
 * 2. DOM 通道（document 捕获阶段原生 paste 事件，修复后重新派发，作为总线失效时的兜底）
 */
export default class PasteFixer extends Plugin {
    /** 把剪贴板载荷修复为 Markdown；无需修复时返回 null */
    private buildFixedMarkdown(textHTML: string, textPlain: string, siyuanHTML: string): string | null {
        // 内部复制且已含公式块 → 结构完整，不动
        if (siyuanHTML && /data-type="(?:NodeMathBlock|inline-math)"/.test(siyuanHTML)) {
            return null;
        }
        const mml = hasMathML(textHTML);
        if (!mml && !looksLikeMath(textPlain)) {
            return null;
        }
        let fixedPlain = fixLatexText(textPlain);
        let changed = fixedPlain !== textPlain;
        if (mml) {
            const result = convertMathMLInHTML(textHTML);
            if (result.count > 0) {
                fixedPlain = fixLatexText(result.text);
                changed = true;
            }
        }
        return changed ? fixedPlain : null;
    }

    /** 通道 1：官方事件总线 paste 事件 */
    private onPaste = (event: CustomEvent<PasteDetail>) => {
        const detail = event.detail;
        const resolve = detail.resolve as unknown as (value: unknown) => void;
        try {
            const textHTML = detail.textHTML || "";
            const textPlain = detail.textPlain || "";
            const siyuanHTML = detail.siyuanHTML || "";
            const files = detail.files;

            const fixed = this.buildFixedMarkdown(textHTML, textPlain, siyuanHTML);
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
                            resolve({textHTML: "", textPlain: plain, siyuanHTML: sy, files});
                            return;
                        }
                    }
                }
            }

            if (fixed === null) {
                resolve(detail);
                return;
            }

            const hasFiles = !!files && files.length > 0;
            const richHTML = /<(h[1-6]|li|ul|ol|table|img|pre|blockquote|strong|b|i|em|a)[\s>]/i.test(textHTML);
            if (!hasFiles && (!richHTML || hasMathML(textHTML))) {
                resolve({textHTML: "", textPlain: fixed, siyuanHTML: "", files});
                return;
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
            const fixed = this.buildFixedMarkdown(textHTML, textPlain, siyuanHTML);
            if (fixed === null) {
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

    /**
     * 手动转换：把选中文本修复后经内核 API 插入（内核 Lute 生成真公式块，不依赖前端包装类）。
     * 选区覆盖的块先删除，转换结果插回原位置。
     */
    private async convertSelection(): Promise<void> {
        try {
            const selection = getSelection();
            if (!selection || selection.rangeCount === 0) {
                showMessage(this.i18n.noSelection, 3000);
                return;
            }
            const range = selection.getRangeAt(0);
            const text = range.toString();
            if (!text.trim()) {
                showMessage(this.i18n.noSelection, 3000);
                return;
            }
            const fixed = fixLatexText(text);
            if (fixed === text) {
                showMessage(this.i18n.noChange, 3000);
                return;
            }
            // 选区覆盖的顶层块
            const blocks = Array.from(document.querySelectorAll(".protyle-wysiwyg [data-node-id]"))
                .filter((el) => range.intersectsNode(el) && !(el.parentElement as HTMLElement | null)?.closest?.("[data-node-id]")) as HTMLElement[];
            if (blocks.length === 0) {
                showMessage(this.i18n.noSelection, 3000);
                return;
            }
            const first = blocks[0];
            const prev = first.previousElementSibling as HTMLElement | null;
            const previousID = prev?.getAttribute("data-node-id") || "";
            const parentID = first.closest(".protyle-wysiwyg")?.getAttribute("data-doc-id") || "";
            for (const b of blocks) {
                await postJSON("/api/block/deleteBlock", {id: b.getAttribute("data-node-id")});
            }
            const payload: Record<string, string> = {dataType: "markdown", data: fixed};
            if (previousID) {
                payload.previousID = previousID;
            } else if (parentID) {
                payload.parentID = parentID;
            }
            await postJSON("/api/block/insertBlock", payload);
            showMessage(this.i18n.done, 3000);
        } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            console.error("[paste-fixer] 手动转换失败", e);
            showMessage(this.i18n.fail + ": " + err, 5000, "error");
        }
    }

    /** 右键菜单：选中文本含数学信号时提供"修复为公式" */
    private onOpenMenuContent = (event: CustomEvent<MenuContentDetail>) => {
        try {
            const { menu, range } = event.detail;
            if (!range || range.collapsed) {
                return;
            }
            if (!looksLikeMath(range.toString())) {
                return;
            }
            menu.addItem({
                icon: "iconMath",
                label: this.i18n.menuConvert,
                click: () => void this.convertSelection(),
            });
        } catch (e) {
            console.error("[paste-fixer] 菜单注册失败", e);
        }
    };

    onload() {
        // 通道 1：事件总线
        this.eventBus.on("paste", this.onPaste);
        this.eventBus.on("open-menu-content", this.onOpenMenuContent);
        // 通道 2：DOM 原生 paste（捕获阶段，编辑器内才处理）
        document.addEventListener("paste", this.onDomPaste as EventListener, true);
        // 其余 UI 注册放最后，失败也不影响粘贴修复
        try {
            this.addCommand({
                langKey: "convertSelection",
                callback: () => void this.convertSelection(),
            });
        } catch (e) {
            console.error("[paste-fixer] 命令注册失败", e);
        }
        try {
            this.addTopBar({
                icon: "iconMath",
                title: this.i18n.name,
                callback: () => void this.convertSelection(),
            });
        } catch (e) {
            console.error("[paste-fixer] 顶栏按钮注册失败", e);
        }
        showMessage(this.i18n.name + " 已加载", 2000);
    }

    onunload() {
        document.removeEventListener("paste", this.onDomPaste as EventListener, true);
        this.eventBus.off("paste", this.onPaste);
        this.eventBus.off("open-menu-content", this.onOpenMenuContent);
    }
}
