// 发布门禁（npm run release-check 的最后一步）：
// 检查 dist 内容齐全、版本一致、package.zip 已生成、根目录无多余 README。
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let failed = false;

function check(cond, name, detail = "") {
    if (cond) {
        console.log("  ✓", name);
    } else {
        failed = true;
        console.error("  ✗", name, detail);
    }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const dist = path.join(root, "dist");

check(fs.existsSync(path.join(dist, "index.js")), "dist/index.js 存在");
check(fs.existsSync(path.join(dist, "plugin.json")), "dist/plugin.json 存在");
check(fs.existsSync(path.join(dist, "i18n", "zh_CN.json")), "dist/i18n/zh_CN.json 存在");
check(fs.existsSync(path.join(dist, "README.md")), "dist/README.md 存在");
check(fs.existsSync(path.join(dist, "icon.png")), "dist/icon.png 存在");
check(fs.existsSync(path.join(dist, "preview.png")), "dist/preview.png 存在");

const plugin = fs.existsSync(path.join(dist, "plugin.json"))
    ? JSON.parse(fs.readFileSync(path.join(dist, "plugin.json"), "utf-8"))
    : null;
check(plugin !== null && plugin.version === pkg.version,
    `dist/plugin.json 版本 ${plugin ? plugin.version : "?"} 与 package.json 一致`);

check(fs.existsSync(path.join(root, "package.zip")), "package.zip 已生成");
check(!fs.existsSync(path.join(root, "README.html")), "根目录无 README.html（唯一 README）");

console.log(failed ? "\n发布门禁未通过" : "\n发布门禁通过");
process.exit(failed ? 1 : 0);