/**
 * Word/WPS 公式（OMML）→ LaTeX 测试：
 * 用 DOMParser（text/html，和剪贴板 HTML 的真实解析路径一致）解析内联片段，
 * 取 <m:oMath> / <m:oMathPara> 交给 src/omml.ts 转换，结果逐条过 KaTeX 严格解析；
 * 最后用 test/fixtures/web/word-omml.html 验证 Word 段落里正文与公式混排的场景。
 * 运行：node test/omml-cases.cjs（需 npm install 后执行）
 */
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");
const katex = require("katex");

const root = path.join(__dirname, "..");
let omml;
let passed = 0;
let failed = 0;

function assert(cond, name, extra) {
    if (cond) { passed++; console.log("  ✓", name); }
    else { failed++; console.error("  ✗", name, extra ? "\n    " + String(extra).slice(0, 300) : ""); }
}

/** 解析 HTML 片段：与剪贴板一致走 text/html（tagName 会变大写），不自己拼 XML 字符串。 */
function bodyOf(html) {
    return new DOMParser().parseFromString("<body>" + html + "</body>", "text/html").body;
}

function ommlIn(html) {
    for (const el of bodyOf(html).querySelectorAll("*")) {
        if (omml.isOmmlElement(el)) return el;
    }
    return null;
}

function convertOne(html) {
    const el = ommlIn(html);
    if (!el) return "<没有找到 oMath>";
    return omml.convertOmmlElement(el);
}

/** 转换结果必须能被 KaTeX 严格解析（throwOnError 打开）。 */
function katexValid(src, name) {
    try {
        katex.renderToString(src, { throwOnError: true });
        assert(true, name + " 可被 KaTeX 解析");
    } catch (error) {
        assert(false, name + " 可被 KaTeX 解析", error.message + " | " + src);
    }
}

function hasOmmlAncestor(el) {
    let node = el.parentElement;
    while (node) {
        if (omml.isOmmlElement(node)) return true;
        node = node.parentElement;
    }
    return false;
}

/** 把 OMML 换回 $...$ / $$...$$，模拟插件接线后的文本（仅测试用）。 */
function renderLike(rootEl) {
    const parts = [];
    const walk = (node) => {
        if (node.nodeType === 3) {
            parts.push(node.nodeValue);
            return;
        }
        if (node.nodeType !== 1) return;
        if (omml.isOmmlElement(node)) {
            const latex = omml.convertOmmlElement(node);
            if (!latex) return;
            const name = (node.localName || node.nodeName).toLowerCase();
            parts.push(name.endsWith("omathpara") ? "$$" + latex + "$$" : "$" + latex + "$");
            return;
        }
        for (const child of node.childNodes) walk(child);
    };
    walk(rootEl);
    return parts.join("");
}

// 拼 OMML 片段的小工具
const run = (text) => "<m:r><m:t>" + text + "</m:t></m:r>";
const e = (inner) => "<m:e>" + inner + "</m:e>";
const part = (tag, inner) => "<m:" + tag + ">" + inner + "</m:" + tag + ">";
const om = (inner) => "<m:oMath>" + inner + "</m:oMath>";

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/omml.ts")],
        bundle: true,
        format: "cjs",
        platform: "node",
        outfile: path.join(__dirname, "_omml.cjs"),
        logLevel: "silent",
    });
    omml = require("./_omml.cjs");

    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    global.DOMParser = dom.window.DOMParser;
    global.Node = dom.window.Node;
    global.HTMLElement = dom.window.HTMLElement;
    global.document = dom.window.document;

    console.log("== 1. 探测 hasOmmlMath / 识别 isOmmlElement ==");
    assert(omml.hasOmmlMath(om(run("x"))), "hasOmmlMath 检出 <m:oMath>");
    assert(omml.hasOmmlMath("<m:oMathPara><m:oMath>" + run("x") + "</m:oMath></m:oMathPara>"), "hasOmmlMath 检出 <m:oMathPara>");
    assert(omml.hasOmmlMath("<oMath>" + run("x") + "</oMath>"), "hasOmmlMath 容忍无前缀 <oMath>");
    assert(omml.hasOmmlMath("<M:OMATH>" + run("x") + "</M:OMATH>"), "hasOmmlMath 大小写不敏感");
    assert(omml.hasOmmlMath("<m:oMathPara/>"), "hasOmmlMath 检出自闭合 <m:oMathPara/>");
    assert(!omml.hasOmmlMath("<p>这里没有公式</p>"), "纯文本不误报");
    assert(!omml.hasOmmlMath("<math><mi>x</mi></math>"), "原生 MathML 不误报");
    assert(!omml.hasOmmlMath('<m:oMathPr m:val="1"/>'), "属性节点 oMathPr 不误报");

    const omathEl = bodyOf(om(run("x"))).firstElementChild;
    assert(omml.isOmmlElement(omathEl), "isOmmlElement 认出 HTML 解析后的 oMath");
    assert(omathEl.tagName.toLowerCase() === "m:omath", "HTML 解析把 tagName 变大写仍能识别", omathEl.tagName);
    assert(omml.isOmmlElement(bodyOf("<m:oMathPara><m:oMath>" + run("x") + "</m:oMath></m:oMathPara>").firstElementChild),
        "isOmmlElement 认出 oMathPara");
    assert(!omml.isOmmlElement(omathEl.firstElementChild), "isOmmlElement 拒绝 <m:r>");
    assert(!omml.isOmmlElement(null), "isOmmlElement 对 null 返回 false");

    console.log("== 2. 文本运行 m:r / m:t 与转义 ==");
    assert(convertOne(om(run("x") + run("+") + run("1"))) === "x+1", "多段 run 顺序拼接");
    assert(convertOne(om(run("a_b"))) === "a\\_b", "下划线转义");
    assert(convertOne(om(run("50%"))) === "50\\%", "百分号转义");
    assert(convertOne(om(run("{k}"))) === "\\{k\\}", "花括号转义");
    assert(convertOne(om(run("#1 &amp; $2"))) === "\\#1\\ \\&\\ \\$2", "# & $ 转义且保留空格");
    assert(convertOne(om(run("a b"))) === "a\\ b", "空格换成 LaTeX 空格");
    assert(convertOne(om(run("a^b"))) === "a\\text{\\textasciicircum}b", "尖号转义");
    assert(convertOne(om(run("x~y"))) === "x\\text{\\textasciitilde}y", "波浪号转义");
    assert(convertOne(om(run("a\\b"))) === "a\\backslash b", "反斜杠转义");
    assert(convertOne(om(run("x×y"))) === "x\\times y", "× 转 \\times");
    assert(convertOne(om(run("a−b"))) === "a-b", "Unicode 减号转 -");
    katexValid(convertOne(om(run("a_b^c 50%"))), "转义后的文本");
    katexValid(convertOne(om(run("x×y≤z"))), "符号映射后的文本");

    console.log("== 3. 分式 m:f ==");
    const frac = om(part("f", part("num", run("a")) + part("den", run("b"))));
    assert(convertOne(frac) === "\\frac{a}{b}", "普通分式 → \\frac");
    katexValid(convertOne(frac), "普通分式");
    const noBar = om(part("f", part("fPr", '<m:type m:val="noBar"/>') + part("num", run("n")) + part("den", run("k"))));
    assert(convertOne(noBar) === "\\genfrac{}{}{0pt}{}{n}{k}", "无横线分式（noBar）→ \\genfrac");
    katexValid(convertOne(noBar), "无横线分式");

    console.log("== 4. 上下标 m:sSup / m:sSub / m:sSubSup ==");
    const sup = om(part("sSup", e(run("x")) + part("sup", run("2"))));
    assert(convertOne(sup) === "{x}^{2}", "m:sSup → {x}^{2}");
    katexValid(convertOne(sup), "m:sSup");
    const sub = om(part("sSub", e(run("a")) + part("sub", run("i"))));
    assert(convertOne(sub) === "{a}_{i}", "m:sSub → {a}_{i}");
    const subSup = om(part("sSubSup", e(run("x")) + part("sub", run("i")) + part("sup", run("2"))));
    assert(convertOne(subSup) === "{x}_{i}^{2}", "m:sSubSup → {x}_{i}^{2}");
    katexValid(convertOne(subSup), "m:sSubSup");
    const paraEl = bodyOf("<m:oMathPara><m:oMath>" +
        part("sSup", e(run("E")) + part("sup", run("2"))) + "</m:oMath></m:oMathPara>").firstElementChild;
    assert(omml.convertOmmlElement(paraEl) === "{E}^{2}", "m:oMathPara 可直接转换（块级公式）");

    console.log("== 5. 根式 m:rad ==");
    const sqrtPlain = om(part("rad", part("radPr", '<m:degHide m:val="1"/>') + part("e", run("x"))));
    assert(convertOne(sqrtPlain) === "\\sqrt{x}", "m:rad 隐藏次数 → \\sqrt");
    katexValid(convertOne(sqrtPlain), "m:rad 平方根");
    const sqrtDeg = om(part("rad", part("deg", run("3")) + part("e", run("x"))));
    assert(convertOne(sqrtDeg) === "\\sqrt[3]{x}", "m:rad 带 m:deg → \\sqrt[3]");
    katexValid(convertOne(sqrtDeg), "m:rad 立方根");
    // Word 最常见的平方根：degHide=1 + 空 <m:deg/>（HTML 解析会把后面的 m:e 吞进 deg 里）
    const wordSqrt = '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr>' +
        '<m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>';
    assert(convertOne(wordSqrt) === "\\sqrt{x}", "Word 平方根（degHide=1 + 空 m:deg）→ \\sqrt{x}");
    katexValid(convertOne(wordSqrt), "Word 平方根");
    const sqrtEmptyDeg = om(part("rad", part("radPr", '<m:degHide m:val="1"/>') + "<m:deg/>" + e(run("x"))));
    assert(convertOne(sqrtEmptyDeg) === "\\sqrt{x}", "空 m:deg 不会被当成次数");
    const sqrtNoHide = om(part("rad", "<m:deg/>" + e(run("x"))));
    assert(convertOne(sqrtNoHide) === "\\sqrt{x}", "没有 degHide 时空 m:deg 也按平方根处理");
    const sqrtRealDeg = om(part("rad", part("deg", e(run("3"))) + e(run("x"))));
    assert(convertOne(sqrtRealDeg) === "\\sqrt[3]{x}", "m:deg 里确实有 m:e 时才算次数");

    console.log("== 6. 大运算符 m:nary ==");
    const sum = om(part("nary", part("naryPr", '<m:chr m:val="∑"/>') + part("sub", run("i=1")) +
        part("sup", run("n")) + e(run("i"))));
    assert(convertOne(sum) === "\\sum_{i=1}^{n} i", "m:nary 求和 → \\sum 带上限");
    katexValid(convertOne(sum), "m:nary 求和");
    const integral = om(part("nary", part("sub", run("0")) + part("sup", run("1")) + e(run("x"))));
    assert(convertOne(integral) === "\\int_{0}^{1} x", "m:nary 无 chr 默认积分");
    katexValid(convertOne(integral), "m:nary 默认积分");

    console.log("== 7. 括号 m:d ==");
    const paren = om(part("d", e(run("a")) + e(run("b"))));
    assert(convertOne(paren) === "\\left(a | b\\right)", "m:d 默认圆括号 + 竖线分隔");
    katexValid(convertOne(paren), "m:d 默认圆括号");
    const bracket = om(part("d", part("dPr", '<m:begChr m:val="["/><m:endChr m:val="]"/>') + e(run("x"))));
    assert(convertOne(bracket) === "\\left[x\\right]", "m:dPr 自定义 [ ]");
    const brace = om(part("d", part("dPr", '<m:begChr m:val="{"/><m:endChr m:val="}"/>') + e(run("x"))));
    assert(convertOne(brace) === "\\left\\{x\\right\\}", "定界符花括号自动转义");
    katexValid(convertOne(brace), "m:d 花括号");

    console.log("== 8. 函数 m:func ==");
    const sin = om(part("func", part("fName", run("sin")) + e(part("d", e(run("x"))))));
    assert(convertOne(sin) === "\\sin \\left(x\\right)", "已知函数名 → \\sin");
    katexValid(convertOne(sin), "m:func sin");
    const rank = om(part("func", part("fName", run("rank")) + e(run("A"))));
    assert(convertOne(rank) === "\\operatorname{rank} A", "未知函数名 → \\operatorname");
    katexValid(convertOne(rank), "m:func rank");

    console.log("== 9. 重音 m:acc / 上下划线 m:bar ==");
    const hat = om(part("acc", e(run("x"))));
    assert(convertOne(hat) === "\\hat{x}", "m:acc 默认 ^ → \\hat");
    katexValid(convertOne(hat), "m:acc 默认");
    const tilde = om(part("acc", part("accPr", '<m:chr m:val="~"/>') + e(run("x"))));
    assert(convertOne(tilde) === "\\tilde{x}", "m:accPr chr=~ → \\tilde");
    const over = om(part("bar", e(run("AB"))));
    assert(convertOne(over) === "\\overline{AB}", "m:bar 默认在上 → \\overline");
    katexValid(convertOne(over), "m:bar 上划线");
    const under = om(part("bar", part("barPr", '<m:pos m:val="bot"/>') + e(run("AB"))));
    assert(convertOne(under) === "\\underline{AB}", "m:barPr pos=bot → \\underline");

    console.log("== 10. 上下极限 m:limLow / m:limUpp ==");
    const limLow = om(part("limLow", e(run("lim")) + part("lim", run("x→0"))));
    assert(convertOne(limLow) === "\\lim_{x\\to 0}", "m:limLow + lim → \\lim_{...}");
    katexValid(convertOne(limLow), "m:limLow lim");
    const limUpp = om(part("limUpp", e(run("x")) + part("lim", run("2"))));
    assert(convertOne(limUpp) === "\\overset{2}{x}", "m:limUpp 非算符 → \\overset");
    katexValid(convertOne(limUpp), "m:limUpp");
    const limGeneric = om(part("limLow", e(run("f")) + part("lim", run("n"))));
    assert(convertOne(limGeneric) === "\\underset{n}{f}", "m:limLow 非算符 → \\underset");

    console.log("== 11. 矩阵 m:m / m:mr ==");
    const matrix = om(part("m", part("mr", e(run("a")) + e(run("b"))) + part("mr", e(run("c")) + e(run("d")))));
    assert(convertOne(matrix) === "\\begin{matrix} a & b \\\\ c & d \\end{matrix}", "2×2 矩阵 → matrix 环境");
    katexValid(convertOne(matrix), "m:m 矩阵");

    console.log("== 12. 方程组 m:eqArr ==");
    const eqArr = om(part("eqArr", e(run("x=1")) + e(run("y=2"))));
    assert(convertOne(eqArr) === "\\begin{aligned} x=1 \\\\ y=2 \\end{aligned}", "m:eqArr → aligned 环境");
    katexValid(convertOne(eqArr), "m:eqArr 方程组");

    console.log("== 13. 方框 m:box / m:borderBox ==");
    const box = om(part("box", e(run("E=mc2"))));
    assert(convertOne(box) === "\\boxed{E=mc2}", "m:box → \\boxed");
    const borderBox = om(part("borderBox", e(run("x"))));
    assert(convertOne(borderBox) === "\\boxed{x}", "m:borderBox → \\boxed");
    katexValid(convertOne(box), "m:box");

    console.log("== 14. 组合括号 m:groupChr ==");
    const groupUnder = om(part("groupChr", part("groupChrPr", '<m:chr m:val="⏟"/><m:pos m:val="bot"/>') + e(run("a+b"))));
    assert(convertOne(groupUnder) === "\\underbrace{a+b}", "m:groupChr 下花括号 → \\underbrace");
    katexValid(convertOne(groupUnder), "m:groupChr");
    const groupOver = om(part("groupChr", part("groupChrPr", '<m:chr m:val="⏞"/><m:pos m:val="top"/>') + e(run("a+b"))));
    assert(convertOne(groupOver) === "\\overbrace{a+b}", "m:groupChr 上花括号 → \\overbrace");

    console.log("== 15. HTML 自闭合属性吞并兄弟节点的救援 ==");
    assert(convertOne(om(part("f", "<m:fPr/>" + part("num", run("a")) + part("den", run("b"))))) === "\\frac{a}{b}",
        "自闭合 m:fPr 吞掉 m:num/m:den 后仍能取回");
    assert(convertOne(om(part("acc", "<m:accPr/>" + e(run("x"))))) === "\\hat{x}",
        "自闭合 m:accPr 吞掉 m:e 后仍能取回");
    assert(convertOne(om(part("nary", "<m:naryPr/>" + part("sub", run("0")) + part("sup", run("1")) + e(run("x"))))) ===
        "\\int_{0}^{1} x", "自闭合 m:naryPr 吞掉上下限后仍能取回");
    assert(convertOne(om(part("sSup", "<m:sSupPr/>" + e(run("x")) + part("sup", run("2"))))) === "{x}^{2}",
        "自闭合 m:sSupPr 吞掉 m:e 后仍能取回");

    console.log("== 16. 降级与健壮性 ==");
    assert(convertOne(om("<m:unknown>" + run("k") + "</m:unknown>")) === "k", "未知结构降级为子内容拼接");
    assert(convertOne(om(part("f", part("num", run("a"))))) === "\\frac{a}{}", "缺 m:den 不抛异常");
    assert(convertOne(om("")) === null, "空 oMath 返回 null");
    assert(omml.convertOmmlElement(bodyOf("<p>纯文本</p>").firstElementChild) === null, "非 OMML 元素返回 null");
    assert(omml.convertOmmlElement(null) === null, "null 输入返回 null");
    assert(convertOne(om(run("a$b"))) === "a\\$b", "字面 $ 被转义");
    assert(!convertOne(om(run("x"))).includes("$"), "输出不带 $ 定界符");

    console.log("== 17. Word 片段：正文 + 行内/独立公式混排 ==");
    const fixture = fs.readFileSync(path.join(__dirname, "fixtures/web/word-omml.html"), "utf8");
    assert(omml.hasOmmlMath(fixture), "hasOmmlMath 检出 Word 片段");
    const doc = new DOMParser().parseFromString(fixture, "text/html");
    const tops = [...doc.querySelectorAll("*")].filter((el) => omml.isOmmlElement(el) && !hasOmmlAncestor(el));
    assert(tops.length === 6, "片段里 6 个公式节点（实际 " + tops.length + "）");
    const latexes = tops.map((el) => omml.convertOmmlElement(el));
    assert(latexes.every((latex) => typeof latex === "string" && latex.length > 0),
        "每个公式都转换出非空 LaTeX", JSON.stringify(latexes));
    latexes.forEach((latex, i) => katexValid(latex, "片段公式 #" + (i + 1)));
    assert(latexes.some((latex) => latex.startsWith("x=\\frac{-b\\pm \\sqrt{{b}^{2}-4ac}}{2a}")),
        "求根公式结构正确", JSON.stringify(latexes));

    const mixed = renderLike(doc.body);
    assert(mixed.includes("设函数") && mixed.includes("为已知函数"), "中文正文保留", mixed.slice(0, 200));
    assert(mixed.includes("求根公式为") && mixed.includes("等差数列求和"), "公式前后的段落文字保留");
    assert(!/m:oMath/i.test(mixed), "输出里没有 OMML 残留");
    const blocks = [...mixed.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => m[1]);
    const rest = mixed.replace(/\$\$[\s\S]+?\$\$/g, "");
    const inlines = [...rest.matchAll(/\$([^$\n]+?)\$/g)].map((m) => m[1]);
    assert(blocks.length === 2, "2 个独立公式用 $$ 包裹（实际 " + blocks.length + "）");
    assert(inlines.length === 4, "4 个行内公式用 $ 包裹（实际 " + inlines.length + "）");
    blocks.concat(inlines).forEach((src, i) => katexValid(src, "混排公式 #" + (i + 1)));

    console.log("\n结果: " + passed + " 通过, " + failed + " 失败");
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
