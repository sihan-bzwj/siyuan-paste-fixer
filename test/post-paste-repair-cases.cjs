// v0.2.8 粘贴后兜底修复专项测试（src/post-paste-repair.ts）
// 覆盖：只认渲染失败节点、修不好的不动、行内不升级块级、白名单外结构整块跳过并回滚、
// 公式块走 $$ 路径、修复范围只限新块/光标块。
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

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_fix-latex.cjs"), logLevel: "silent",
    });
    await esbuild.build({
        entryPoints: [path.join(root, "src/post-paste-repair.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_post-paste-repair.cjs"), logLevel: "silent",
    });
    const { fixLatexText } = require("./_fix-latex.cjs");
    const R = require("./_post-paste-repair.cjs");

    const dom = new JSDOM("<!DOCTYPE html><body></body>", {url: "http://localhost/"});
    global.window = dom.window;
    global.document = dom.window.document;

    const brokenInline = "x\\in\\mathbb R^{d_{\\text{in}}},\\qquadW\\in\\mathbb R^{d_{\\text{out}}}";
    const fixedInline = "x\\in\\mathbb R^{d_{\\text{in}}},\\qquad W\\in\\mathbb R^{d_{\\text{out}}}";
    const brokenBlock = "a=[1,2],\\qquadb=[3,4,5]";
    const fixedBlock = "a=[1,2],\\qquad b=[3,4,5]";

    function paragraph(id, inner) {
        return '<div data-node-id="' + id + '" data-type="NodeParagraph" class="p">' +
            '<div contenteditable="true" spellcheck="false">' + inner + '</div>' +
            '<div class="protyle-attr">\u200b</div></div>';
    }
    function inlineMath(tex, broken) {
        const inner = broken
            ? '<span class="katex-error" title="KaTeX parse error">KaTeX parse error: Undefined control sequence</span>'
            : '<span class="katex"><span class="katex-mathml"></span></span>';
        return '<span data-type="inline-math" data-subtype="math" data-content="' + tex + '">' + inner + '</span>';
    }

    const editor = document.createElement("div");
    editor.className = "protyle-wysiwyg";
    editor.innerHTML =
        paragraph("p1", inlineMath(brokenInline, true)) +
        paragraph("p2", "正常公式 " + inlineMath("a_i", false)) +
        paragraph("p3", "<strong>粗体</strong>里的坏公式 " + inlineMath("c\\qquadd", true)) +
        '<div data-node-id="m1" data-type="NodeMathBlock" data-content="' + brokenBlock + '">' +
        '<span class="katex-error">KaTeX parse error: Undefined control sequence: \\qquadb</span></div>' +
        paragraph("p5", inlineMath("\\undefinedcmd", true)) +
        paragraph("p6", inlineMath("2x", true)) +
        paragraph("p7", "<wbr>" + inlineMath("g\\qquadh", true));
    document.body.appendChild(editor);

    console.log("== 1. 渲染失败判定 ==");
    const p1 = editor.querySelector('[data-node-id="p1"]');
    const p2 = editor.querySelector('[data-node-id="p2"]');
    assert(R.isBrokenMathNode(p1.querySelector('[data-type="inline-math"]')), "katex-error 节点判为失败");
    assert(!R.isBrokenMathNode(p2.querySelector('[data-type="inline-math"]')), "正常渲染节点不判失败");

    console.log("== 2. 内容修复（复用粘贴修复引擎） ==");
    assert(R.fixMathNodeContent("inline", "p(z)\\proptoe^{s(z)}", fixLatexText) === "p(z)\\propto e^{s(z)}", "行内 \\proptoe → \\propto e");
    assert(R.fixMathNodeContent("inline", "a\\qquadb", fixLatexText) === "a\\qquad b", "行内 \\qquadb → \\qquad b");
    assert(R.fixMathNodeContent("inline", "a\\rightarrowWx", fixLatexText) === "a\\rightarrow Wx", "行内 \\rightarrowWx 断词");
    assert(R.fixMathNodeContent("inline", "\\undefinedcmd", fixLatexText) === null, "修不好（未知命令）返回 null 不动");
    assert(R.fixMathNodeContent("inline", "a_i", fixLatexText) === null, "本来就正常返回 null");
    assert(R.fixMathNodeContent("inline", "2x", fixLatexText) === null, "数字开头被 luteSafeInline 包裹不算内容变更");
    assert(R.fixMathNodeContent("inline", "a\nb$c", fixLatexText) === null, "多行/含美元的行内内容不原地改");
    assert(R.fixMathNodeContent("block", brokenBlock, fixLatexText) === fixedBlock, "块级公式同样断词");

    console.log("== 3. 候选收集 ==");
    const blocks = Array.from(editor.querySelectorAll("[data-node-id]"));
    const candidates = R.collectMathRepairs(blocks, fixLatexText);
    assert(candidates.length === 4, "只收集渲染失败且能修的节点（p1/p3/m1/p7；2x 无变化不算）", JSON.stringify(candidates.map((c) => c.from)));
    assert(candidates.every((c) => c.from !== "a_i"), "正常公式不在候选里");
    assert(candidates.every((c) => R.fixMathNodeContent(c.kind, c.to, fixLatexText) === null), "候选的 to 已幂等（再修无变化）");

    console.log("== 4. 序列化 fail-closed ==");
    const p3 = editor.querySelector('[data-node-id="p3"]');
    const p3Math = p3.querySelector('[data-type="inline-math"]');
    p3Math.setAttribute("data-content", "c\\qquad d");
    assert(R.serializeBlockMarkdown(p3) === null, "含 <strong> 的块序列化返回 null（整块跳过）");
    p3Math.setAttribute("data-content", "c\\qquadd");
    const p1Math = p1.querySelector('[data-type="inline-math"]');
    p1Math.setAttribute("data-content", fixedInline);
    assert(R.serializeBlockMarkdown(p1) === "$" + fixedInline + "$", "普通段落序列化为 $...$", JSON.stringify(R.serializeBlockMarkdown(p1)));
    p1Math.setAttribute("data-content", brokenInline);
    const m1 = editor.querySelector('[data-node-id="m1"]');
    m1.setAttribute("data-content", fixedBlock);
    assert(R.serializeBlockMarkdown(m1) === "$$\n" + fixedBlock + "\n$$", "公式块序列化为 $$ 块");
    // 思源空块/占位会塞 <wbr>（对 Markdown 无语义）：不能因此整块跳过
    const p7 = editor.querySelector('[data-node-id="p7"]');
    const p7Math = p7.querySelector('[data-type="inline-math"]');
    const p7Fixed = "g\\qquad h";
    p7Math.setAttribute("data-content", p7Fixed);
    assert(R.serializeBlockMarkdown(p7) === "$" + p7Fixed + "$", "<wbr> 占位被剔除后仍可序列化", JSON.stringify(R.serializeBlockMarkdown(p7)));
    p7Math.setAttribute("data-content", "g\\qquadh");
    m1.setAttribute("data-content", brokenBlock);

    console.log("== 5. 应用修复（updateBlock 走注入桩） ==");
    const calls = [];
    const fixedCount = await R.applyMathRepairs(candidates, {
        updateBlock: async (block, markdown) => { calls.push([block.getAttribute("data-node-id"), markdown]); },
    });
    assert(fixedCount === 3, "只有 3 个块真正写回（p3 白名单外跳过）", String(fixedCount));
    assert(calls.length === 3, "updateBlock 调用次数", JSON.stringify(calls));
    const byId = new Map(calls);
    assert(byId.get("p1") === "$" + fixedInline + "$", "p1 写回修复后的行内公式", JSON.stringify(byId.get("p1")));
    assert(byId.get("m1") === "$$\n" + fixedBlock + "\n$$", "m1 写回修复后的公式块", JSON.stringify(byId.get("m1")));
    assert(byId.get("p7") === "$g\\qquad h$", "p7（带 <wbr>）也写回", JSON.stringify(byId.get("p7")));
    assert(!byId.has("p3"), "含加粗的块不写回");
    assert(p3Math.getAttribute("data-content") === "c\\qquadd", "跳过时 data-content 回滚", p3Math.getAttribute("data-content"));

    console.log("== 6. 幂等与失败回滚 ==");
    assert(R.collectMathRepairs([p1, m1], fixLatexText).length === 0, "已修好的内容不再产生候选");
    const p6 = editor.querySelector('[data-node-id="p6"]');
    const p6Math = p6.querySelector('[data-type="inline-math"]');
    p6Math.setAttribute("data-content", "e\\qquadf");
    const got6 = R.collectMathRepairs([p6], fixLatexText);
    assert(got6.length === 1, "新坏公式可被收集");
    await R.applyMathRepairs(got6, {updateBlock: async () => { throw new Error("http 500"); }});
    assert(p6Math.getAttribute("data-content") === "e\\qquadf", "updateBlock 失败时 data-content 回滚", p6Math.getAttribute("data-content"));

    console.log("== 7. 修复范围（不全文档乱修） ==");
    const other = document.createElement("div");
    other.className = "protyle-wysiwyg";
    other.innerHTML = paragraph("b1", "x") + paragraph("b2", "y") + paragraph("b3", "z");
    document.body.appendChild(other);
    const known = new Set(["b2"]);
    const targets = R.collectPasteTargetBlocks(other, known).map((el) => el.getAttribute("data-node-id"));
    assert(JSON.stringify(targets) === JSON.stringify(["b1", "b3"]), "只挑新块（b2 已存在→不动）", JSON.stringify(targets));
    assert(R.collectPasteTargetBlocks(other, null).length === 0, "没有粘贴前快照时只认光标块（这里无光标→空）");

    console.log("");
    console.log("粘贴后兜底修复测试: " + passed + " 通过, " + failed + " 失败");
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("测试异常:", e); process.exit(1); });
