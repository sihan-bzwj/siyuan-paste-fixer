// 生成集市预览用的演示文档 Markdown（粘贴前 vs 粘贴后）
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
esbuild.buildSync({entryPoints: [path.join(__dirname, "..", "src", "fix-latex.ts")], bundle: true, format: "cjs", platform: "node", outfile: path.join(__dirname, "_fix-latex.cjs"), logLevel: "silent"});
const { fixLatexText } = require("./_fix-latex.cjs");

const original = fs.readFileSync(path.join(__dirname, "fixtures/ghost2-original.txt"), "utf8");
const fixed = fixLatexText(original);

const raw1 = "[\ny=Wx\n]";
const raw2 = "[\\frac{\\partial L}{\\partial W\_{ij}}\n=====\n\\frac{\\partial L}{\\partial y\_i}x\_j\n]";
const raw3 = "\\underbrace{x}_*{a_j}   2\\3\\4   \\nabla\_WL\=ba\\^\\top";

const demo = [
    "# 粘贴公式修复 · Paste LaTeX Fixer",
    "",
    "## 粘贴前：AI 聊天复制来的原文",
    "",
    "每个参数 (W_{ij}) 只控制：",
    "",
    "```",
    raw1,
    "```",
    "",
    "链式法则天然给出：",
    "",
    "```",
    raw2,
    "```",
    "",
    "下标、矩阵全是乱码：",
    "",
    "```",
    raw3,
    "```",
    "",
    "## 粘贴后：插件自动修复为公式",
    "",
    fixed.split("\n").slice(2).join("\n"),
].join("\n");

fs.writeFileSync(path.join(__dirname, "_demo-doc.md"), demo);
console.log("demo md:", demo.length, "chars");
