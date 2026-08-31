// v0.2.3 手动转换动作层专项测试（src/manual-action.ts）
// 覆盖审查要求的核心安全点：局部全量 Fragment、fix/revert 分流、rich 块保护、
// 跨块拒绝、updateBlock 保 ID、编辑器从 range 推导。
const path = require("path");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(cond, name, detail = "") {
    if (cond) {
        passed++;
        console.log("  ✓", name);
    } else {
        failed++;
        console.error("  ✗", name, detail ? "\n    " + detail : "");
    }
}

/** 与 index.ts 相同的还原实现（测试内联，避免建 Plugin 实例） */
function convertToPlain(text) {
    return text
        .replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner) => inner.trim())
        .replace(/\$([^$\n\u0001\u0002]+?)\$/g, (_m, inner) => {
            const core = inner.trim();
            return /^\{.*\}$/.test(core) ? core.slice(1, -1) : core;
        });
}

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_fix-latex.cjs"), logLevel: "silent",
    });
    await esbuild.build({
        entryPoints: [path.join(root, "src/manual-action.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_manual-action.cjs"), logLevel: "silent",
    });
    const { fixLatexText } = require("./_fix-latex.cjs");
    const M = require("./_manual-action.cjs");

    const dom = new JSDOM("<!DOCTYPE html><body></body>", {url: "http://localhost/"});
    global.document = dom.window.document;
    global.window = dom.window;
    global.NodeFilter = dom.window.NodeFilter;
    global.InputEvent = dom.window.InputEvent;
    global.getSelection = () => dom.window.getSelection();

    const mkEditor = () => {
        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        editor.setAttribute("data-doc-id", "doc1");
        document.body.appendChild(editor);
        return editor;
    };
    const mkBlock = (editor, id, html) => {
        const div = document.createElement("div");
        div.setAttribute("data-node-id", id);
        div.setAttribute("data-type", "NodeParagraph");
        div.innerHTML = html;
        editor.appendChild(div);
        return div;
    };
    const selectRange = (block, start, end) => {
        const range = document.createRange();
        range.setStart(block.firstChild, start);
        range.setEnd(block.firstChild, end);
        return range;
    };
    const domeHtml = (block) => block.innerHTML;

    console.log("== 1. 局部修复：全量 Fragment（正文与全部公式保留） ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b1", "A \\(x\\) B \\(y\\) C");
        const ctx = M.captureManualContext(selectRange(block, 2, 17), null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "done", "A \\(x\\) B \\(y\\) C 局部修复返回 done", key);
        const children = block.childNodes;
        assert(children.length === 5, "片段=5 个节点（文本+公式+文本+公式+文本）", `实际 ${children.length}`);
        assert(children[0].textContent === "A ", "前方正文 A 保留", children[0].textContent);
        assert(children[1].dataset && children[1].getAttribute("data-content") === "x", "公式 x 转 inline-math", domeHtml(block));
        assert(children[2].textContent === " B ", "中间正文 B 保留");
        assert(children[3].getAttribute("data-content") === "y", "公式 y 转 inline-math");
        assert(children[4].textContent === " C", "后方正文 C 保留");
        document.body.innerHTML = "";
    }

    console.log("== 2. 完整单块：updateBlock 保 ID ==");
    {
        let updateCalls = [];
        global.fetch = async (url, opts) => {
            if (String(url).includes("updateBlock")) {
                updateCalls.push(JSON.parse(opts.body));
            }
            return {ok: true, json: async () => ({code: 0})};
        };
        const editor = mkEditor();
        const block = mkBlock(editor, "b9", "公式 \\[E=mc^2\\]");
        const ctx = M.captureManualContext(selectRange(block, 0, block.firstChild.length), null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "done", "整块修复返回 done", key);
        assert(updateCalls.length === 1 && updateCalls[0].id === "b9", "updateBlock 目标 id=b9", JSON.stringify(updateCalls));
        assert(updateCalls[0].data.includes("$$") && updateCalls[0].data.includes("E=mc^2"), "整块内容转 $$", updateCalls[0].data);
        document.body.innerHTML = "";
    }

    console.log("== 3. 完整块含复杂格式：拒绝，不静默丢格式 ==");
    {
        let updateCalls = [];
        global.fetch = async (url, opts) => {
            if (String(url).includes("updateBlock")) updateCalls.push(1);
            return {ok: true, json: async () => ({code: 0})};
        };
        const editor = mkEditor();
        const block = mkBlock(editor, "b3", "重要 <strong>内容</strong> 公式 \\(x\\)");
        const range = document.createRange();
        range.setStart(block.firstChild, 0);
        range.setEnd(block.lastChild, block.lastChild.length);
        const ctx = M.captureManualContext(range, null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "blockRichRefuse", "rich 整块拒绝（blockRichRefuse）", key);
        assert(updateCalls.length === 0, "未触发 updateBlock");
        assert(domeHtml(block).includes("<strong>"), "DOM 原样未动");
        document.body.innerHTML = "";
    }

    console.log("== 4. 跨块（含列表项）：拒绝 ==");
    {
        let updateCalls = [];
        global.fetch = async () => ({ok: true, json: async () => ({code: 0})});
        const editor = mkEditor();
        const b1 = mkBlock(editor, "b1", "段落一");
        const b2 = mkBlock(editor, "b2", "段落二");
        const range = document.createRange();
        range.setStart(b1.firstChild, 0);
        range.setEnd(b2.firstChild, 3);
        const ctx = M.captureManualContext(range, null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "crossBlockRefuse", "跨两段落拒绝", key);
        assert(updateCalls.length === 0, "未触发 updateBlock");
        document.body.innerHTML = "";
    }

    console.log("== 5. 光标在已有公式：fix 不动作 / revert 还原 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b5", 'A <span data-type="inline-math" data-subtype="math" data-content="x_i"></span> B');
        const span = block.querySelector('[data-type="inline-math"]');
        const range = document.createRange();
        range.setStart(span, 0);
        range.collapse(true);
        const ctx = M.captureManualContext(range, null);
        const fixKey = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(fixKey === "noChange", "已有公式 + fix → noChange", fixKey);
        assert(block.querySelector('[data-type="inline-math"]') !== null, "点击修复按钮不会反向还原");
        const revertKey = await M.runManualAction(ctx, "revert", fixLatexText, convertToPlain);
        assert(revertKey === "revertDone", "已有公式 + revert → revertDone", revertKey);
        assert(block.querySelector('[data-type="inline-math"]') === null, "公式已还原为纯文本");
        assert(block.textContent.includes("x_i") && block.textContent.includes("A ") && block.textContent.includes(" B"), "还原只去掉定界符", block.textContent);
        document.body.innerHTML = "";
    }

    console.log("== 6. 光标在普通文字：提示选择 ==");
    {
        const dom2 = new JSDOM("<!DOCTYPE html><body></body>", {url: "http://localhost/"});
        global.document = dom2.window.document;
        global.window = dom2.window;
        global.NodeFilter = dom2.window.NodeFilter;
        global.InputEvent = dom2.window.InputEvent;
        global.getSelection = () => dom2.window.getSelection();
        const editor = mkEditor();
        const block = mkBlock(editor, "b6", "普通文本");
        const range = document.createRange();
        range.setStart(block.firstChild, 1);
        range.collapse(true);
        const ctx = M.captureManualContext(range, null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "noSelection", "光标普通文本 → noSelection", key);
        document.body.innerHTML = "";
    }

    console.log("== 7. 局部选中含 $$：提示选完整段 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b7", "A \\(x\\) $$y$$ B");
        const ctx = M.captureManualContext(selectRange(block, 0, 13), null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "blockNeedsWholeBlock", "局部结果含 $$ → blockNeedsWholeBlock", key);
        assert(domeHtml(block).includes("\\("), "DOM 原样未动");
        document.body.innerHTML = "";
    }

    console.log("== 8. 局部还原：正文保留 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b8", "A $x$ B");
        const ctx = M.captureManualContext(selectRange(block, 0, 5), null);
        const key = await M.runManualAction(ctx, "revert", fixLatexText, convertToPlain);
        assert(key === "revertDone", "局部还原返回 revertDone", key);
        assert(block.textContent === "A x B", "还原后正文完整", block.textContent);
        document.body.innerHTML = "";
    }

    console.log("== 9. 分屏：编辑器必须从 range 推导 ==");
    {
        const editor1 = mkEditor();
        const editor2 = mkEditor();
        const block = mkBlock(editor2, "b9", 'A <span data-type="inline-math" data-subtype="math" data-content="x_i"></span> B');
        const span = block.querySelector('[data-type="inline-math"]');
        const range = document.createRange();
        range.setStart(span, 0);
        range.collapse(true);
        const ctx = M.captureManualContext(range, null);
        assert(ctx.protyleElement === editor2, "protyleElement 从 range 推导为第二个编辑器", ctx.protyleElement && ctx.protyleElement.className);
        let editor1Events = 0;
        let editor2Events = 0;
        editor1.dispatchEvent = () => { editor1Events++; return true; };
        editor2.dispatchEvent = () => { editor2Events++; return true; };
        await M.runManualAction(ctx, "revert", fixLatexText, convertToPlain);
        assert(editor2Events > 0, "input 事务发给右编辑器（2 次：含同步调用）", String(editor2Events));
        assert(editor1Events === 0, "左编辑器未收到 input");
        document.body.innerHTML = "";
    }

    console.log("== 10. 整块公式块还原：updateBlock ==");
    {
        let updateCalls = [];
        global.fetch = async (url, opts) => {
            if (String(url).includes("updateBlock")) updateCalls.push(JSON.parse(opts.body));
            return {ok: true, json: async () => ({code: 0})};
        };
        const editor = mkEditor();
        const mathBlock = document.createElement("div");
        mathBlock.setAttribute("data-node-id", "mb1");
        mathBlock.setAttribute("data-type", "NodeMathBlock");
        mathBlock.setAttribute("data-content", "E=mc^2");
        editor.appendChild(mathBlock);
        const range = document.createRange();
        range.setStart(mathBlock, 0);
        range.setEnd(mathBlock, mathBlock.childNodes.length);
        const ctx = M.captureManualContext(range, null);
        const fixKey = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(fixKey === "noChange", "公式块 + fix → noChange", fixKey);
        const revertKey = await M.runManualAction(ctx, "revert", fixLatexText, convertToPlain);
        assert(revertKey === "revertDone", "公式块 + revert → revertDone", revertKey);
        assert(updateCalls.length === 1 && updateCalls[0].id === "mb1" && updateCalls[0].data === "E=mc^2", "还原以原块 id 走 updateBlock", JSON.stringify(updateCalls));
        document.body.innerHTML = "";
    }

    console.log(`\n手动转换测试: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });