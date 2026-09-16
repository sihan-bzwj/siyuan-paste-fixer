// 命令表护栏：src/latex-commands.ts 必须覆盖 KaTeX 自带的全部命令名。
// 表里少一个命令，合法命令就会被断词规则误拆（\bigcup → \big cup），
// 所以这里用与生成时相同的抽取逻辑反向校验；失败时打印缺的名字。
// 重新生成：把 node_modules/katex/src 里所有 \命令名 抽出来替换表内容即可。
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const katexSrc = path.join(root, "node_modules/katex/src");
if (!fs.existsSync(katexSrc)) {
    console.log("命令表护栏：跳过（node_modules/katex/src 不存在，需要 npm install）");
    process.exit(0);
}

const names = new Set();
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(p);
        } else if (/\.(ts|js)$/.test(entry.name)) {
            for (const m of fs.readFileSync(p, "utf8").matchAll(/\\[a-zA-Z]+/g)) {
                names.add(m[0].slice(1));
            }
        }
    }
})(katexSrc);

const table = fs.readFileSync(path.join(root, "src/latex-commands.ts"), "utf8");
const body = table.match(/const LATEX_COMMAND_NAMES = `([\s\S]*?)`;/);
if (!body) {
    console.error("命令表护栏：解析 src/latex-commands.ts 失败（LATEX_COMMAND_NAMES 模板串没找到）");
    process.exit(1);
}
const have = new Set(body[1].trim().split(/\s+/));
const missing = [...names].filter((n) => !have.has(n)).sort();

if (missing.length > 0) {
    console.error(`命令表缺 ${missing.length} 个 KaTeX 命令（会误拆合法命令）：`);
    console.error("  " + missing.slice(0, 40).join(" ") + (missing.length > 40 ? " ..." : ""));
    process.exit(1);
}
console.log(`命令表护栏：覆盖 KaTeX ${names.size} 个命令名（表内 ${have.size} 个）`);
