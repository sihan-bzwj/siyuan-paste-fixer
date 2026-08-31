// v0.2.0 场景分类器专项测试（src/scenario.ts）
const path = require("path");
const esbuild = require("esbuild");

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
        entryPoints: [path.join(root, "src/scenario.ts")],
        bundle: true, format: "cjs", platform: "node",
        external: ["mathml2latex"],
        outfile: path.join(__dirname, "_scenario.cjs"), logLevel: "silent",
    });
    const { detectPasteScenario, looksLikeCode, countMathFormulas, DEFAULT_POLICY, planPasteHandling } = require("./_scenario.cjs");
    const ctx = (plain = "", html = "", sy = "", inCode = false) => ({textPlain: plain, textHTML: html, siyuanHTML: sy, inCodeTarget: inCode});
    const R = String.raw;

    console.log("== 1. 固定放行场景 ==");
    assert(detectPasteScenario(ctx("", "", '<span data-type="inline-math">x</span>')) === "siyuan-internal", "思源内部复制");
    assert(detectPasteScenario(ctx("$x$", "", '<div data-type="NodeMathBlock"></div>')) === "siyuan-internal", "内部公式块优先于内容");
    assert(detectPasteScenario(ctx("代码", "", "", true)) === "code-target", "代码块目标");
    assert(detectPasteScenario(ctx("普通一句话，没有公式。", "", "")) === "plain-prose", "纯散文");

    console.log("== 2. 代码内容 ==");
    const codeCases = [
        R`html[data-theme-mode="dark"] { color: #fff; }`,
        R`input[type="text"] { border: 1px solid #ccc; }`,
        R`a[href^="https"]::after { content: "🔗"; }`,
        R`$dark: #fff; html[data-theme-mode="dark"] { background: $dark; }`,
        R`$font-size: 14px; body { font-size: $font-size; }`,
        R`<div class="card" data-id="123">`,
        R`[aria-label="关闭"]`,
        R`const a = obj["key"];`,
        R`{"name": "jh", "age": 30}`,
        R`function foo(x) { return x * 2; }`,
        R`def main():
    print("hello")`,
        R`let theme = "dark"; console.log(theme);`,
    ];
    for (const code of codeCases) {
        assert(detectPasteScenario(ctx(code)) === "code-content", "代码: " + code.slice(0, 40), code);
    }

    console.log("== 3. 数学文本不是代码 ==");
    const mathCases = [
        R`因为 $y_0\ge2$，所以 $0<x\le1$。`,
        R`$$\nE = mc^2\n$$`,
        R`公式 \[ E=mc^2 \] 结束`,
        R`行内 \( a_i \) 公式`,
        R`[ y=Wx ] 与 $x_i$ 混合`,
        R`$$ \begin{aligned} a &= b \\ c &= d \end{aligned} $$`,
    ];
    for (const m of mathCases) {
        const s = detectPasteScenario(ctx(m));
        assert(s === "ai-latex" || s === "mixed", "数学: " + m.slice(0, 40) + " → " + s, m);
    }

    console.log("== 4. 网页公式 ==");
    const katexHtml = '<span class="katex"><math><semantics><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span>';
    assert(detectPasteScenario(ctx("视觉文本", katexHtml)) === "web-math", "KaTeX HTML");
    assert(detectPasteScenario(ctx("$x$", '<math><mi>x</mi></math>')) === "web-math", "原生 MathML");
    assert(detectPasteScenario(ctx("css .a{}", '<mjx-container><mjx-math data-latex="x"></mjx-math></mjx-container>')) === "web-math", "MathJax 优先于代码外观");

    console.log("== 5. mixed 边界 ==");
    assert(detectPasteScenario(ctx("价格 $5，公式 $x_i$ 同行")) === "mixed", "金额+公式");
    assert(detectPasteScenario(ctx("看 [a^2] 与 x=1")) === "plain-prose", "无数学信号的裸括号弱信号 = 散文放行");
    assert(detectPasteScenario(ctx("脚本 awk '{print $1}' 正常")) === "mixed" || detectPasteScenario(ctx("脚本 awk '{print $1}' 正常")) === "plain-prose", "awk 弱信号");

    console.log("== 6. looksLikeCode 细粒度 ==");
    assert(looksLikeCode(R`[lang=en]`) === false, "[lang=en] 无引号选择器不算代码（与数学块不可区分）");
    assert(looksLikeCode(R`[ y=Wx ]`) === false, "数学块不算代码");
    assert(looksLikeCode(R`\frac{a}{b}`) === false, "LaTeX 命令不算代码");
    assert(looksLikeCode("普通散文不包含任何代码特征") === false, "散文不算代码");
    assert(looksLikeCode(R`body { margin: 0; padding: 0 }`) === true, "纯 CSS 规则体");

    console.log("== 7. 策略默认值与计数 ==");
    assert(DEFAULT_POLICY["ai-latex"] === "smart" && DEFAULT_POLICY["code-content"] === "smart", "默认策略为 smart");
    assert(DEFAULT_POLICY["siyuan-internal"] === "pass" && DEFAULT_POLICY["code-target"] === "pass" && DEFAULT_POLICY["plain-prose"] === "pass", "固定放行场景为 pass");
    assert(countMathFormulas("$x$ 与 $$y=Wx$$ 和 $a_i$") === 3, "公式计数 3");
    assert(countMathFormulas("没有公式") === 0, "公式计数 0");

    console.log("== 8. v0.2.3 边界：弱特征不误判 / 代码里的 LaTeX / 路由裁决 ==");
    assert(detectPasteScenario(ctx("今天已经完成 80%")) === "plain-prose", "单个弱特征（80%）不是代码");
    assert(detectPasteScenario(ctx(R`const x = "\frac{a}{b}";`)) === "code-content", "代码字符串里的 \\frac 仍是代码");
    assert(detectPasteScenario(ctx(R`$font-size: 14px; body { font-size: $font-size; }`)) === "code-content", "SCSS 变量行是代码");
    assert(detectPasteScenario(ctx(R`x \frac{a}{b} 普通数学`)) === "ai-latex", "普通正文里的 \\frac 仍是数学");
    assert(detectPasteScenario(ctx(R`\begin{aligned} a &= b \end{aligned}`)) === "ai-latex", "数学环境不会被当成 CSS 规则体");
    {
        const plan = (plain, html = "", sy = "", inCode = false, policy = () => "smart") =>
            planPasteHandling({textPlain: plain, textHTML: html, siyuanHTML: sy, inCodeTarget: inCode, getPolicy: policy});
        assert(plan(R`\frac{a}{b} 说明`).action === "fix", "AI 数学 smart → fix");
        assert(plan("普通一句话。").action === "pass", "散文 → pass");
        assert(plan(R`\frac{x}{y}`, "", "", true).action === "pass", "代码块目标 → pass（inCodeTarget 贯通）");
        assert(plan(R`\frac{x}{y}`, "", "", false, (s) => (s === "ai-latex" ? "pass" : "smart")).hint === true, "ai-latex pass → 提示");
    }

    console.log(`\n场景分类器测试: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });