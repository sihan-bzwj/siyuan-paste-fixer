/**
 * 思源 DOM/内部格式生成（v0.2.3 拆分自 index.ts）。
 *
 * 职责：把修复后的 Markdown 转成思源内部块 DOM 字符串（text/siyuan 载荷）。
 *
 * 安全边界（v0.2.3 重构）：
 * - 保护段（代码围栏/行内代码/链接目标/URL）**原样交给 Lute**，不再遮蔽成
 *   占位符再字符串还原——fence 里的 `<img …>` / `$$` 由 Lute 自己当成代码文本，
 *   不会重新变成真实 HTML 元素，也不会被误切成公式；
 * - 只在非保护段识别真正闭合的 `$$...$$` 块，手工生成公式块 DOM；
 * - 孤立/非公式美元仍用 maskLuteUnsafeDollars 遮蔽后交给 Lute，恢复只把
 *   占位符替换为单个 `$` 字符（无 HTML 注入面）。
 */

import {maskLuteUnsafeDollars, splitMarkdownSegments} from "./fix-latex";

/** Lute 实例的最小接口 */
export interface ILiteLute {
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
export function getLute(): ILiteLute | null {
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

function escapeAttr(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function newBlockId(lute: ILiteLute): string {
    if (typeof lute.NewNodeID === "function") {
        return lute.NewNodeID();
    }
    const globalLute = (window as unknown as {Lute?: {NewNodeID: () => string}}).Lute;
    return globalLute?.NewNodeID() ?? `${Date.now()}-pastefix`;
}

/** 手工生成真公式块 DOM（思源前端 Lute 只解析行内数学，$$ 块需显式 NodeMathBlock）。 */
function mathBlockDOM(latex: string, lute: ILiteLute): string {
    return `<div data-node-id="${newBlockId(lute)}" data-type="NodeMathBlock" class="render-node"` +
        ` data-content="${escapeAttr(latex)}" data-subtype="math"><div spin="1"></div></div>`;
}

/**
 * 把修复后的 Markdown 转成思源内部块 DOM。
 *
 * 以“非保护段中的 $$ 块”为切分边界：保护段（代码围栏/行内代码/链接目标/URL）
 * 与普通文本合流为 markdown 片段**原样一次交给 Lute**——Lute 自己正确解析
 * fence/链接（结构完整，属性由 Lute 转义），fence 里的 `<img …>`/`$$` 不会被
 * 当成公式或注入 HTML。
 *
 * 美元遮蔽（maskLuteUnsafeDollars）只用于防止 Lute 错配孤立/非公式 `$`，遮蔽
 * 符恢复时只还原为单个 `$` 字符（无 HTML 注入面），还原后文本与原文字面一致。
 */
export function mdToSiyuanHTML(md: string, lute: ILiteLute): string {
    const out: string[] = [];
    let run = "";
    const flushRun = (): void => {
        if (!run) {
            return;
        }
        const dollarMask = maskLuteUnsafeDollars(run);
        const html = lute.Md2BlockDOM(dollarMask.masked);
        if (html) {
            out.push(dollarMask.restore(html));
        }
        run = "";
    };
    for (const segment of splitMarkdownSegments(md)) {
        if (segment.protected) {
            run += segment.text; // 保护段与前后普通文本同批交给 Lute（保持链接/围栏结构）
            continue;
        }
        // 只在非保护段识别 $$ 块；保护段内的 $$ 是代码文本，不切分
        const parts = segment.text.split(/(\$\$[\s\S]+?\$\$)/g);
        for (const part of parts) {
            if (!part) {
                continue;
            }
            if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) {
                flushRun();
                out.push(mathBlockDOM(part.slice(2, -2).trim(), lute));
            } else {
                run += part;
            }
        }
    }
    flushRun();
    return out.join("");
}