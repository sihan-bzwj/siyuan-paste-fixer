/**
 * 真实用户案例回归测试：样本全部来自网上真实反馈
 * （思源 GitHub issues / 论坛 / OpenAI 社区 / Obsidian 论坛）。
 * 每个样本先经 fixLatexText，再对产出的公式做 KaTeX 严格解析。
 * 运行：node test/realworld-cases.cjs
 */
const path = require("path");
const esbuild = require("esbuild");
const katex = require("katex");

const root = path.join(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(cond, name, extra) {
    if (cond) { passed++; console.log("  ✓", name); }
    else { failed++; console.error("  ✗", name, extra ? "\n    " + String(extra).slice(0, 400) : ""); }
}
function contains(h, n, name) {
    assert(h.includes(n), name, `期望包含: ${n}\n实际: ${h.slice(0, 300)}`);
}
function notContains(h, n, name) {
    assert(!h.includes(n), name, `期望不包含: ${n}\n实际: ${h.slice(0, 300)}`);
}
function unchanged(out, input, name) {
    assert(out === input, name, `期望原样\n输入: ${input.slice(0, 150)}\n输出: ${out.slice(0, 150)}`);
}
function katexOK(text, name) {
    const blocks = [...text.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => m[1].trim());
    const rest = text.replace(/\$\$[\s\S]+?\$\$/g, "");
    const inlines = [...rest.matchAll(/\$([^$\n]+?)\$/g)].map((m) => m[1]);
    let errs = 0;
    blocks.forEach((src, i) => {
        try { katex.renderToString(src, { displayMode: true, throwOnError: true }); }
        catch (e) { errs++; console.error("    KaTeX 报错 块#" + i + ": " + src.slice(0, 100) + " -> " + e.message); }
    });
    inlines.forEach((src, i) => {
        try { katex.renderToString(src, { throwOnError: true }); }
        catch (e) { errs++; console.error("    KaTeX 报错 行内#" + i + ": " + src.slice(0, 100) + " -> " + e.message); }
    });
    assert(errs === 0, name + `（${blocks.length} 块 + ${inlines.length} 行内全部可解析）`);
}

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_fix-latex.cjs"), logLevel: "silent",
    });
    const { fixLatexText } = require("./_fix-latex.cjs");

    console.log("== 1. ChatGPT 复制按钮输出（OpenAI 社区） ==");
    const chatgpt = "## This is the title\nHere below is a block equation:\n\\[\nE = mc^2\n\\]\nand this is an online equation: \\( f(x) \\).";
    let out = fixLatexText(chatgpt);
    contains(out, "$$\nE = mc^2\n$$", "\\[ \\] 转块级");
    contains(out, "$f(x)$", "\\( \\) 转行内");
    katexOK(out, "ChatGPT 复制按钮样例");

    console.log("== 2. Obsidian 论坛 ChatGPT 复杂块公式 ==");
    const obsidian = "$$ \\text{deflection} = \\frac{W \\cdot \\lambda^3}{4 \\cdot EI} \\left( e^{-\\frac{a-a}{\\lambda}} \\left( \\cos\\left(\\frac{a-a}{\\lambda}\\right) + \\sin\\left(\\frac{a-a}{\\lambda}\\right) \\right) + e^{-\\frac{a}{\\lambda}} \\left( \\cos\\left(\\frac{a}{\\lambda}\\right) + \\sin\\left(\\frac{a}{\\lambda}\\right) \\right) \\right) $$";
    out = fixLatexText(obsidian);
    unchanged(out, obsidian, "合法 $$ 块不被改动");
    katexOK(out, "Obsidian 复杂公式");

    console.log("== 3. DeepSeek 完整回复（思源 issue #15323） ==");
    const deepseek = [
        "### 1. **均匀分布（Uniform Distribution）**",
        "   **参数**：\\(a\\)（下限），\\(b\\)（上限）",
        "   **CDF**：",
        "   $$",
        "   F(x) = ",
        "   \\begin{cases} ",
        "   0 & \\text{if } x < a \\\\",
        "   \\dfrac{x - a}{b - a} & \\text{if } a \\leq x \\leq b \\\\",
        "   1 & \\text{if } x > b",
        "   \\end{cases}",
        "   $$",
        "   其中 \\(\\Phi(x) = \\frac{1}{\\sqrt{2\\pi}} \\int_{-\\infty}^{x} e^{-t^2/2} dt\\) 无闭合解。",
        "   所有 CDF 均满足 \\(\\lim_{x \\to -\\infty} F(x) = 0\\)。",
    ].join("\n");
    out = fixLatexText(deepseek);
    contains(out, "$a$", "行内参数 \\(a\\) 转 $a$");
    contains(out, "\\begin{cases}", "cases 环境保留");
    contains(out, "\\\\", "矩阵换行反斜杠保留");
    contains(out, "$\\Phi(x) = \\frac{1}{\\sqrt{2\\pi}} \\int_{-\\infty}^{x} e^{-t^2/2} dt$", "行内积分公式完整");
    notContains(out, "&amp;", "无 HTML 实体残留");
    katexOK(out, "DeepSeek 完整回复");

    console.log("== 4. ChatGPT \\[ \\] 反斜杠丢失成裸方括号（思源 issue #17771） ==");
    const smote = "比如两个少数类样本：\n[\nx_1, x_2\n]\nSMOTE 会在它们之间生成新点：\n[\nx_{new} = x_1 + r(x_2 - x_1)\n]";
    out = fixLatexText(smote);
    contains(out, "$$", "裸方括号转块级");
    contains(out, "x_{new} = x_1 + r(x_2 - x_1)", "第二个块内容完整");
    katexOK(out, "SMOTE 样例");

    console.log("== 5. QQ 粘贴 $^$^ 序列（思源 issue #8289） ==");
    const qq = "Indeed, if $a^r=a^s$ with $0 \\leqq r, s \\leqq d-1$, and say $r \\leqq s$, then $a^{s-r}=$ $e$. Since $0 \\leqq s-r<d$ we must have $s-r=0$.";
    out = fixLatexText(qq);
    unchanged(out, qq, "$^$ 相邻序列不损坏");
    assert(!out.includes("$$$"), "$ $ 空内容不收拢成 $$", out);
    katexOK(out, "QQ 数学段落");

    console.log("== 6. 文心一言/豆包 Ramsey 句（issue #12725 / ld246） ==");
    const ramsey = "利用数学归纳法+Ramsey数递推关系即可，注意到$ R(k,l)\\leq R(k-1,l)+R(k,l-1)\\leq C_{k+l-3}^{k-2}+ C_{k+l-3}^{k-1} $，利用组合数的Pascal公式，得到 $C_{k+l-3}^{k-2}+ C_{k+l-3}^{k-1}=C_{k+l-2}^{k-1}$，得证。";
    out = fixLatexText(ramsey);
    contains(out, "$R(k,l)\\leq R(k-1,l)+R(k,l-1)\\leq C_{k+l-3}^{k-2}+ C_{k+l-3}^{k-1}$", "带空格公式收拢边界");
    contains(out, "$C_{k+l-3}^{k-2}+ C_{k+l-3}^{k-1}=C_{k+l-2}^{k-1}$", "紧凑公式保留");
    katexOK(out, "Ramsey 句");

    console.log("== 7. ima 双反斜杠（ld246：\\vec 变成 \\\\vec） ==");
    out = fixLatexText("$\\\\vec{i},\\\\vec{j}$");
    assert(out === "$\\vec{i},\\vec{j}$", "\\\\vec 折叠为 \\vec", out);

    console.log("== 8. 崩溃句（ld246 1729416753114：\\displaystyle + 双重积分） ==");
    const crash = "综上，对于任意 $\\displaystyle a\\le b$ ,有 $\\displaystyle F\\left(b\\right)\\le 0$ .即 $\\displaystyle 2+\\int_{a-b}^{b-a}\\int_{0}^{x}g\\left(t\\right) \\text{d}t \\text{d}x\\le {e}^{b-a}+{e}^{a-b}$ . 选 $\\displaystyle B$";
    out = fixLatexText(crash);
    unchanged(out, crash, "合法行内公式整段原样");
    katexOK(out, "崩溃句样例");

    console.log("== 9. 公众号 aligned 公式（issue #540，&amp; 对齐） ==");
    const aligned = "$$ \\begin{aligned} \\sum y_i = & \\sum\\beta_0 + \\sum\\beta_1 i + \\sum \\beta_2 i^2 + \\sum d_i \\\\ & + \\beta_1 \\frac{1}{2} n (n+1) \\end{aligned} $$";
    out = fixLatexText(aligned);
    katexOK(out, "aligned 公式");

    console.log("== 10. 长公式 array（issue #18496） ==");
    const longArr = "$$ \\begin{array}{l} -M_{-g}\\left(\\frac{\\mathrm{d}}{\\mathrm{d} t} \\sigma(t)\\right)\\left(\\frac{\\mathrm{d}}{\\mathrm{d} t} v(t)-\\frac{v(t)\\left(\\frac{\\mathrm{d}}{\\mathrm{d} t} \\sigma(t)\\right)}{1-\\sigma(t)}\\right) s(t)+M_{-} g(1-\\sigma(t))\\left(\\frac{\\mathrm{d}^{2}}{\\mathrm{~d} t^{2}} v(t)\\right) s(t) \\end{array} $$";
    out = fixLatexText(longArr);
    katexOK(out, "长公式 array");

    console.log("== 11. 表格内 \\$ 转义（issue #17000，观察现状） ==");
    const table = "| 步骤 | 计算过程 |\n| 1 | \\$ n(\\text{NO}_2) = x\\ \\text{mol} \\$ |";
    out = fixLatexText(table);
    unchanged(out, table, "\\$ 转义保持原样（不主动去转义，防货币误伤）");

    console.log("== 12. 中文内嵌 $x_0$（issue #12178） ==");
    const x0 = "可通过某直线来近似某曲线在 $x_0$点及其附近的图像。";
    out = fixLatexText(x0);
    unchanged(out, x0, "中文内嵌行内公式原样");

    console.log("== 13. Gemini 货币 \\$100 保护 ==");
    out = fixLatexText("价格 \\$100 和 \\$200");
    unchanged(out, "价格 \\$100 和 \\$200", "\\$ 货币不误伤");

    console.log("== 14. 相邻紧凑公式（OI Wiki 实测泄漏场景） ==");
    out = fixLatexText("$A$$A_{i,i}$$I$$n$$n$");
    assert(!out.includes("\u0001"), "无占位符泄漏", out);
    assert(out === "$A$$A_{i,i}$$I$$n$$n$", "相邻公式不互相吞并", out);

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
