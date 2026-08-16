/**
 * 无头测试：直接验证修复逻辑 + 用 KaTeX 校验修复后的公式可解析。
 * 运行：npm test（需要先 npm install）
 */
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const katex = require("katex");

const root = path.join(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(cond, name, extra) {
    if (cond) {
        passed++;
        console.log("  ✓", name);
    } else {
        failed++;
        console.error("  ✗", name, extra ? "\n    " + extra : "");
    }
}

function contains(haystack, needle, name) {
    assert(haystack.includes(needle), name, `期望包含: ${needle}\n实际: ${haystack}`);
}

function notContains(haystack, needle, name) {
    assert(!haystack.includes(needle), name, `期望不包含: ${needle}\n实际: ${haystack}`);
}

async function main() {
    // 编译源码（fix-latex.ts 无外部依赖）
    await esbuild.build({
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true,
        format: "cjs",
        platform: "node",
        outfile: path.join(__dirname, "_fix-latex.cjs"),
        logLevel: "silent",
    });
    const { fixLatexText } = require("./_fix-latex.cjs");

    console.log("\n== 1. 各类损坏模式 ==");

    // 1a. 裸 [ ... ] 块 → $$ ... $$
    let out = fixLatexText("[ y=Wx ]");
    contains(out, "$$", "裸 [ y=Wx ] 单行等号转块级");
    out = fixLatexText("[\n\\frac{\\partial L}{\\partial y}\n]");
    contains(out, "$$\n\\frac{\\partial L}{\\partial y}\n$$", "裸多行公式转块级");
    out = fixLatexText("[\\boxed{a=x,\\qquad b=\\frac{\\partial L}{\\partial y}}]");
    contains(out, "$$\n\\boxed{a=x,\\qquad b=\\frac{\\partial L}{\\partial y}}\n$$", "boxed 单行转块级");
    out = fixLatexText("[\nz_1,z_2,z_3\n]");
    contains(out, "$$", "多行上下标转块级");

    // 1b. \[ \] 与 \( \)
    out = fixLatexText("公式 \\[ E=mc^2 \\] 结束");
    contains(out, "$$\nE=mc^2\n$$", "\\[ \\] 转 $$");
    out = fixLatexText("行内 \\( a_i \\) 公式");
    contains(out, "$a_i$", "\\( \\) 转 $ $");

    // 1c. 数学区域内修复
    out = fixLatexText("$$\\underbrace{x}_*{a_j}$$");
    contains(out, "\\underbrace{x}_{a_j}", "*{ 下标修复");
    out = fixLatexText("$$\\underbrace{x}_\\*{a_j}$$");
    contains(out, "\\underbrace{x}_{a_j}", "\\*{ 下标修复");
    out = fixLatexText("$$\n\\begin{bmatrix}\n1&2\\\\\n3&4\n\\end{bmatrix}\n$$");
    contains(out, "\\\\", "已有 \\\\ 不被破坏");
    out = fixLatexText("$$\n\\begin{bmatrix}\n2\\3\\4\n\\end{bmatrix}\n$$");
    contains(out, "2\\\\3\\\\4", "行内 \\数字 补成 \\\\");
    out = fixLatexText("$$\nx\n==========\n\ny\n$$");
    contains(out.replace(/\s+/g, " "), "x = y", "==== 碎片行恢复为等号");
    out = fixLatexText("$$\n\\frac{a}{b}\n----------\n$$");
    notContains(out, "----", "---- 分割线删除");
    out = fixLatexText("$ x $");
    contains(out, "$x$", "行内公式边界空格清理");
    out = fixLatexText("$ a_i $");
    contains(out, "$a_i$", "带下标的边界空格清理");

    console.log("\n== 1d. 括号包裹的行内公式 ( ... ) ==");
    out = fixLatexText("每个参数 (W_{ij}) 只控制");
    contains(out, "$(W_{ij})$", "(W_{ij}) 转行内公式");
    out = fixLatexText("里 (x_j) 那一项");
    contains(out, "$(x_j)$", "(x_j) 转行内公式");
    out = fixLatexText("从这些 (a_t, b_t) 去算");
    contains(out, "$(a_t, b_t)$", "(a_t, b_t) 带空格也转");
    out = fixLatexText("由两个 (a_r^{(z)}) 向量决定");
    contains(out, "$(a_r^{(z)})$", "(a_r^{(z)}) 嵌套上下标转");
    out = fixLatexText("保存一个 (2\\times3=6) 个数的矩阵");
    contains(out, "$(2\\times3=6)$", "(2\\times3=6) 含命令转");
    out = fixLatexText("知道 (a,b) 就能知道梯度");
    assert(out === "知道 (a,b) 就能知道梯度", "(a,b) 无特征保持文本");
    out = fixLatexText("一整个 sequence 有 (T) 个 token");
    assert(out === "一整个 sequence 有 (T) 个 token", "(T) 保持文本");
    out = fixLatexText("英文 (see Fig. 1) 和 (e.g.) 不动");
    assert(out === "英文 (see Fig. 1) 和 (e.g.) 不动", "英文短语括号不动");
    out = fixLatexText("中文 (注意) 说明");
    assert(out === "中文 (注意) 说明", "中文括号不动");
    out = fixLatexText("函数调用 f(x_i) 和索引 arr(i,j) 不动");
    assert(out === "函数调用 f(x_i) 和索引 arr(i,j) 不动", "函数调用/索引不动");
    out = fixLatexText("\\left(W_{ij}\\right) 保持原样");
    assert(out === "\\left(W_{ij}\\right) 保持原样", "\\left( \\right) 不动");
    out = fixLatexText("链接 [说明](https://example.com) 不动");
    assert(out === "链接 [说明](https://example.com) 不动", "Markdown 链接不动");

    console.log("\n== 1e. Markdown 转义损坏（\\\\命令、\\= \\_ \\^、# [） ==");
    out = fixLatexText("[ y\\=Wx ]");
    contains(out, "$$\ny=Wx\n$$", "[ y\\=Wx ] 转义等号还原");
    out = fixLatexText("(W\\_{ij})");
    contains(out, "$(W_{ij})$", "(W\\_{ij}) 转义下标还原");
    out = fixLatexText("[ \\\\frac{a}{b} ]");
    contains(out, "$$\n\\frac{a}{b}\n$$", "\\\\frac 双反斜杠折叠");
    out = fixLatexText("$$a\\^\\\\top$$");
    contains(out, "$$a^\\top$$", "\\^\\\\top 转义还原");
    out = fixLatexText("$$R\\^{4096}$$");
    contains(out, "$$R^{4096}$$", "R\\^{4096} 花括号转义还原");
    out = fixLatexText("# [x\\=1]");
    contains(out, "$$\nx=1\n$$", "# 标题残留清除");
    out = fixLatexText("$$\\\\frac{1}{2} + \\\\sqrt{x}$$");
    contains(out, "$$\\frac{1}{2} + \\sqrt{x}$$", "多命令折叠");
    out = fixLatexText("$$\\begin{bmatrix} 1&2 \\\\ 3&4 \\end{bmatrix}$$");
    contains(out, "\\\\", "真实 \\\\ 行分隔不被折叠");

    console.log("\n== 2. 普通文本必须原样返回 ==");
    const prose = "价格 $5 and $10，链接 [说明](https://example.com)，数组 [2,3,4]，脚本 awk '{print $1}' 正常。";
    out = fixLatexText(prose);
    assert(out === prose, "价格/链接/数组/代码全部不动");

    console.log("\n== 3. 代码围栏不处理 ==");
    const fenced = "```\n$x$ 和 $$y$$ 是代码\n```\n正文 $x$";
    out = fixLatexText(fenced);
    contains(out, "```\n$x$ 和 $$y$$ 是代码\n```", "围栏内容原样");
    contains(out, "正文 $x$", "围栏外正常处理");

    console.log("\n== 4. 原始 Ghost 文档集成测试 ==");
    const original = fs.readFileSync(path.join(__dirname, "fixtures/ghost-original.txt"), "utf8");
    const fixed = fixLatexText(original);

    // 关键修复点断言
    contains(fixed, "$$\ny=Wx\n$$", "y=Wx 修复");
    contains(fixed, "_{b_i}", "下标记号修复");
    contains(fixed, "2\\\\3\\\\4", "挤行矩阵修复");
    contains(fixed, "b_1a_1 & b_1a_2 &\\cdots\\\\", "矩阵行尾补反斜杠");
    notContains(fixed, "==========", "等号碎片行全部处理");

    // KaTeX 校验全部公式
    const blocks = [...fixed.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => m[1].trim());
    const inlineSrc = fixed.replace(/\$\$[\s\S]+?\$\$/g, "");
    const inlines = [...inlineSrc.matchAll(/\$([^$\n]+?)\$/g)].map((m) => m[1]);
    let katexErrors = 0;
    [...blocks, ...inlines].forEach((src, i) => {
        try {
            katex.renderToString(src, { throwOnError: true });
        } catch (e) {
            katexErrors++;
            console.error("    KaTeX 报错 #" + i + ": " + src.slice(0, 80) + "\n    -> " + e.message);
        }
    });
    assert(katexErrors === 0, `全部 ${blocks.length} 块 + ${inlines.length} 行内公式 KaTeX 可解析`);

    // 输出修复结果供人工检查
    fs.writeFileSync(path.join(__dirname, "fixtures/ghost-fixed.txt"), fixed);

    console.log("\n== 5. 括号版 Ghost 文档集成测试（用户反馈不能转换的文本） ==");
    const original2 = fs.readFileSync(path.join(__dirname, "fixtures/ghost2-original.txt"), "utf8");
    const fixed2 = fixLatexText(original2);

    contains(fixed2, "$(W_{ij})$", "(W_{ij}) 修复");
    contains(fixed2, "$$\ny_i\n$$", "y_i 方括号修复");
    contains(fixed2, "$(x_j)$", "(x_j) 修复");
    contains(fixed2, "$(a_t,b_t)$", "(a_t,b_t) 修复");
    contains(fixed2, "\\mathbb R^{4096}", "mathbb 修复");
    contains(fixed2, "$$\nW:4096\\times4096\n$$", "W:4096x4096 方括号修复");
    notContains(fixed2, "$(a,b)$", "(a,b) 保持文本");
    notContains(fixed2, "$(i,j)$", "(i,j) 保持文本");

    const blocks2 = [...fixed2.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => m[1].trim());
    const inlineSrc2 = fixed2.replace(/\$\$[\s\S]+?\$\$/g, "");
    const inlines2 = [...inlineSrc2.matchAll(/\$([^$\n]+?)\$/g)].map((m) => m[1]);
    let katexErrors2 = 0;
    [...blocks2, ...inlines2].forEach((src, i) => {
        try {
            katex.renderToString(src, { throwOnError: true });
        } catch (e) {
            katexErrors2++;
            console.error("    KaTeX 报错 #" + i + ": " + src.slice(0, 80) + "\n    -> " + e.message);
        }
    });
    assert(katexErrors2 === 0, `全部 ${blocks2.length} 块 + ${inlines2.length} 行内公式 KaTeX 可解析`);
    fs.writeFileSync(path.join(__dirname, "fixtures/ghost2-fixed.txt"), fixed2);

    console.log("\n== 6. 转义版 Ghost 文档集成测试（Markdown 转义损坏） ==");
    const original3 = fs.readFileSync(path.join(__dirname, "fixtures/ghost3-escaped.txt"), "utf8");
    const fixed3 = fixLatexText(original3);

    contains(fixed3, "$$\ny=Wx\n$$", "y\\=Wx 修复");
    contains(fixed3, "$(W_{ij})$", "(W\\_{ij}) 修复");
    contains(fixed3, "\\frac{\\partial L}{\\partial W_{ij}} = ", "链式法则转义还原");
    contains(fixed3, "\\sum_{t=1}^{T}b_ta_t^\\top", "求和公式转义还原");
    contains(fixed3, "\\nabla_WL=ba^\\top", "boxed 公式还原");
    contains(fixed3, "R^{4096}", "R\\^{4096} 还原");
    notContains(fixed3, "# [", "标题残留 # 清除");
    notContains(fixed3, "\\\\frac", "双反斜杠全部折叠");
    notContains(fixed3, "\\=", "等号转义全部清除");

    const blocks3 = [...fixed3.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => m[1].trim());
    const inlineSrc3 = fixed3.replace(/\$\$[\s\S]+?\$\$/g, "");
    const inlines3 = [...inlineSrc3.matchAll(/\$([^$\n]+?)\$/g)].map((m) => m[1]);
    let katexErrors3 = 0;
    [...blocks3, ...inlines3].forEach((src, i) => {
        try {
            katex.renderToString(src, { throwOnError: true });
        } catch (e) {
            katexErrors3++;
            console.error("    KaTeX 报错 #" + i + ": " + src.slice(0, 80) + "\n    -> " + e.message);
        }
    });
    assert(katexErrors3 === 0, `全部 ${blocks3.length} 块 + ${inlines3.length} 行内公式 KaTeX 可解析`);
    fs.writeFileSync(path.join(__dirname, "fixtures/ghost3-fixed.txt"), fixed3);

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
