/**
 * 表格行安全测试（v0.3.0）。
 *
 * 网页/Word 复制过来的内容经常带 GFM 表格。表格里一旦出现块级公式或多一个裸 |，
 * 整张表就会被撕开。fixLatexText 收尾处统一把表格行内的块级公式降级、公式内的
 * 裸 | 转成 \vert；代码围栏里的表格文本不受影响。
 * 运行：node test/table-cases.cjs
 */
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(cond, name, extra) {
    if (cond) {
        passed++;
        console.log("  ✓", name);
    } else {
        failed++;
        console.error("  ✗", name, extra ? "\n    " + String(extra).slice(0, 300) : "");
    }
}

function contains(haystack, needle, name) {
    assert(haystack.includes(needle), name, "期望包含: " + needle + "\n实际: " + haystack);
}

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_fix-latex-table.cjs"), logLevel: "silent",
    });
    const { fixLatexText } = require("./_fix-latex-table.cjs");

    console.log("== 1. 表格行内的块级公式降级为行内 ==");
    const block = fixLatexText("| 名称 | 公式 |\n| --- | --- |\n| 甲 | $$x^2$$ |");
    contains(block, "| 甲 | $x^2$ |", "单元格内 $$ 变 $");
    assert(!/\|\s*\$\$/.test(block), "表格内不出现 $$", block);

    console.log("== 2. 公式内的裸 | 转 \\vert ==");
    const pipe = fixLatexText("| 绝对值 | $|x|$ |");
    contains(pipe, "\\vert", "裸 | 转 \\vert");
    assert(!/\$\|x\|\$/.test(pipe), "不再有裸 |x|", pipe);
    const two = fixLatexText("| 范数 | $||x||$ |");
    contains(two, "\\vert", "双竖线也转");

    console.log("== 3. 普通表格行不受影响 ==");
    const plain = fixLatexText("| 项目 | 数值 |\n| --- | --- |\n| 甲 | 1.5 |");
    assert(plain === "| 项目 | 数值 |\n| --- | --- |\n| 甲 | 1.5 |", "无公式的表格原样", plain);
    const inline = fixLatexText("| 公式 | $a+b$ |");
    contains(inline, "$a+b$", "行内公式保持");

    console.log("== 4. 代码围栏里的表格文本不动 ==");
    const fenced = "\`\`\`\n| 甲 | $$x$$ |\n\`\`\`";
    const out = fixLatexText(fenced);
    assert(out === fenced, "围栏内容原样", out);

    console.log("== 5. 非表格行仍然是块级公式 ==");
    const normal = fixLatexText("说明：\n$$x^2$$");
    contains(normal, "$$x^2$$", "正文里的 $$ 保持块级");

    console.log("\n表格安全测试: " + passed + " 通过, " + failed + " 失败");
    if (failed > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
