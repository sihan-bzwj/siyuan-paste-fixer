/**
 * 管理一次粘贴的异步兜底任务。
 * 原生事件只拍摄块 ID 快照；事件总线确认策略允许后，才开始检查坏公式。
 * 每次新粘贴/卸载都会取消旧任务，旧异步请求返回后也不能继续处理下一块。
 */
import {fixLatexText} from "./fix-latex";
import {PasteScenario} from "./scenario";
import {applyMathRepairs, collectMathRepairs, collectPasteTargetBlocks} from "./post-paste-repair";
import {elementOf} from "./siyuan-dom";

const DELAYS = [0, 200, 500, 1000, 2000];

export interface PostPasteScope {
    editor: HTMLElement;
    ids: Set<string>;
    /** 固定本次粘贴的光标块，后续移动光标不会把别的旧块纳入范围。 */
    caretId: string | null;
}

/** 只读快照：在宿主插入内容前记录本次编辑器和光标所在块。 */
export function capturePostPasteScope(editor: HTMLElement): PostPasteScope {
    const selection = window.getSelection();
    const caret = selection?.rangeCount ? elementOf(selection.getRangeAt(0).startContainer) : null;
    const block = caret?.closest("[data-node-id]");
    return {
        editor,
        ids: new Set(Array.from(editor.querySelectorAll("[data-node-id]"), el => el.getAttribute("data-node-id") || "").filter(Boolean)),
        caretId: block && editor.contains(block) ? block.getAttribute("data-node-id") : null,
    };
}

export class PostPasteRepairTask {
    private timer: number | null = null;
    /** 递增编号使已进入异步函数的旧任务失效，不只取消尚未触发的定时器。 */
    private generation = 0;

    constructor(
        private readonly allowed: (scenario: PasteScenario) => boolean,
        private readonly onFixed: (count: number) => void,
    ) {}

    cancel(): void {
        this.generation++;
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }

    start(scope: PostPasteScope, scenario: PasteScenario): void {
        this.cancel();
        const generation = this.generation;
        const current = (): boolean => generation === this.generation && scope.editor.isConnected && this.allowed(scenario);
        const schedule = (attempt: number): void => {
            if (!current() || attempt >= DELAYS.length) return;
            this.timer = window.setTimeout(() => {
                this.timer = null;
                void run(attempt);
            }, DELAYS[attempt]);
        };
        const run = async (attempt: number): Promise<void> => {
            if (!current()) return;
            try {
                const candidates = collectMathRepairs(collectPasteTargetBlocks(scope.editor, scope.ids, scope.caretId), fixLatexText);
                if (candidates.length === 0) {
                    schedule(attempt + 1);
                    return;
                }
                // 每个块写回之前再次确认策略及任务编号；中途关闭/卸载立即停止下一块。
                const count = await applyMathRepairs(candidates, {shouldApply: current});
                if (count > 0 && current()) this.onFixed(count);
            } catch (error) {
                console.error("[paste-fixer] 粘贴后兜底修复失败", error);
            }
        };
        schedule(0);
    }
}
