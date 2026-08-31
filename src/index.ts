import { Plugin, showMessage } from "siyuan";
import type { IEventBusMap, IMenu, IMenuBaseDetail } from "siyuan";
import {
    fixLatexText,
    looksLikeMath,
    maskLuteUnsafeDollars,
    maskProtectedSegments,
} from "./fix-latex";
import {selectClipboardMarkdown} from "./clipboard";
import {countMathFormulas, DEFAULT_POLICY, detectPasteScenario, PasteScenario, ScenarioPolicy} from "./scenario";
import {hasMathML} from "./mathml";

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

async function postJSON(url: string, data: unknown): Promise<void> {
    await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
    });
}

/**
 * 把标准公式形态还原为纯文本（右键"还原为纯文本"）：
 * - $$...$$ 块 → 内容本身
 * - $...$ 行内 → 内容本身（数字打头的包装花括号 {0<x\le1} 一并还原）
 * 其余内容逐字保留。不做任何 LaTeX 语义解释，仅在已知形态上做保守逆变换。
 */
function convertMathToPlainText(text: string): string {
    return text
        .replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => inner.trim())
        .replace(/\$([^$\n\u0001\u0002]+?)\$/g, (_m, inner: string) => {
            const core = inner.trim();
            return /^\{.*\}$/.test(core) ? core.slice(1, -1) : core;
        });
}

/**
 * 把单个块序列化为源 Markdown（渲染公式节点 → $...$ / $$...$$ 源码形态）：
 * 渲染后的公式 span 没有文本内容，selection.toString() 拿不到定界符，
 * 反向转换必须先从 DOM 还原源码。非公式内容取纯文本。不做语义解释。
 */
function blockToMarkdown(block: HTMLElement): string {
    if (block.getAttribute("data-type") === "NodeMathBlock") {
        return "$$\n" + (block.getAttribute("data-content") || "") + "\n$$";
    }
    const clone = block.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-type="NodeMathBlock"]').forEach((n) => n.remove());
    clone.querySelectorAll('[data-type="inline-math"]').forEach((m) => {
        const t = document.createElement("span");
        t.textContent = "$" + (m as HTMLElement).getAttribute("data-content") + "$";
        m.replaceWith(t);
    });
    return (clone.textContent || "").trim();
}

/** 选区覆盖的顶层块 → Markdown（含公式源码形态） */
function selectionToMarkdown(range: Range): string {
    const blocks = Array.from(document.querySelectorAll(".protyle-wysiwyg [data-node-id]"))
        .filter((el) => range.intersectsNode(el) &&
            !(el.parentElement as HTMLElement | null)?.closest?.("[data-node-id]")) as HTMLElement[];
    return blocks.map(blockToMarkdown).join("\n\n");
}

/**
 * 双通道粘贴修复：
 * 1. 事件总线通道（官方 paste 事件）
 * 2. DOM 通道（document 捕获阶段原生 paste 事件，修复后重新派发，作为总线失效时的兜底）
 */
export default class PasteFixer extends Plugin {
    /** 运行时设置（petal 文件持久化；不依赖 SDK 基类的 this.data 加载机制） */
    private settings: Record<string, unknown> = {};

    private async loadSettings(): Promise<void> {
        try {
            const r = await fetch("/api/file/getFile", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({path: "/data/storage/petal/paste-fixer/data.json"}),
            });
            if (!r.ok) {
                return;
            }
            const txt = await r.text();
            if (txt && txt.trim()) {
                this.settings = JSON.parse(txt) as Record<string, unknown>;
            }
        } catch (e) {
            /* 读取失败使用默认值 */
        }
    }

    private async saveSettings(): Promise<void> {
        try {
            const blob = new Blob([JSON.stringify(this.settings)], {type: "application/json"});
            const fd = new FormData();
            fd.append("file", blob, "data.json");
            fd.append("path", "/data/storage/petal/paste-fixer/data.json");
            fd.append("isDir", "false");
            await fetch("/api/file/putFile", {method: "POST", body: fd});
        } catch (e) {
            /* 持久化失败不影响本次会话行为 */
        }
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

    /**
     * 把选中文本经内核 API 替换为新内容（删除选区覆盖的块 → 插入 markdown）。
     * 转换结果插回原位置；直接调用方负责判定是否真的需要替换。
     */
    private async replaceSelectionWith(text: string, doneKey: string, noChangeKey: string): Promise<boolean> {
        let replaced = false;
        try {
            const selection = getSelection();
            if (!selection || selection.rangeCount === 0) {
                showMessage(this.i18n.noSelection, 3000);
                return false;
            }
            const range = selection.getRangeAt(0);
            const blocks = Array.from(document.querySelectorAll(".protyle-wysiwyg [data-node-id]"))
                .filter((el) => range.intersectsNode(el) && !(el.parentElement as HTMLElement | null)?.closest?.("[data-node-id]")) as HTMLElement[];
            if (blocks.length === 0) {
                showMessage(this.i18n.noSelection, 3000);
                return false;
            }
            const first = blocks[0];
            const prev = first.previousElementSibling as HTMLElement | null;
            const previousID = prev?.getAttribute("data-node-id") || "";
            const parentID = first.closest(".protyle-wysiwyg")?.getAttribute("data-doc-id") || "";
            for (const b of blocks) {
                await postJSON("/api/block/deleteBlock", {id: b.getAttribute("data-node-id")});
            }
            const payload: Record<string, string> = {dataType: "markdown", data: text};
            if (previousID) {
                payload.previousID = previousID;
            } else if (parentID) {
                payload.parentID = parentID;
            }
            await postJSON("/api/block/insertBlock", payload);
            replaced = true;
            showMessage(this.i18n[doneKey] || this.i18n.done, 3000);
        } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            console.error("[paste-fixer] 选区替换失败", e);
            showMessage(this.i18n.fail + ": " + err, 5000, "error");
        }
        return replaced;
    }

    /**
     * 手动转换：把选中文本修复后经内核 API 插入（内核 Lute 生成真公式块，不依赖前端包装类）。
     */
    private async convertSelection(): Promise<void> {
        const selection = getSelection();
        if (!selection || selection.rangeCount === 0) {
            showMessage(this.i18n.noSelection, 3000);
            return;
        }
        const text = selection.getRangeAt(0).toString();
        if (!text.trim()) {
            showMessage(this.i18n.noSelection, 3000);
            return;
        }
        const fixed = fixLatexText(text);
        if (fixed === text) {
            showMessage(this.i18n.noChange, 3000);
            return;
        }
        await this.replaceSelectionWith(fixed, "done", "noChange");
    }

    /**
 * 反向转换：把选中的标准公式形态还原为纯文本（$$...$$ 与 $...$ 去定界符，
 * 数字打头公式的包装花括号一并还原）。其他内容逐字保留。
 * 选区覆盖渲染后的公式节点时（无文本内容），先从 DOM 序列化出源码形态再还原。
 */
    private async revertSelection(): Promise<void> {
        const selection = getSelection();
        if (!selection || selection.rangeCount === 0) {
            showMessage(this.i18n.noSelection, 3000);
            return;
        }
        const range = selection.getRangeAt(0);
        const text = range.toString();
        // 渲染公式没有文本内容：若选区与公式节点相交，改用 DOM 序列化源码
        const intersectsMath = Array.from(document.querySelectorAll(
            '.protyle-wysiwyg [data-type="inline-math"], .protyle-wysiwyg [data-type="NodeMathBlock"]'),
        ).some((el) => range.intersectsNode(el));
        const source = (intersectsMath ? selectionToMarkdown(range) : text).trim();
        if (!source) {
            showMessage(this.i18n.noSelection, 3000);
            return;
        }
        const reverted = convertMathToPlainText(source);
        if (reverted === source) {
            showMessage(this.i18n.noChange, 3000);
            return;
        }
        await this.replaceSelectionWith(reverted, "revertDone", "noChange");
    }

    /** 场景 → 生效策略（设置可覆盖默认值） */
    private scenarioPolicy(scenario: PasteScenario): ScenarioPolicy {
        const s = this.settings as Record<string, ScenarioPolicy>;
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

    /** 右键菜单：选区/点击位置含数学信号时提供"修复为公式"与"还原为纯文本" */
    private onOpenMenuContent = (event: CustomEvent<MenuContentDetail>) => {
        try {
            const { menu, range } = event.detail;
            // 思源传给插件的是点击处光标 range（collapsed），即使已选中文本也可能 collapsed；
            // 只要求存在 range，不再因 collapsed 退出菜单。
            if (!menu || !range) {
                return;
            }
            const text = range.toString();
            // 渲染后的公式 span 没有文本内容，range.toString() 不含 $；
            // 选区与公式节点相交、或点击位置所在块含公式节点，都算命中。
            const startEl = range.startContainer.nodeType === 1
                ? range.startContainer as Element
                : (range.startContainer.parentElement as Element | null);
            const block = startEl?.closest?.("[data-node-id]") as HTMLElement | null;
            const intersectsMath = Array.from(document.querySelectorAll(
                '.protyle-wysiwyg [data-type="inline-math"], .protyle-wysiwyg [data-type="NodeMathBlock"]'),
            ).some((el) => range.intersectsNode(el));
            const blockHasMath = !!block &&
                block.querySelector('[data-type="inline-math"], [data-type="NodeMathBlock"]') !== null;
            if (!looksLikeMath(text) && !intersectsMath && !blockHasMath) {
                return;
            }
            menu.addItem({
                icon: "iconMath",
                label: this.i18n.menuConvert,
                click: () => void this.convertSelection(),
            });
            menu.addItem({
                icon: "iconMath",
                label: this.i18n.menuRevert,
                click: () => void this.revertSelection(),
            });
        } catch (e) {
            console.error("[paste-fixer] 菜单注册失败", e);
        }
    };

    /** 场景策略下拉选项 */
    private policyOptions(): Array<{text: string, value: string}> {
        return [
            {text: this.i18n.settingSmart, value: "smart"},
            {text: this.i18n.settingFix, value: "fix"},
            {text: this.i18n.settingPass, value: "pass"},
        ];
    }

    /** 策略下拉元素：变更即时落盘 */
    private buildPolicySelect(key: string, value: string): HTMLElement {
        const select = document.createElement("select");
        select.className = "b3-select";
        for (const opt of this.policyOptions()) {
            const o = document.createElement("option");
            o.value = opt.value;
            o.textContent = opt.text;
            o.selected = opt.value === value;
            select.appendChild(o);
        }
        select.addEventListener("change", () => {
            this.settings[key] = select.value;
            void this.saveSettings();
        });
        return select;
    }

    /** 提示开关元素：变更即时落盘 */
    private buildHintsCheckbox(): HTMLElement {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "b3-switch";
        box.checked = this.settings.hintsEnabled !== false;
        box.addEventListener("change", () => {
            this.settings.hintsEnabled = box.checked;
            void this.saveSettings();
        });
        return box;
    }

    /** 设置面板：各场景策略 + 场景提示开关（3.x 的 Setting 面板 API）。失败不影响粘贴修复。 */
    private setupSettings(): void {
        try {
            const setting = this.setting;
            setting.addItem({
                title: this.i18n.settingCodeTitle,
                description: this.i18n.settingCodeDesc,
                direction: "row",
                createActionElement: () => this.buildPolicySelect("codePolicy", this.scenarioPolicy("code-content")),
            });
            setting.addItem({
                title: this.i18n.settingAITitle,
                description: this.i18n.settingAIDesc,
                direction: "row",
                createActionElement: () => this.buildPolicySelect("aiPolicy", this.scenarioPolicy("ai-latex")),
            });
            setting.addItem({
                title: this.i18n.settingWebTitle,
                description: this.i18n.settingWebDesc,
                direction: "row",
                createActionElement: () => this.buildPolicySelect("webPolicy", this.scenarioPolicy("web-math")),
            });
            setting.addItem({
                title: this.i18n.settingMixedTitle,
                description: this.i18n.settingMixedDesc,
                direction: "row",
                createActionElement: () => this.buildPolicySelect("mixedPolicy", this.scenarioPolicy("mixed")),
            });
            setting.addItem({
                title: this.i18n.settingHints,
                description: this.i18n.settingHintsDesc,
                direction: "row",
                createActionElement: () => this.buildHintsCheckbox(),
            });
        } catch (e) {
            console.error("[paste-fixer] 设置面板注册失败", e);
        }
        // 异步加载已持久化的设置（加载完成前使用默认值）
        void this.loadSettings();
    }

    onload() {
        // 通道 1：事件总线
        this.eventBus.on("paste", this.onPaste);
        this.eventBus.on("open-menu-content", this.onOpenMenuContent);
        // 通道 2：DOM 原生 paste（捕获阶段，编辑器内才处理）
        document.addEventListener("paste", this.onDomPaste as EventListener, true);
        // 设置面板与场景提示
        this.setupSettings();
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
