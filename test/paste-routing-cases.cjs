// v0.2.3 粘贴路由专项测试（src/paste-context.ts + 路由纯函数）
// 覆盖审查要求：代码块目标信息贯通（issue #1 结构性漏口）、files 不被吞、
// 快照时效、公式计数不再误算金额、tokenizeInlineMath 配对可靠性。
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
        entryPoints: [path.join(root, "src/scenario.ts")],
        bundle: true, format: "cjs", platform: "node",
        external: ["mathml2latex"],
        outfile: path.join(__dirname, "_scenario.cjs"), logLevel: "silent",
    });
    await esbuild.build({
        entryPoints: [path.join(root, "src/paste-context.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_paste-context.cjs"), logLevel: "silent",
    });
    const { tokenizeInlineMath, tokenizeMath } = require("./_fix-latex.cjs");
    const { detectPasteScenario, countMathFormulas, planPasteHandling } = require("./_scenario.cjs");
    const { capturePasteContext, consumePasteContext, PASTE_CONTEXT_WINDOW_MS } = require("./_paste-context.cjs");
    const R = String.raw;

    const dom = new JSDOM("<!DOCTYPE html><body></body>", {url: "http://localhost/"});
    global.document = dom.window.document;
    global.window = dom.window;

    console.log("== 1. 快照捕获：编辑器外不记录 / 编辑器内记录目标与文件 ==");
    {
        const outside = {target: document.body, clipboardData: {files: [], getData: () => ""}};
        assert(capturePasteContext(outside) === null, "编辑器外粘贴不记录快照");

        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        document.body.appendChild(editor);
        const plainTarget = document.createElement("div");
        editor.appendChild(plainTarget);
        const snap = capturePasteContext({
            target: plainTarget,
            clipboardData: {files: [{name: "a.png"}], getData: (t) => (t === "text/plain" ? "内容" : "")},
        });
        assert(snap !== null && snap.inCodeTarget === false, "普通段落：inCodeTarget=false", JSON.stringify(snap));
        assert(snap.hasFiles === true, "携带文件被记录（不会在 DOM 通道被吞）");
        assert(snap.textPlain === "内容", "text/plain 记录");

        const codeBlock = document.createElement("div");
        codeBlock.setAttribute("data-type", "NodeCodeBlock");
        editor.appendChild(codeBlock);
        const snap2 = capturePasteContext({
            target: codeBlock,
            clipboardData: {files: [], getData: () => R`const x = "\frac{a}{b}";`},
        });
        assert(snap2 !== null && snap2.inCodeTarget === true, "代码块目标：inCodeTarget=true（issue #1 漏口闭合）");
        assert(snap2.protyleElement === editor, "编辑器从 DOM 推导");
        document.body.innerHTML = "";
    }

    console.log("== 2. 快照时效与指纹：窗口期内且文本一致才可用 ==");
    {
        const snap = {time: Date.now() - 50, inCodeTarget: false, protyleElement: null, hasFiles: false, textPlain: "AAA", textHTML: ""};
        assert(consumePasteContext(snap, Date.now()) === snap, "50ms 前快照可用");
        assert(consumePasteContext(snap, Date.now(), {textPlain: "AAA"}) === snap, "textPlain 指纹一致可用");
        assert(consumePasteContext(snap, Date.now(), {textPlain: "BBB"}) === null, "textPlain 指纹不一致忽略（不吃旧 context）");
        const snapHtml = {time: Date.now() - 50, inCodeTarget: false, protyleElement: null, hasFiles: false, textPlain: "AAA", textHTML: "AAA"};
        assert(consumePasteContext(snapHtml, Date.now(), {textHTML: "BBB"}) === null, "textHTML 指纹不一致忽略");
        const emptyPlain = {...snap, textPlain: ""};
        assert(consumePasteContext(emptyPlain, Date.now(), {textPlain: "BBB"}) === emptyPlain, "快照侧为空文本时不做指纹比较（仍可用）");
        const old = {time: Date.now() - PASTE_CONTEXT_WINDOW_MS - 100, inCodeTarget: false, protyleElement: null, hasFiles: false, textPlain: "", textHTML: ""};
        assert(consumePasteContext(old, Date.now()) === null, "超过观察窗的快照忽略");
        assert(consumePasteContext(null, Date.now()) === null, "无快照返回 null");
    }

    console.log("== 2b. 行内代码目标：span[data-type=code] + caret 位置检测 ==");
    {
        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        document.body.appendChild(editor);
        // 官方真实 DOM：行内代码是 span[data-type="code"]（非 NodeInlineCode）
        const codeSpan = document.createElement("span");
        codeSpan.setAttribute("data-type", "code");
        codeSpan.textContent = "x_i";
        editor.appendChild(codeSpan);
        const snap = capturePasteContext({
            target: codeSpan,
            clipboardData: {files: [], getData: () => "const x = $\\frac{a}{b}$;"},
        });
        assert(snap !== null && snap.inCodeTarget === true, "span[data-type=code] 目标识别为代码", JSON.stringify(snap));

        // caret 在行内代码内、event.target 是外层 contenteditable（真实存在形态）
        const outer = document.createElement("div");
        outer.setAttribute("contenteditable", "true");
        editor.appendChild(outer); // 外层必须仍在 .protyle-wysiwyg 内
        const codeSpan2 = document.createElement("span");
        codeSpan2.setAttribute("data-type", "code");
        codeSpan2.textContent = "y";
        outer.appendChild(codeSpan2);
        const range = document.createRange();
        range.setStart(codeSpan2.firstChild, 1);
        range.collapse(true);
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const snap2 = capturePasteContext({
            target: outer, // event.target 是外层，光标在内层 code span
            clipboardData: {files: [], getData: () => "z"},
        });
        assert(snap2 !== null && snap2.inCodeTarget === true, "caret 在 code span 内（target 为外层）也识别", JSON.stringify(snap2));
        document.body.innerHTML = "";
    }

    console.log("== 2c. 分屏 code caret 不污染：selection 须属于本次粘贴的编辑器 ==");
    {
        const editorA = document.createElement("div");
        editorA.className = "protyle-wysiwyg";
        document.body.appendChild(editorA);
        const editorB = document.createElement("div");
        editorB.className = "protyle-wysiwyg";
        document.body.appendChild(editorB);
        // B 编辑器里 caret 在行内代码内
        const codeSpan = document.createElement("span");
        codeSpan.setAttribute("data-type", "code");
        codeSpan.textContent = "z";
        editorB.appendChild(codeSpan);
        const range = document.createRange();
        range.setStart(codeSpan.firstChild, 1);
        range.collapse(true);
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        // 在 A 编辑器普通位置粘贴：B 的 code selection 不应污染判定
        const aTarget = document.createElement("div");
        editorA.appendChild(aTarget);
        const snap = capturePasteContext({
            target: aTarget,
            clipboardData: {files: [], getData: () => "$x^2$"},
        });
        assert(snap !== null && snap.inCodeTarget === false, "另一编辑器 code caret 不污染当前粘贴", JSON.stringify(snap));
        document.body.innerHTML = "";
    }

    console.log("== 3. 代码块目标 + LaTeX 内容：一律 code-target 放行 ==");
    {
        const s = detectPasteScenario({textPlain: R`const x = "\frac{a}{b}";`, textHTML: "", siyuanHTML: "", inCodeTarget: true});
        assert(s === "code-target", "粘贴目标是代码块时即使内容含 \\frac 也放行", s);
    }

    console.log("== 4. 路由裁决（planPasteHandling） ==");
    {
        const plan = (plain, html = "", sy = "", inCode = false, policy = () => "smart") =>
            planPasteHandling({textPlain: plain, textHTML: html, siyuanHTML: sy, inCodeTarget: inCode, getPolicy: policy});
        const p1 = plan(R`const x = "\frac{a}{b}";`);
        assert(p1.scenario === "code-content" && p1.action === "pass" && p1.hint === true, "代码内容 smart → 放行+提示", JSON.stringify(p1));
        assert(plan("普通一句话。").action === "pass" && plan("普通一句话。").hint === false, "纯散文 → 放行无提示");
        assert(plan("", "", '<span data-type="inline-math">x</span>').action === "pass", "思源内部复制 → 放行");
        assert(plan(R`\frac{a}{b} 说明`).action === "fix", "AI 数学 smart → 进入修复管线");
        const passPolicy = plan(R`\frac{a}{b} 说明`, "", "", false, (s) => (s === "ai-latex" ? "pass" : "smart"));
        assert(passPolicy.action === "pass" && passPolicy.hint === true, "AI 数学 pass → 放行+提示");
        const fixPolicy = plan("const a = 1;", "", "", false, (s) => (s === "code-content" ? "fix" : "smart"));
        assert(fixPolicy.scenario === "code-content" && fixPolicy.action === "fix", "代码内容 fix 策略 → 进入修复管线", JSON.stringify(fixPolicy));
    }

    console.log("== 5. tokenizeInlineMath：正文/公式/金额边界 ==");
    {
        const t1 = tokenizeInlineMath("A $x$ B $y_i$ C");
        assert(JSON.stringify(t1.map((t) => [t.math, t.text])) ===
            JSON.stringify([[false, "A "], [true, "x"], [false, " B "], [true, "y_i"], [false, " C"]]),
        "全文切分为 文本+公式+文本+公式+文本", JSON.stringify(t1));
        const t2 = tokenizeInlineMath("费用 $5 到 $10");
        assert(t2.length === 1 && t2[0].math === false, "金额对不算公式", JSON.stringify(t2));
        const t3 = tokenizeInlineMath("未闭合 $x+1");
        assert(t3.length === 1 && t3[0].text === "未闭合 $x+1", "未闭合美元按文本保留");
        const t4 = tokenizeInlineMath("$x$ 与 $$y=Wx$$ 和 $a_i$");
        assert(t4.filter((t) => t.math).length === 2, "块级 $$ 不参与行内配对（留给块处理）");
        const t5 = tokenizeInlineMath(String.raw`\$5 转义美元`);
        assert(t5.length === 1 && t5[0].text === String.raw`\$5 转义美元`, "转义美元按文本保留");
    }

    console.log("== 6. tokenizeMath 三态（text/inline/block）与跨行 ==");
    {
        const t1 = tokenizeMath("A $x$ B $$y$$ C");
        assert(JSON.stringify(t1.map((t) => [t.kind, t.text])) ===
            JSON.stringify([["text", "A "], ["inline", "x"], ["text", " B "], ["block", "y"], ["text", " C"]]),
        "三态切分（inline/block 分开）", JSON.stringify(t1));
        const t2 = tokenizeMath("$x\ny$", {multiline: true});
        assert(t2.length === 1 && t2[0].kind === "text", "跨行纯变量对不可靠，保持文本", JSON.stringify(t2));
        const t3 = tokenizeMath("$x+y\nz+w$", {multiline: true});
        assert(t3.length === 1 && t3[0].kind === "inline" && t3[0].text === "x+y\nz+w", "跨行可靠对为 inline token", JSON.stringify(t3));
        const t4 = tokenizeMath("价格 $5\n第二天花了 $10", {multiline: true});
        assert(t4.length === 1 && t4[0].kind === "text", "金额跨行保持文本", JSON.stringify(t4));
    }

    console.log("== 7. countMathFormulas：金额不再误计数 ==");
    {
        assert(countMathFormulas("价格从 $5 涨到了 $10") === 0, "两处金额不计数", String(countMathFormulas("价格从 $5 涨到了 $10")));
        assert(countMathFormulas("$5 and $10 与 $x_i$") === 1, "混合金额+公式只计 1", String(countMathFormulas("$5 and $10 与 $x_i$")));
        assert(countMathFormulas("$x$ 与 $$y=Wx$$ 和 $a_i$") === 3, "常规计数 3");
        assert(countMathFormulas("没有公式") === 0, "无公式计 0");
    }

    console.log(`\n粘贴路由测试: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });