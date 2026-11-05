/**
 * 粘贴诊断记录（v0.3.0）。
 *
 * 坏例反馈一直靠人肉重建剪贴板内容。这里把最近一次粘贴的原始文本/HTML、场景
 * 判定、来源裁决、耗时打包成 JSON，由命令导出到工作空间，用户直接拖文件过来
 * 就是一份可复现的样本。纯函数，不碰思源 API，便于无头测试。
 */

/** 单次粘贴处理耗时预算：超过只记一条 console.warn，不改变行为。 */
export const PERF_BUDGET_MS = 150;

/** 剪贴板原文落盘上限（字符）：够复现，又不会把整页维基塞进诊断包。 */
export const MAX_CLIPBOARD_CHARS = 20000;

export interface PasteDiagnosticMeta {
    scenario: string;
    action: string;
    source: string;
    quality: string;
    formulas: number;
}

export interface PasteDiagnostic extends PasteDiagnosticMeta {
    time: string;
    pluginVersion: string;
    durationMs: number;
    overBudget: boolean;
    textPlain: string;
    textHTML: string;
    siyuanHTMLSize: number;
}

function clampText(text: string): string {
    if (text.length <= MAX_CLIPBOARD_CHARS) {
        return text;
    }
    return text.slice(0, MAX_CLIPBOARD_CHARS) + "\n…（截断，原文 " + text.length + " 字符）";
}

export function buildDiagnostic(input: {
    meta: PasteDiagnosticMeta,
    durationMs: number,
    pluginVersion: string,
    textPlain: string,
    textHTML: string,
    siyuanHTML: string,
    now?: Date,
}): PasteDiagnostic {
    const now = input.now ?? new Date();
    const durationMs = Math.round(input.durationMs * 10) / 10;
    return {
        time: now.toISOString(),
        pluginVersion: input.pluginVersion,
        scenario: input.meta.scenario,
        action: input.meta.action,
        source: input.meta.source,
        quality: input.meta.quality,
        formulas: input.meta.formulas,
        durationMs,
        overBudget: durationMs > PERF_BUDGET_MS,
        textPlain: clampText(input.textPlain),
        textHTML: clampText(input.textHTML),
        siyuanHTMLSize: input.siyuanHTML.length,
    };
}

function pad(value: number): string {
    return value < 10 ? "0" + value : String(value);
}

/** 诊断文件名：paste-diag-YYYYMMDD-HHmmss.json（工作空间 /data 下，便于用户找）。 */
export function diagnosticFileName(now: Date): string {
    const date = String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate());
    const time = pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    return "paste-diag-" + date + "-" + time + ".json";
}

export function formatDiagnostic(record: PasteDiagnostic): string {
    return JSON.stringify(record, null, 2);
}
