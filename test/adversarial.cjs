/**
 * v0.1.7 对抗性文本测试：保护非公式结构、修复完整公式，并验证幂等性。
 */
const path = require("path");
const esbuild = require("esbuild");
const katex = require("katex");

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
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_fix-latex.cjs"), logLevel: "silent",
    });
    delete require.cache[require.resolve("./_fix-latex.cjs")];
    const {fixLatexText} = require("./_fix-latex.cjs");

    const unchanged = [
        ["价格从 $5 涨到了 $10", "两处美元金额"],
        ["USD $5–$10", "美元范围"],
        ["总价为 $ 9.99", "带空格金额"],
        ["$HOME/bin", "Shell HOME"],
        ["$PATH", "Shell PATH"],
        ["${HOME}/code", "Shell 变量展开"],
        ["echo \"$USER\"", "Shell 引号变量"],
        ["PowerShell: $env:PATH", "PowerShell 环境变量"],
        ["C:\\Users\\(test)\\file", "Windows 路径"],
        ["/home/user/(test)/a", "Linux 路径"],
        ["function foo(x)", "函数调用"],
        ["(foo_bar)", "代码标识符"],
        ["(my_var_2)", "带数字标识符"],
        ["array[i]", "数组索引"],
        ["vector<vector<int>>", "C++ 模板"],
        ["[foo_bar]", "方括号标识符"],
        ["[[Page Name]]", "Wiki 链接"],
        ["[[2026-08-29]]", "日期 Wiki 链接"],
        ["(^_^)", "颜文字"],
        ["(╯°□°）╯︵ ┻━┻", "Unicode 颜文字"],
        ["版本 v1.2.3 (build_5)", "版本号"],
        ["RFC 3986 §3.2", "RFC 文本"],
        ["`$x$` 与 `\\(y\\)`", "行内代码"],
        ["`const s = \"$x$\";`", "代码字符串"],
        ["![plot_(x_i)](images/plot_(x_i).png)", "图片路径"],
        ["https://example.com?q=(x_i)&v=$HOME", "裸 URL"],
        ["[说明](https://example.com?q=(x_i))", "Markdown URL"],
        ["<https://example.com/(x_i)>", "自动链接"],
        ["\\$5", "转义美元"],
        ["$x\\_1$", "合法字面下划线"],
        ["$\\text{A\\&B}$", "合法 ampersand 转义"],
        ["正文 − – — × ≤ ∞", "正文 Unicode 逐字保留"],
        ["$x+\\(y\\)+z$", "外层美元混合定界符"],
        ["\\(x+$y$+z\\)", "外层反斜杠混合定界符"],
        ["$$x+\\(y\\)$$", "块级混合定界符"],
        ["$x+1", "未闭合左美元"],
        ["x+1$", "未闭合右美元"],
        ["$$\nx+1", "未闭合块美元"],
        ["\\(x+1", "未闭合行内反斜杠"],
        ["x+1\\)", "孤立右定界符"],
        ["\\[\nx+1", "未闭合块反斜杠"],
        ["\\begin{equation}\nx=1", "未闭合环境"],
    ];

    console.log("== A. 普通文本和不完整结构必须原样 ==");
    for (const [input, name] of unchanged) {
        const actual = fixLatexText(input);
        assert(actual === input, name, `输入: ${JSON.stringify(input)}\n实际: ${JSON.stringify(actual)}`);
    }

    const conversions = [
        ["这是 \\(x+1\\) 公式", "这是 $x+1$ 公式", "行内反斜杠定界符"],
        ["\\[(x+y)^2\\]", "$$\n(x+y)^2\n$$", "块级反斜杠定界符"],
        ["\\begin{math}x+y\\end{math}", "$x+y$", "math 环境"],
        ["\\begin{displaymath}x+y\\end{displaymath}", "$$\nx+y\n$$", "displaymath 环境"],
        ["\\begin{equation}E=mc^2\\end{equation}", "$$\nE=mc^2\n$$", "equation 环境"],
        ["\\begin{equation*}E=mc^2\\end{equation*}", "$$\nE=mc^2\n$$", "equation* 环境"],
        ["\\begin{align}a&=b\\\\c&=d\\end{align}", "$$\n\\begin{align}a&=b\\\\c&=d\\end{align}\n$$", "align 环境"],
        ["\\begin{gather}a=b\\\\c=d\\end{gather}", "$$\n\\begin{gather}a=b\\\\c=d\\end{gather}\n$$", "gather 环境"],
        ["\\begin{cases}x&=1\\\\y&=2\\end{cases}", "$$\n\\begin{cases}x&=1\\\\y&=2\\end{cases}\n$$", "cases 环境"],
        ["\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "$$\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\n$$", "矩阵环境"],
        ["前文 \\(x\\)，中间 \\(y\\)，结尾 \\(z\\)。", "前文 $x$，中间 $y$，结尾 $z$。", "相邻文本公式"],
        ["\\(x\\)\\(y\\)\\(z\\)", "$x$$y$$z$", "紧邻公式无占位符"],
        ["| 名称 | 公式 |\n|---|---|\n| 欧拉 | \\(e^{i\\pi}+1=0\\) |", "| 名称 | 公式 |\n|---|---|\n| 欧拉 | $e^{i\\pi}+1=0$ |", "Markdown 表格"],
        ["- 第一项 \\(x^2\\)\n  - 第二项 \\(y^2\\)", "- 第一项 $x^2$\n  - 第二项 $y^2$", "嵌套列表"],
        ["> 公式：\\[E=mc^2\\]", "> 公式：$$\nE=mc^2\n$$", "引用块"],
        ["# 标题 \\(O(n^2)\\)", "# 标题 $O(n^2)$", "标题公式"],
        ["[公式说明 \\(x+y\\)](https://example.com?q=(x_i))", "[公式说明 $x+y$](https://example.com?q=(x_i))", "链接文字公式"],
        ["\\(x\u200b+\u00a0y\\)", "$x+ y$", "数学区零宽与 NBSP"],
        ["$b\\_t+a\\^{2}$", "$b_t+a^{2}$", "上下标损伤修复"],
        ["$\\sum\\limits_{i=1}^{n}i$", "$\\sum\\limits_{i=1}^{n}i$", "limits 保留"],
        ["$\\left.\\frac{df}{dx}\\right|_{x=0}$", "$\\left.\\frac{df}{dx}\\right|_{x=0}$", "left right 保留"],
        ["$$\\substack{i=1\\\\j=2}$$", "$$\\substack{i=1\\\\j=2}$$", "substack 换行保留"],
    ];

    console.log("== B. 完整公式与 Markdown 结构转换 ==");
    for (const [input, expected, name] of conversions) {
        const actual = fixLatexText(input);
        assert(actual === expected, name, `期望: ${JSON.stringify(expected)}\n实际: ${JSON.stringify(actual)}`);
    }

    console.log("== C. 代码围栏、碰撞与性质测试 ==");
    const fences = [
        "````markdown\n```python\n$x$ 与 \\(y\\)\n```\n````",
        "~~~cpp\ncout << \"$x$\";\n~~~",
        "```cpp {1,3}\n$x$\n```",
        "```python\n$x$\n未闭合后 \\(y\\)",
    ];
    for (const [index, input] of fences.entries()) {
        assert(fixLatexText(input) === input, `代码围栏 ${index + 1}`);
    }

    const collision = "用户 token: \u0001PFB0:0\u0002，公式 \\(x\\)";
    const collisionOut = fixLatexText(collision);
    assert(collisionOut === "用户 token: \u0001PFB0:0\u0002，公式 $x$", "占位符碰撞保持用户正文");

    const deterministic = unchanged.map(([input]) => input)
        .concat(conversions.map(([input]) => input), fences, [collision]);
    let idempotentFailure = "";
    for (const input of deterministic) {
        const once = fixLatexText(input);
        const twice = fixLatexText(once);
        if (once !== twice) {
            idempotentFailure = `${JSON.stringify(input)} => ${JSON.stringify(once)} => ${JSON.stringify(twice)}`;
            break;
        }
    }
    assert(!idempotentFailure, "全部确定性样本幂等", idempotentFailure);

    let katexFailure = "";
    for (const [, expected, name] of conversions) {
        const blockRe = /\$\$([\s\S]+?)\$\$/g;
        const stripped = expected.replace(blockRe, (_m, latex) => {
            try { katex.renderToString(latex.trim(), {throwOnError: true, displayMode: true}); }
            catch (e) { katexFailure = `${name}: ${e.message}`; }
            return "";
        });
        stripped.replace(/\$([^$\n]+)\$/g, (_m, latex) => {
            try { katex.renderToString(latex.trim(), {throwOnError: true, displayMode: false}); }
            catch (e) { katexFailure = `${name}: ${e.message}`; }
            return "";
        });
        if (katexFailure) break;
    }
    assert(!katexFailure, "新增公式全部可由 KaTeX 解析", katexFailure);

    const codeAndFormula = Array.from({length: 500}, (_, i) =>
        "```txt\n\\(code_" + i + "\\)\n```\n\\(x_" + i + "\\)").join("\n");
    const stressCases = [
        ["连续 1000 个公式", Array.from({length: 1000}, (_, i) => `\\(x_${i}\\)`).join(" "), true],
        ["1 MB 普通 Markdown", "普通文本与日志行。\n".repeat(65536), false],
        ["500 个代码块与公式", codeAndFormula, true],
        ["100 层括号", "[".repeat(100) + "x_i" + "]".repeat(100), false],
        ["500 个连续美元符", "$".repeat(500), false],
        ["500 个连续反斜杠", "\\".repeat(500), false],
        ["500 个未闭合定界符", "\\(".repeat(500) + "tail", false],
    ];
    for (const [name, input, shouldChange] of stressCases) {
        const start = Date.now();
        const output = fixLatexText(input);
        const elapsed = Date.now() - start;
        assert(elapsed < 2000 && output.length <= input.length * 2 + 1024 &&
            (shouldChange ? output !== input : true), name,
        `耗时 ${elapsed}ms，输入 ${input.length}，输出 ${output.length}`);
    }

    console.log(`\n对抗性文本测试: ${passed} 通过`);
    if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
