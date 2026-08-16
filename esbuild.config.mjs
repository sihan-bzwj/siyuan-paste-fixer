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

for (const f of ["plugin.json", "README.md", "icon.png"]) {
    fs.copyFileSync(path.join(root, f), path.join(dist, f));
}
fs.cpSync(path.join(root, "i18n"), path.join(dist, "i18n"), { recursive: true });

// 打包集市发布用 package.zip（dist 内容在压缩包根目录；用 Python zipfile 保证路径用正斜杠）
if (process.argv.includes("--package")) {
    const zipPath = path.join(root, "package.zip");
    fs.rmSync(zipPath, {force: true});
    execSync(`python -c "import zipfile,os; z=zipfile.ZipFile('package.zip','w',zipfile.ZIP_DEFLATED); [z.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f),'dist').replace(os.sep,'/')) for r,_,fs2 in os.walk('dist') for f in fs2]; z.close()"`, {cwd: root, stdio: "inherit"});
    console.log("package.zip:", fs.statSync(zipPath).size, "bytes");
}

console.log("build done ->", dist);
