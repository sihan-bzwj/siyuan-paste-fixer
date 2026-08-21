/**
 * MathML/网页粘贴集成测试：用网上下载的真实页面 HTML 驱动。
 * - Wikipedia 原生 MathML（wiki-gauss.html / wiki-matrix.html）
 * - OI Wiki 的 MathJax 3（oiwiki-matrix.html，mjx-container + assistive MathML）
 * - MathJax v2 源码嵌入 <script type="math/tex">
 * - KaTeX 渲染页（katex 本地真实渲染，结构等价于 katex.org 等站点）
 * - Word OMML（<m:oMath>，应安全跳过不崩溃）
 * 全部转换结果再过 fixLatexText + KaTeX 严格解析校验。
 * 运行：node test/mathml-cases.cjs（需 npm install 后执行）
 */
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const katex = require("katex");

const root = path.join(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(cond, name, extra) {
    if (cond) { passed++; console.log("  ✓", name); }
    else { failed++; console.error("  ✗", name, extra ? "\n    " + String(extra).slice(0, 300) : ""); }
}

/** 提取片段中所有 $...$ / $$...$$ 并做 KaTeX 严格解析（块公式按 display 模式） */
function katexCheck(text, name) {
    const blocks = [...text.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => m[1].trim());
    const rest = text.replace(/\$\$[\s\S]+?\$\$/g, "");
    const inlines = [...rest.matchAll(/\$([^$\n]+?)\$/g)].map((m) => m[1]);
    let errs = 0;
    blocks.forEach((src, i) => {
        try { katex.renderToString(src, { displayMode: true, throwOnError: true }); }
        catch (e) { errs++; console.error("    KaTeX 报错 块#" + i + ": " + src.slice(0, 90) + " -> " + e.message); }
    });
    inlines.forEach((src, i) => {
        try { katex.renderToString(src, { throwOnError: true }); }
        catch (e) { errs++; console.error("    KaTeX 报错 行内#" + i + ": " + src.slice(0, 90) + " -> " + e.message); }
    });
    assert(errs === 0, name + `（${blocks.length} 块 + ${inlines.length} 行内，KaTeX 全部可解析）`);
}

/** 抽取含 <math> 的段落（最多 n 个），拼成片段 HTML */
function extractMathParagraphs(html, n) {
    const segs = [];
    const re = /<p[^>]*>[\s\S]*?<\/p>/gi;
    let m;
    while ((m = re.exec(html)) && segs.length < n) {
        if (/<math[\s>]/i.test(m[0])) segs.push(m[0]);
    }
    return segs.join("\n");
}

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/mathml.ts")],
        bundle: true, format: "cjs", platform: "node",
        external: ["mathml2latex"],
        outfile: path.join(__dirname, "_mathml.cjs"), logLevel: "silent",
    });
    await esbuild.build({
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_fix-latex.cjs"), logLevel: "silent",
    });
    const mml = require("./_mathml.cjs");
    const { fixLatexText } = require("./_fix-latex.cjs");

    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    global.DOMParser = dom.window.DOMParser;
    global.Node = dom.window.Node;
    global.HTMLElement = dom.window.HTMLElement;
    global.document = dom.window.document;

    console.log("== 1. Wikipedia 原生 MathML（高斯消元页） ==");
    const wiki = fs.readFileSync(path.join(__dirname, "fixtures/web/wiki-gauss.html"), "utf8");
    const frag = extractMathParagraphs(wiki, 6);
    assert(frag.includes("<math"), "抽到含 math 的段落");
    assert(mml.hasMathML(frag), "hasMathML 检出原生 MathML");
    const wres = mml.convertMathMLInHTML(frag);
    assert(wres.count > 0, "转换计数 > 0（实际 " + wres.count + "）");
    assert(/\$\$/.test(wres.text) && /\$[^$]/.test(wres.text), "块级+行内公式都生成");
    const wfixed = fixLatexText(wres.text);
    katexCheck(wfixed, "Wikipedia 高斯消元片段");
    assert(!/<math/i.test(wfixed) && !/annotation/i.test(wfixed), "无 MathML 残留");

    console.log("== 2. Wikipedia 矩阵乘法页（更多公式） ==");
    const wiki2 = fs.readFileSync(path.join(__dirname, "fixtures/web/wiki-matrix.html"), "utf8");
    const frag2 = extractMathParagraphs(wiki2, 8);
    const wres2 = mml.convertMathMLInHTML(frag2);
    assert(wres2.count > 0, "转换计数 > 0（实际 " + wres2.count + "）");
    katexCheck(fixLatexText(wres2.text), "Wikipedia 矩阵乘法片段");

    console.log("== 3. OI Wiki（MathJax 3，mjx-container） ==");
    const oi = fs.readFileSync(path.join(__dirname, "fixtures/web/oiwiki-matrix.html"), "utf8");
    const mjxSegs = [...oi.matchAll(/<mjx-container[\s\S]*?<\/mjx-container>/g)].slice(0, 8).map((m) => m[0]);
    const oiFrag = "<p>" + mjxSegs.join("") + "</p>";
    assert(oiFrag.includes("mjx-container"), "抽到 mjx-container 片段");
    assert(mml.hasMathML(oiFrag), "hasMathML 检出 mjx-container");
    const ores = mml.convertMathMLInHTML(oiFrag);
    assert(ores.count > 0, "转换计数 > 0（实际 " + ores.count + "）");
    katexCheck(fixLatexText(ores.text), "OI Wiki MathJax3 片段");

    console.log("== 4. MathJax v2 源码嵌入（script type=math/tex） ==");
    const v2 = "<p>惯性质量满足 <script type=\"math/tex\">m = \\frac{E}{c^2}</script>，" +
        "求和公式 <script type=\"math/tex; mode=display\">\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}</script> 结束。</p>";
    assert(mml.hasMathML(v2), "hasMathML 检出 math/tex 脚本");
    const v2res = mml.convertMathMLInHTML(v2);
    assert(v2res.count === 2, "两个脚本都转换（实际 " + v2res.count + "）");
    assert(v2res.text.includes("$m = \\frac{E}{c^2}$"), "行内 TeX 转 $...$");
    assert(v2res.text.includes("$$") && v2res.text.includes("\\sum_{i=1}^{n}"), "显示 TeX 转 $$");
    katexCheck(fixLatexText(v2res.text), "MathJax v2 片段");

    console.log("== 5. KaTeX 渲染页（真实 katex 输出） ==");
    const k1 = katex.renderToString("\\frac{a}{b}", { displayMode: true, throwOnError: true });
    const k2 = katex.renderToString("x_i^2", { throwOnError: true });
    const katexFrag = "<p>块公式：" + k1 + "行内：" + k2 + "</p>";
    assert(mml.hasMathML(katexFrag), "hasMathML 检出 katex");
    const kres = mml.convertMathMLInHTML(katexFrag);
    assert(kres.count === 2, "两个公式都还原（实际 " + kres.count + "）");
    assert(kres.text.includes("$$") && kres.text.includes("\\frac{a}{b}"), "块级 KaTeX 取回 TeX 源码");
    assert(kres.text.includes("$x_i^2$"), "行内 KaTeX 取回 TeX 源码");
    katexCheck(fixLatexText(kres.text), "KaTeX 片段");

    console.log("== 6. Word OMML（安全跳过） ==");
    const ooml = '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';
    const oomlres = mml.convertMathMLInHTML(ooml);
    assert(oomlres.count === 0 && oomlres.text === "", "OMML 不转换不崩溃");

    console.log("== 7. 混合页面（正文 + 链接 + 图片 + 公式） ==");
    const mixed = "<p>参见 <a href=\"https://en.wikipedia.org/wiki/Matrix_multiplication\">矩阵乘法</a>。" +
        "公式 <math display=\"block\"><semantics><mrow><mi>A</mi><mo>=</mo><mi>B</mi></mrow>" +
        "<annotation encoding=\"application/x-tex\">A = B</annotation></semantics></math> 图像 <img alt=\"fig1\" src=\"x.png\"></p>";
    const mres = mml.convertMathMLInHTML(mixed);
    assert(mres.count >= 1, "混合页面有转换");
    assert(mres.text.includes("矩阵乘法"), "链接文字保留");
    assert(mres.text.includes("$$") && mres.text.includes("A = B"), "显示公式转块级");
    assert(!mres.text.includes("x.png"), "图片 URL 不进文本");

    console.log("== 8. annotation 不被 mathml2latex 二次处理 ==");
    const anno = "<p>x = <math><semantics><mrow><mi>x</mi><mo>=</mo><mi>y</mi></mrow>" +
        "<annotation encoding=\"application/x-tex\">x = y</annotation></semantics></math> 结束</p>";
    const ares = mml.convertMathMLInHTML(anno);
    assert(ares.count === 1, "单次转换不重复计数（实际 " + ares.count + "）");
    assert(ares.text === "x = $x = y$ 结束", "输出无重复公式", ares.text);

    console.log("== 9. Wikipedia alttext（mathjax_ignore 公式） ==");
    const alt = "<p>公式 <math class=\"mathjax_ignore\" alttext=\"{\\displaystyle \\mathbf {x} ^{\\mathrm {T} }\\mathbf {A} =(\\mathbf {A} ^{\\mathrm {T} }\\mathbf {x} )^{\\mathrm {T} }}\">" +
        "<mrow><msup><mi>x</mi><mi>T</mi></msup><mi>A</mi></mrow></math> 结束</p>";
    const altres = mml.convertMathMLInHTML(alt);
    assert(altres.count === 1, "alttext 转换成功（实际 " + altres.count + "）");
    assert(altres.text.includes("\\mathbf {x} ^{\\mathrm {T} }"), "alttext 还原原始 TeX", altres.text);
    katexCheck(fixLatexText(altres.text), "Wikipedia alttext 样例");

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
