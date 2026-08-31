// 构建门禁：package.json / plugin.json / package-lock.json 三个版本号必须一致。
// 接入 npm run check；不一致时直接失败，防止只改了 package.json 就发布。
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf-8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf-8"));

const versions = {
    "package.json": pkg.version,
    "plugin.json": plugin.version,
    "package-lock.json": lock.version,
};
const bad = Object.entries(versions).filter(([, v]) => v !== pkg.version);
if (bad.length > 0) {
    console.error(`版本不一致：package.json=${versions["package.json"]}, ` +
        bad.map(([f, v]) => `${f}=${v}`).join(", "));
    process.exit(1);
}
console.log(`版本一致: v${pkg.version}`);