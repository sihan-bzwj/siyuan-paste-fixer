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

/** 与生产路径一致的还原（main 内注入 convertMathToPlainText，见下） */
let convertToPlain = (text) => text;

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
    const { convertMathToPlainText, fixLatexText } = require("./_fix-latex.cjs");
    convertToPlain = convertMathToPlainText;
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

    console.log("== 4. 跨块：逐块批处理（保留各自 block ID） ==");
    {
        let updateCalls = [];
        global.fetch = async (url, opts) => {
            if (String(url).includes("updateBlock")) updateCalls.push(JSON.parse(opts.body));
            return {ok: true, json: async () => ({code: 0})};
        };
        const editor = mkEditor();
        const b1 = mkBlock(editor, "b1", "段落一");
        const b2 = mkBlock(editor, "b2", "段落二");
        const range = document.createRange();
        range.setStart(b1.firstChild, 0);
        range.setEnd(b2.firstChild, 3);
        const ctx = M.captureManualContext(range, null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "crossBlockRefuse", "跨块拒绝（v0.2.5 撤回批处理：部分选择/Heading 语义风险）", key);
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
        assert(fixKey === "alreadyMath", "光标在公式 + 强制转换 → alreadyMath", fixKey);
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
        assert(fixKey === "alreadyMath", "公式块 + 强制转换 → alreadyMath", fixKey);
        const revertKey = await M.runManualAction(ctx, "revert", fixLatexText, convertToPlain);
        assert(revertKey === "revertDone", "公式块 + revert → revertDone", revertKey);
        assert(updateCalls.length === 1 && updateCalls[0].id === "mb1" && updateCalls[0].data === "E=mc^2", "还原以原块 id 走 updateBlock", JSON.stringify(updateCalls));
        document.body.innerHTML = "";
    }

    console.log("== 11. 块首/块尾公式：只选正文不判 whole-block（公式不被覆盖） ==");
    {
        const editor = mkEditor();
        const blockA = mkBlock(editor, "bA", '<span data-type="inline-math" data-subtype="math" data-content="x"></span> 后文');
        const rangeA = document.createRange();
        rangeA.setStart(blockA.lastChild, 0);
        rangeA.setEnd(blockA.lastChild, 2); // 只选“后文”二字
        let updateCalls = 0;
        global.fetch = async () => { updateCalls++; return {ok: true, json: async () => ({code: 0})}; };
        const ctxA = M.captureManualContext(rangeA, null);
        const keyA = await M.runManualAction(ctxA, "fix", fixLatexText, convertToPlain);
        assert(keyA !== "blockRichRefuse" && keyA !== undefined, "块首有公式时选正文不触发整块路径", keyA);
        assert(updateCalls === 0, "未走 updateBlock（公式仍在前方）", String(updateCalls));
        assert(blockA.querySelector('[data-type="inline-math"]') !== null, "块首公式保留", domeHtml(blockA));

        const blockB = mkBlock(editor, "bB", '前文 <span data-type="inline-math" data-subtype="math" data-content="y"></span>');
        const rangeB = document.createRange();
        rangeB.setStart(blockB.firstChild, 0);
        rangeB.setEnd(blockB.firstChild, 2); // 只选“前文”二字
        updateCalls = 0;
        const ctxB = M.captureManualContext(rangeB, null);
        await M.runManualAction(ctxB, "fix", fixLatexText, convertToPlain);
        assert(updateCalls === 0, "块尾公式时也未走 updateBlock", String(updateCalls));
        assert(blockB.querySelector('[data-type="inline-math"]') !== null, "块尾公式保留", domeHtml(blockB));
        document.body.innerHTML = "";
    }

    console.log("== 12. 局部选区空格保留（不再 trim） ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "bC", "A \\(x\\) B");
        // 只选 " \\(x\\) "（含两侧空格，偏移 1..8）
        const range = document.createRange();
        range.setStart(block.firstChild, 1);
        range.setEnd(block.firstChild, 8);
        const ctx = M.captureManualContext(range, null);
        await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        const span = block.querySelector('[data-type="inline-math"]');
        const joined = Array.from(block.childNodes)
            .filter((n) => n.nodeType === 3 && n.textContent)
            .map((n) => n.textContent)
            .join("");
        assert(span !== null && span.getAttribute("data-content") === "x", "公式 x 正确转换", domeHtml(block));
        assert(joined === "A  B", "选中区内侧空格保留（两侧各一个空格仍存在）", JSON.stringify(joined));
        document.body.innerHTML = "";
    }

    console.log("== 13. 未识别富格式元素（fail-closed 白名单） ==");
    {
        let updateCalls = 0;
        global.fetch = async () => { updateCalls++; return {ok: true, json: async () => ({code: 0})}; };
        const editor = mkEditor();
        const block = mkBlock(editor, "bD", '文本 <kbd>Ctrl</kbd> 公式 \\(x\\)');
        const range = document.createRange();
        range.setStart(block.firstChild, 0);
        range.setEnd(block.lastChild, block.lastChild.length);
        const ctx = M.captureManualContext(range, null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "blockRichRefuse", "kbd 等未知语义元素 → 整块拒绝", key);
        assert(updateCalls === 0, "未触发 updateBlock");
        assert(domeHtml(block).includes("<kbd>"), "DOM 原样未动");
        document.body.innerHTML = "";
    }

    console.log("== 14. 多行段落（<br>）序列化为 \\n → 块级公式 ==");
    {
        let updateCalls = [];
        global.fetch = async (url, opts) => {
            if (String(url).includes("updateBlock")) updateCalls.push(JSON.parse(opts.body));
            return {ok: true, json: async () => ({code: 0})};
        };
        const editor = mkEditor();
        const block = document.createElement("div");
        block.setAttribute("data-node-id", "bE");
        block.setAttribute("data-type", "NodeParagraph");
        block.innerHTML = "x^2<br>+ y^2";
        editor.appendChild(block);
        const range = document.createRange();
        range.setStart(block.firstChild, 0);
        range.setEnd(block.lastChild, block.lastChild.length);
        const ctx = M.captureManualContext(range, null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "done", "<br> 多行整块强制转换返回 done", key);
        assert(updateCalls.length === 1 && updateCalls[0].data.includes("$$\n") && updateCalls[0].data.includes("x^2\n+ y^2"),
            "换行经 <br> 序列化为 \\n 并包装成 $$ 块", JSON.stringify(updateCalls[0]));
        document.body.innerHTML = "";
    }

    console.log("== 15. 强制转换保护：普通中文句子拒绝 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "bF", "这是一个普通中文句子");
        const range = selectRange(block, 0, block.firstChild.length);
        const ctx = M.captureManualContext(range, null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "looksNotMath", "纯中文句子 → looksNotMath", key);
        assert(block.textContent === "这是一个普通中文句子", "DOM 原样未动");
        document.body.innerHTML = "";
    }

    console.log("== 16. 强制转换信任用户：简单表达式直接转 ==");
    {
        for (const [label, src] of [["单个变量 x", "x"], ["函数 f(x)", "f(x)"], ["列表 a,b", "a,b"], ["数字 123", "123"], ["x_i", "x_i"], ["E=mc^2", "E=mc^2"]]) {
            let updateCalls = [];
            global.fetch = async (url, opts) => {
                if (String(url).includes("updateBlock")) updateCalls.push(JSON.parse(opts.body));
                return {ok: true, json: async () => ({code: 0})};
            };
            const editor = mkEditor();
            const block = mkBlock(editor, "bG" + label.length, src);
            const range = selectRange(block, 0, block.firstChild.length);
            const ctx = M.captureManualContext(range, null);
            const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
            assert(key === "done" && updateCalls.length === 1, label + " → " + updateCalls[0]?.data, key);
            assert(updateCalls[0].data === "$" + src + "$", label + " 包装为行内公式", updateCalls[0].data);
            document.body.innerHTML = "";
        }
    }

    console.log("== 17. 行内代码 span（data-type=code）语义节点：整块拒绝 ==");
    {
        let updateCalls = [];
        global.fetch = async () => { updateCalls++; return {ok: true, json: async () => ({code: 0})}; };
        const editor = mkEditor();
        const block = document.createElement("div");
        block.setAttribute("data-node-id", "bH");
        block.setAttribute("data-type", "NodeParagraph");
        block.innerHTML = '前 <span data-type="code">code</span> 后';
        editor.appendChild(block);
        const range = document.createRange();
        range.setStart(block.firstChild, 0);
        range.setEnd(block.lastChild, block.lastChild.length);
        const ctx = M.captureManualContext(range, null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "blockRichRefuse", "行内代码 span 整块拒绝（不扁平化丢格式）", key);
        assert(updateCalls.length === 0, "未触发 updateBlock");
        assert(domeHtml(block).includes('data-type="code"'), "DOM 原样未动");
        document.body.innerHTML = "";
    }

    console.log("== 18. 局部跨 <br>：inline-math span 保留换行 ==");
    {
        let updateCalls = [];
        global.fetch = async (url, opts) => {
            if (String(url).includes("updateBlock")) updateCalls.push(1);
            return {ok: true, json: async () => ({code: 0})};
        };
        const editor = mkEditor();
        const block = document.createElement("div");
        block.setAttribute("data-node-id", "bI");
        block.setAttribute("data-type", "NodeParagraph");
        block.innerHTML = "P x^2<br>+ y^2 Q";
        editor.appendChild(block);
        // 只选 "x^2<br>+ y^2"（第一文本 2..末，第二文本到 "+ y^2" 结束）
        const first = block.firstChild;
        const range = document.createRange();
        range.setStart(first, 2);
        range.setEnd(block.childNodes[2], 4);
        const ctx = M.captureManualContext(range, null);
        const key = await M.runManualAction(ctx, "fix", fixLatexText, convertToPlain);
        assert(key === "done", "局部跨 <br> 转换返回 done（不再要求选整段）", key);
        const span = block.querySelector('[data-type="inline-math"]');
        assert(span !== null && (span.getAttribute("data-content") || "").includes("\n"),
            "生成 inline-math span 且 data-content 保留换行", span && JSON.stringify(span.getAttribute("data-content")));
        assert(updateCalls.length === 0, "未走 updateBlock（局部原地替换）");
        document.body.innerHTML = "";
    }

    console.log(`\n手动转换测试: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });