import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

fs.copyFileSync(path.join(root, "plugin.json"), path.join(dist, "plugin.json"));
fs.cpSync(path.join(root, "i18n"), path.join(dist, "i18n"), { recursive: true });
fs.copyFileSync(path.join(root, "README.md"), path.join(dist, "README.md"));

console.log("build done ->", dist);
