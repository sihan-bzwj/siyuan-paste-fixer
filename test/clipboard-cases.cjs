/** v0.1.7 HTML/plain 剪贴板来源优先级测试。 */
const path = require("path");
const esbuild = require("esbuild");
const {JSDOM} = require("jsdom");

const root = path.join(__dirname, "..");
let passed = 0;

function assert(condition, name, detail = "") {
    if (!condition) {
        console.error("  ✗", name, detail ? "\n    " + detail : "");
        process.exitCode = 1;
        return;
    }
    passed++;
    console.log("  ✓", name);
}

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/clipboard.ts")],
        bundle: true, format: "cjs", platform: "node",
        external: ["mathml2latex"],
        outfile: path.join(__dirname, "_clipboard.cjs"), logLevel: "silent",
    });
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    global.DOMParser = dom.window.DOMParser;
    global.Node = dom.window.Node;
    global.HTMLElement = dom.window.HTMLElement;
    delete require.cache[require.resolve("./_clipboard.cjs")];
    const {selectClipboardMarkdown, hasReliablePlainMath} = require("./_clipboard.cjs");

    console.log("== 剪贴板来源裁决 ==");
    assert(selectClipboardMarkdown("", "普通文本", "") === null, "普通文本不干预");
    assert(selectClipboardMarkdown("", "\\(x\\)", '<span data-type="inline-math"></span>') === null,
        "思源内部公式不干预");
    assert(hasReliablePlainMath("\\(x^2\\)") && !hasReliablePlainMath("$HOME 与 $10"),
        "plain 完整公式判定排除 Shell 和金额");

    const annotation = '<span class="katex"><math><semantics><mrow><mi>x</mi></mrow>' +
        '<annotation encoding="application/x-tex">x^2</annotation></semantics></math>' +
        '<span class="katex-html">x³</span></span>';
    let result = selectClipboardMarkdown(annotation, "\\(wrong\\)", "");
    assert(result && result.source === "html" && result.markdown === "$x^2$" &&
        result.htmlQuality === "exact" && result.sourceKinds.includes("annotation"),
    "TeX annotation 优先且视觉 DOM 不重复", JSON.stringify(result));

    const dataLatex = '<mjx-container display="true"><mjx-math data-latex="E=mc^2"></mjx-math>' +
        '<math><mi>E</mi></math></mjx-container>';
    result = selectClipboardMarkdown(dataLatex, "\\(wrong\\)", "");
    assert(result && result.source === "html" && result.markdown.includes("E=mc^2") &&
        result.sourceKinds.includes("data-latex"), "MathJax v3 data-latex 优先", JSON.stringify(result));

    const v2 = '<p><script type="math/tex; mode=display">a^2+b^2=c^2</script></p>';
    result = selectClipboardMarkdown(v2, "\\(wrong\\)", "");
    assert(result && result.source === "html" && result.markdown.includes("a^2+b^2=c^2") &&
        result.sourceKinds.includes("mathjax-v2"), "MathJax v2 原始 TeX 优先", JSON.stringify(result));

    result = selectClipboardMarkdown('<script type="math/tex">x</script>', "\\(plain_x\\)", "");
    assert(result && result.source === "plain" && result.markdown === "$plain_x$",
        "HTML 计数成功但正文为空时禁止覆盖 plain", JSON.stringify(result));

    const alt = '<math alttext="{\\displaystyle \\frac{1}{2}}"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>';
    result = selectClipboardMarkdown(alt, "\\(wrong\\)", "");
    assert(result && result.source === "html" && result.markdown.includes("\\frac{1}{2}") &&
        result.sourceKinds.includes("alttext"), "有效 alttext 优先", JSON.stringify(result));

    const derived = '<math><msup><mi>x</mi><mn>2</mn></msup></math>';
    result = selectClipboardMarkdown(derived, "\\(y^2\\)", "");
    assert(result && result.source === "plain" && result.markdown === "$y^2$" &&
        result.htmlQuality === "derived", "纯 MathML 与完整 plain 冲突时选 plain", JSON.stringify(result));

    result = selectClipboardMarkdown(derived, "x 2", "");
    assert(result && result.source === "html" && result.sourceKinds.includes("mathml") &&
        result.markdown.includes("x"), "plain 展平时选 MathML 推导", JSON.stringify(result));

    const emptyAnnotation = '<span class="katex"><math><semantics><msup><mi>z</mi><mn>3</mn></msup>' +
        '<annotation encoding="application/x-tex"></annotation></semantics></math></span>';
    result = selectClipboardMarkdown(emptyAnnotation, "\\(p^3\\)", "");
    assert(result && result.source === "plain" && result.sourceKinds.includes("mathml"),
        "空 annotation 回退 MathML 后按质量选 plain", JSON.stringify(result));

    const multiAnnotation = '<math><semantics><mi>x</mi>' +
        '<annotation encoding="MathML-Content">ignored</annotation>' +
        '<annotation encoding="application/x-tex">x_1</annotation></semantics></math>';
    result = selectClipboardMarkdown(multiAnnotation, "plain", "");
    assert(result && result.source === "html" && result.markdown === "$x_1$" &&
        result.sourceKinds.length === 1, "多 annotation 只选 TeX", JSON.stringify(result));

    const duplicate = '<span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi>' +
        '<annotation encoding="application/x-tex">x</annotation></semantics></math></span>' +
        '<span class="katex-html">visual x</span></span>';
    result = selectClipboardMarkdown(duplicate, "x", "");
    assert(result && result.markdown === "$x$" && (result.markdown.match(/\$x\$/g) || []).length === 1,
        "KaTeX 辅助层与视觉层只生成一次", JSON.stringify(result));

    result = selectClipboardMarkdown("", "文本 \\(x+y\\)", "");
    assert(result && result.source === "plain" && result.markdown === "文本 $x+y$",
        "无 HTML 时修复 plain", JSON.stringify(result));
    assert(selectClipboardMarkdown("", "$x$", "") === null, "已完整 plain 无需强制改写");

    let malformedSafe = true;
    try {
        selectClipboardMarkdown("<math><mfrac><mi>x</mi></math>", "plain", "");
    } catch (error) {
        malformedSafe = false;
    }
    assert(malformedSafe, "残缺 DOM 不让裁决器崩溃");

    console.log(`\n剪贴板裁决测试: ${passed} 通过`);
    if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
