/**
 * v0.3.0 杂项守卫：同类插件探测、诊断包、性能预算、core 架构纯净性。
 * 运行：node test/extras-cases.cjs
 */
const fs = require("fs");
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
        console.error("  ✗", name, extra ? "\n    " + String(extra).slice(0, 400) : "");
    }
}

async function bundle(entry, outfile) {
    await esbuild.build({
        entryPoints: [path.join(root, entry)],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, outfile), logLevel: "silent",
    });
}

async function main() {
    await bundle("src/compat.ts", "_compat.cjs");
    await bundle("src/diagnostics.ts", "_diagnostics.cjs");
    await bundle("src/fix-latex.ts", "_fix-latex-extras.cjs");
    const { findConflictingPlugins } = require("./_compat.cjs");
    const diag = require("./_diagnostics.cjs");
    const { fixLatexText } = require("./_fix-latex-extras.cjs");

    console.log("== 1. 同类插件探测 ==");
    assert(findConflictingPlugins([]).length === 0, "空目录无冲突");
    assert(JSON.stringify(findConflictingPlugins(["siyuan-plugin-text-process", "other"])) === '["text-process"]',
        "识别 text-process");
    assert(JSON.stringify(findConflictingPlugins(["latex-paste"])) === '["latex-paste"]', "识别 latex-paste");
    assert(JSON.stringify(findConflictingPlugins(["text-process", "siyuan-plugin-text-process"])) === '["text-process"]',
        "同名只报一次");
    assert(findConflictingPlugins(["mytool", "texhelper"]).length === 0, "无关插件不误报");

    console.log("== 2. 诊断包 ==");
    const meta = { scenario: "web-math", action: "fix", source: "html", quality: "exact", formulas: 3 };
    const record = diag.buildDiagnostic({
        meta, durationMs: 12.34, pluginVersion: "0.3.0",
        textPlain: "x", textHTML: "<p>x</p>", siyuanHTML: "<div/>",
        now: new Date("2026-11-05T12:00:00Z"),
    });
    assert(record.durationMs === 12.3, "耗时保留一位小数", record.durationMs);
    assert(record.overBudget === false, "12ms 未超预算");
    assert(record.pluginVersion === "0.3.0" && record.formulas === 3, "元信息透传");
    assert(record.siyuanHTMLSize === 6, "内部 DOM 只记长度");
    const slow = diag.buildDiagnostic({ ...{ meta, pluginVersion: "0.3.0", textPlain: "", textHTML: "", siyuanHTML: "" }, durationMs: 400 });
    assert(slow.overBudget === true, "400ms 标记超预算");
    const big = diag.buildDiagnostic({ meta, durationMs: 1, pluginVersion: "0.3.0", textPlain: "a".repeat(30000), textHTML: "", siyuanHTML: "" });
    assert(big.textPlain.length < 30000, "剪贴板原文截断");
    assert(big.textPlain.includes("截断"), "截断有标注");
    const name = diag.diagnosticFileName(new Date("2026-11-05T01:02:03"));
    assert(/^paste-diag-\d{8}-\d{6}\.json$/.test(name), "文件名格式", name);
    assert(JSON.parse(diag.formatDiagnostic(record)).scenario === "web-math", "导出 JSON 可解析");

    console.log("== 3. 性能预算 ==");
    const big1mb = ("这段是普通说明文字，包含 \\frac{a}{b} 与 \\sum_{i=1}^{n} x_i 之类的命令。\n").repeat(12000);
    const started = Date.now();
    const fixed = fixLatexText(big1mb);
    const cost = Date.now() - started;
    assert(fixed.length > 0, "大输入有输出（" + fixed.length + " 字符）");
    assert(cost < 3000, "1MB 级输入处理耗时在预算内（实测 " + cost + "ms）");

    console.log("== 4. core 架构纯净性（为跨端移植铺路） ==");
    const coreFiles = [
        "fix-latex.ts", "mathml.ts", "html-to-markdown.ts", "clipboard.ts", "scenario.ts",
        "undelimited.ts", "latex-commands.ts", "diagnostics.ts", "compat.ts", "copy-markdown.ts",
    ];
    coreFiles.forEach((file) => {
        const full = path.join(root, "src", file);
        if (!fs.existsSync(full)) {
            assert(false, file + " 存在");
            return;
        }
        const source = fs.readFileSync(full, "utf8");
        assert(!/from\s+["']siyuan["']/.test(source), file + " 不依赖 siyuan SDK");
    });
    const omml = path.join(root, "src", "omml.ts");
    if (fs.existsSync(omml)) {
        assert(!/from\s+["']siyuan["']/.test(fs.readFileSync(omml, "utf8")), "omml.ts 不依赖 siyuan SDK");
    }

    console.log("\nv0.3.0 杂项测试: " + passed + " 通过, " + failed + " 失败");
    if (failed > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
