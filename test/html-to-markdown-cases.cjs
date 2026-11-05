/**
 * HTML → Markdown 转换测试（v0.3.0）。
 *
 * 背景：v0.2.x 的 MathML 路径把整页 HTML 拍成纯文本，网页里的加粗/链接/图片/
 * 列表/表格全丢。这里验证新的 html-to-markdown 能保住排版，公式仍然可用，
 * 表格里的块级公式与裸 | 不会撕表。
 * 运行：node test/html-to-markdown-cases.cjs
 */
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(cond, name, extra) {
    if (cond) {
        passed++;
        console.log("  ✓", name);
    } else {
        failed++;
        console.error("  ✗", name, extra ? "\n    " + String(extra).slice(0, 400) : "");
    }
}

function contains(haystack, needle, name) {
    assert(haystack.includes(needle), name, "期望包含: " + needle + "\n实际: " + haystack.slice(0, 400));
}

async function bundle() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/html-to-markdown.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_html-to-markdown.cjs"), logLevel: "silent",
    });
    await esbuild.build({
        entryPoints: [path.join(root, "src/mathml.ts")],
        bundle: true, format: "cjs", platform: "node",
        external: ["mathml2latex"],
        outfile: path.join(__dirname, "_mathml_md.cjs"), logLevel: "silent",
    });
}

async function main() {
    await bundle();
    const { htmlToMarkdown } = require("./_html-to-markdown.cjs");
    const mml = require("./_mathml_md.cjs");

    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    global.DOMParser = dom.window.DOMParser;
    global.Node = dom.window.Node;
    global.HTMLElement = dom.window.HTMLElement;
    global.document = dom.window.document;

    function md(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return htmlToMarkdown(doc.body);
    }

    console.log("== 1. 行内排版 ==");
    const inline = md('<p>这是<strong>加粗</strong>、<em>斜体</em>与<a href="https://example.com/a">链接</a>。</p>');
    contains(inline, "**加粗**", "加粗保留");
    contains(inline, "*斜体*", "斜体保留");
    contains(inline, "[链接](https://example.com/a)", "链接保留");
    assert(!/<(strong|p|a)[\s>]/.test(inline), "无 HTML 标签残留", inline);

    console.log("== 2. 图片 / 列表 / 标题 / 代码块 ==");
    const blocks = md('<h2>小节</h2><ul><li>甲</li><li>乙</li></ul><img src="pic.png" alt="图"><pre><code class="language-js">const a = 1;</code></pre>');
    contains(blocks, "## 小节", "标题保留");
    contains(blocks, "- 甲", "无序列表保留");
    contains(blocks, "![图](pic.png)", "图片保留");
    contains(blocks, "```js", "代码块语言保留");
    contains(blocks, "const a = 1;", "代码块内容保留");

    console.log("== 3. 表格 ==");
    const table = md('<table><tr><th>名称</th><th>值</th></tr><tr><td>甲</td><td>1</td></tr></table>');
    contains(table, "| 名称 | 值 |", "表头行");
    contains(table, "| --- | --- |", "分隔行");
    contains(table, "| 甲 | 1 |", "数据行");

    console.log("== 4. 表格里的公式不撕表 ==");
    const cell = md('<table><tr><th>公式</th></tr><tr><td>$$x^2$$</td></tr></table>');
    contains(cell, "| $x^2$ |", "单元格内块级公式降级为行内");
    assert(!/\|\s*\$\$/.test(cell), "单元格内不出现块级公式", cell);
    const pipe = md('<table><tr><th>绝对值</th></tr><tr><td>$|x|$</td></tr></table>');
    contains(pipe, "\\vert", "公式内裸 | 转 \\vert");
    assert(!/\$\|x\|\$/.test(pipe), "公式内不再有裸 |", pipe);

    console.log("== 5. 与 MathML 转换集成 ==");
    const page = '<h2>标题</h2><p>这是<strong>加粗</strong>与<a href="https://example.com/x">链接</a>，公式 <math><mi>x</mi></math>。</p>' +
        '<ul><li>第一项</li></ul><table><tr><th>列</th></tr><tr><td>值</td></tr></table><img src="a.png" alt="图">';
    const res = mml.convertMathMLInHTML(page);
    assert(res.count > 0, "MathML 计数 > 0");
    contains(res.text, "## 标题", "MathML 路径保留标题");
    contains(res.text, "**加粗**", "MathML 路径保留加粗");
    contains(res.text, "[链接](https://example.com/x)", "MathML 路径保留链接");
    contains(res.text, "![图](a.png)", "MathML 路径保留图片");
    contains(res.text, "| 列 |", "MathML 路径保留表格");
    assert(/\$[^$]+\$/.test(res.text), "公式仍是 $...$", res.text);
    assert(!/<(math|p|h2|table|ul)[\s>]/.test(res.text), "无 HTML 残留", res.text);

    console.log("== 6. 空白与零宽字符 ==");
    const messy = md('<p>甲\u200b乙   丙</p>');
    assert(messy === "甲乙 丙", "零宽字符移除 + 连续空格折叠", JSON.stringify(messy));

    console.log("\nhtml-to-markdown 测试: " + passed + " 通过, " + failed + " 失败");
    if (failed > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
