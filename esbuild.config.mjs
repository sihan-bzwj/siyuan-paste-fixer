import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });

await esbuild.build({
    entryPoints: [path.join(root, "src/index.ts")],
    bundle: true,
    outfile: path.join(dist, "index.js"),
    format: "cjs",
    platform: "browser",
    target: "es2020",
    external: ["siyuan"],
    minify: true,
    logLevel: "info",
});

for (const f of ["plugin.json", "README.md", "icon.png", "preview.png"]) {
    fs.copyFileSync(path.join(root, f), path.join(dist, f));
}
fs.cpSync(path.join(root, "i18n"), path.join(dist, "i18n"), { recursive: true });

// 打包集市发布用 package.zip（dist 内容在压缩包根目录）
if (process.argv.includes("--package")) {
    fs.rmSync(path.join(root, "package.zip"), {force: true});
    execSync("powershell -NoProfile -Command \"Compress-Archive -Path dist\\* -DestinationPath package.zip -Force\"", {cwd: root, stdio: "inherit"});
    console.log("package.zip:", fs.statSync(path.join(root, "package.zip")).size, "bytes");
}

console.log("build done ->", dist);
