// v0.2.9 未定界 LaTeX 行级识别专项测试（src/undelimited.ts + 场景/设置集成）
const path = require("path");
const esbuild = require("esbuild");
const katex = require("katex");

const root = path.join(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(cond, name, detail = "") {
    if (cond) {
        passed++;
        console.log("  ✓", name);
    } else {
        failed++;
        console.error("  ✗", name, detail ? "\n    " + detail : "");
    }
}

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_fix-latex.cjs"), logLevel: "silent",
    });
    await esbuild.build({
        entryPoints: [path.join(root, "src/scenario.ts")],
        bundle: true, format: "cjs", platform: "node",
        external: ["mathml2latex"],
        outfile: path.join(__dirname, "_scenario.cjs"), logLevel: "silent",
    });
    await esbuild.build({
        entryPoints: [path.join(root, "src/undelimited.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_undelimited.cjs"), logLevel: "silent",
    });
    const { convertUndelimitedLatex, needsUndelimitedDetection } = require("./_undelimited.cjs");
    const { detectPasteScenario } = require("./_scenario.cjs");
    const R = String.raw;

    const ctx = (plain, html = "", sy = "", inCode = false) => ({textPlain: plain, textHTML: html, siyuanHTML: sy, inCodeTarget: inCode});

    console.log("== 1. 场景判定：裸命令密度 ≥2 → undelimited-latex ==");
    assert(detectPasteScenario(ctx("· \\lor 换成 \\land")) === "undelimited-latex", "两个孤立命令触发");
    assert(detectPasteScenario(ctx(R`定理：\neg A(P_1) \Leftrightarrow A^*(\neg P_1)`)) === "undelimited-latex", "定理行触发");
    assert(detectPasteScenario(ctx("编码为 011（即 m_3）")) === "plain-prose", "单个强 token 不触发");
    assert(detectPasteScenario(ctx("T 换成 F")) === "plain-prose", "纯字母无强 token 不触发");
    assert(detectPasteScenario(ctx("```txt\n\\lor \\land\n```")) === "plain-prose", "围栏内不算");
    assert(detectPasteScenario(ctx(R`\begin{align}x\end{align}`)) === "ai-latex", "裸环境仍归 ai-latex（不抢）");
    assert(detectPasteScenario(ctx(R`\frac{a}{b} 说明`)) === "ai-latex", "定界符场景优先（\\frac 结构命令走原 ai-latex）");

    console.log("== 2. 片段包裹：核心行 ==");
    const cases = [
        ["· \\lor 换成 \\land", "· $\\lor$ 换成 $\\land$"],
        ["只换联结词和T/F，不变元本身（P 还是 P，\\neg P 还是 \\neg P）。",
         "只换联结词和T/F，不变元本身（P 还是 P，$\\neg P$ 还是 $\\neg P$）。"],
        [R`\neg A(P_1, P_2, \dots, P_n) \Leftrightarrow A^*(\neg P_1, \neg P_2, \dots, \neg P_n)`,
         R`$\neg A(P_1, P_2, \dots, P_n) \Leftrightarrow A^*(\neg P_1, \neg P_2, \dots, \neg P_n)$`],
        [R`（如 (P \land Q) \lor (\neg P \land R)）。外层是 \lor，内层是 \land。`,
         R`（如 $(P \land Q) \lor (\neg P \land R)$）。外层是 $\lor$，内层是 $\land$。`],
        [R`记住 (P↓Q) 的对偶式是 (P↑Q)，因为 P↓Q ⇔ ¬(P∨Q)，其对偶式是 ¬(P∧Q) ⇔ P↑Q。`,
         R`记住 (P↓Q) 的对偶式是 (P↑Q)，因为 P↓Q ⇔ ¬(P∨Q)，其对偶式是 ¬(P∧Q) ⇔ P↑Q。`],
        [R`例如：\neg P \land Q \land R 编码为 011（即 m_3）。`,
         R`例如：$\neg P \land Q \land R$ 编码为 011（即 $m_3$）。`],
        [R`全集（0 到 2^n-1）`, R`全集（0 到 $2^n-1$）`],
        [R`就 \land (R \lor \neg R) 补进去`, R`就 $\land (R \lor \neg R)$ 补进去`],
        [R`理解对偶定义 \rightarrow 会求普通范式`, R`理解对偶定义 $\rightarrow$ 会求普通范式`],
        [R`（异或 P \oplus Q）`, R`（异或 $P \oplus Q$）`],
        [R`称为 A 的对偶式`, R`称为 A 的对偶式`],
        ["T 换成 F", "T 换成 F"],
        ["小项编号 + 大项编号 = 全集", "小项编号 + 大项编号 = 全集"],
        ["Page 94-96 与 Page 102 原话", "Page 94-96 与 Page 102 原话"],
        [R`主析取范式（\sum m）`, R`主析取范式（$\sum m$）`],
    ];
    const katexFailures = [];
    for (const [input, expected] of cases) {
        const out = convertUndelimitedLatex(input);
        assert(out === expected, JSON.stringify(input.slice(0, 40)), JSON.stringify(out));
        // 每个生成的 $...$ 片段用 KaTeX 校验可解析
        const frags = [...out.matchAll(/\$([^$\n]+)\$/g)].map((m) => m[1]);
        for (const frag of frags) {
            try {
                katex.renderToString(frag.trim(), {throwOnError: true, displayMode: false});
            } catch (e) {
                katexFailures.push(frag + " → " + e.message.slice(0, 60));
            }
        }
    }
    assert(katexFailures.length === 0, "全部生成片段 KaTeX 可解析", katexFailures.join(" | "));

    console.log("== 3. 夹具整篇（duel-normalform）：逐行转换不破坏结构 ==");
    const fs = require("fs");
    const raw = fs.readFileSync(path.join(__dirname, "fixtures/duel-normalform-plain.txt"), "utf-8");
    const out = convertUndelimitedLatex(raw);
    // 结构断言：标题/列表行不变、公式行已包裹、代码围栏不变
    assert(out.includes("· $\\lor$ 换成 $\\land$"), "命令词行已转换", out.split("\n")[10]);
    assert(out.includes(R`$\neg A(P_1, P_2, \dots, P_n) \Leftrightarrow A^*(\neg P_1, \neg P_2, \dots, \neg P_n)$`),
        "定理行整体一个片段");
    assert(out.split("```").length === raw.split("```").length, "代码围栏数量不变");
    const allFrags = [...out.matchAll(/\$([^$\n]+)\$/g)].map((m) => m[1]);
    let fragErrors = 0;
    for (const frag of allFrags) {
        try {
            katex.renderToString(frag.trim(), {throwOnError: true, displayMode: false});
        } catch (e) {
            fragErrors++;
        }
    }
    assert(fragErrors === 0, `夹具全部 ${allFrags.length} 个片段 KaTeX 可解析`, `${fragErrors} 个失败`);

    console.log("== 3b. 夹具整篇（duel-normalform-sup，用户真实粘贴案例）==");
    {
        // 这篇带 <sup> 断裂标签与 --- 分隔线的真实 AI 输出，曾在带 HTML 通道被
        // 复杂富文本保护整体放行（v0.2.9 现场缺陷）；纯文本通道必须正常转换
        const supRaw = fs.readFileSync(path.join(__dirname, "fixtures/duel-normalform-sup.txt"), "utf-8");
        assert(needsUndelimitedDetection(supRaw), "真实案例触发未定界检测");
        assert(detectPasteScenario(ctx(supRaw)) === "undelimited-latex", "真实案例判为未定界场景");
        const supOut = convertUndelimitedLatex(supRaw);
        assert(supOut !== supRaw, "真实案例发生转换");
        assert(supOut.includes("· $\\lor$ 换成 $\\land$"), "命令词行已转换");
        assert(supOut.includes(R`$\neg P \land Q \land R$ 编码为 011`), "编码示例行已转换");
        const supFrags = [...supOut.matchAll(/\$([^$\n]+)\$/g)].map((m) => m[1]);
        let supErrors = 0;
        for (const frag of supFrags) {
            try {
                katex.renderToString(frag.trim(), {throwOnError: true, displayMode: false});
            } catch (e) {
                supErrors++;
            }
        }
        assert(supErrors === 0 && supFrags.length >= 40,
            `真实案例 ${supFrags.length} 个片段全部 KaTeX 可解析`, `${supErrors} 个失败`);
    }

    console.log("== 4. 保护段不动 ==");
    {
        const withFence = "```\n\\lor \\land \\neg\n```\n正文 \\lor 说明";
        const converted = convertUndelimitedLatex(withFence);
        assert(converted.includes("```\\n\\lor \\land \\neg\\n```") || converted.split("```")[1] === "\n\\lor \\land \\neg\n",
            "围栏内不转换", JSON.stringify(converted.split("```")[1]));
        assert(converted.endsWith("正文 $\\lor$ 说明"), "围栏外正常转换");
    }

    console.log(`\n未定界 LaTeX 测试: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });