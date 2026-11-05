/**
 * 「复制为 Markdown（含公式）」的纯函数部分（v0.3.0）。
 *
 * 内核 /api/block/getBlockKramdown 返回的是 kramdown：公式形态与 Markdown 一致
 * （$...$ / $$...），但每个块尾部会带 `{: id="..." updated="..."}` 属性块。
 * 复制给外部使用时这些属性只会碍事，这里按"整块属性块删除、行尾空白清掉"处理。
 */

/** 去掉 kramdown 的 `{: ...}` 属性块与行尾空白；公式定界符原样保留。 */
export function stripKramdownAttrs(text: string): string {
    return text
        .replace(/\{:[^{}]*\}/g, "")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/, ""))
        .join("\n");
}

/** 多个块的 kramdown 按空行拼接，去掉空块。 */
export function joinBlocks(blocks: Iterable<string>): string {
    const out: string[] = [];
    for (const block of blocks) {
        const text = stripKramdownAttrs(block).trim();
        if (text) {
            out.push(text);
        }
    }
    return out.join("\n\n");
}
