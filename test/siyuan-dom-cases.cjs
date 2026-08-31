// v0.2.3 siyuan-dom 专项测试（src/siyuan-dom.ts）
// mdToSiyuanHTML 重构后：保护段（code fence/链接/URL）原样交给 Lute，不再
// 字符串还原结构；只在非保护段识别 $$；公式属性转义；孤立 $ 恢复。
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
        entryPoints: [path.join(root, "src/siyuan-dom.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_siyuan-dom.cjs"), logLevel: "silent",
    });
    const { mdToSiyuanHTML } = require("./_siyuan-dom.cjs");
    const R = String.raw;

    // 最小 Lute stub：把输入当普通段落包一层（记录被解析的文本）
    let luteInputs = [];
    const stubLute = {
        Md2BlockDOM: (s) => {
            luteInputs.push(s);
            return `<p>${s}</p>`;
        },
        NewNodeID: () => "nid",
    };
    const mathCount = (html) => (html.match(/data-type="NodeMathBlock"/g) || []).length;

    console.log("== 1. code fence 里的 <img>/$$ 不越界 ==");
    {
        luteInputs = [];
        const md = ["正文", "", "```html", '<img src=x onerror=alert(1)>', "```", "", "$$", "E=mc^2", "$$", ""].join("\n");
        const out = mdToSiyuanHTML(md, stubLute);
        assert(mathCount(out) === 1, "只有真正的 $$ 块生成公式块", `count=${mathCount(out)}`);
        assert(out.includes("onerror=alert(1)"), "fence 内容作为文本传给 Lute（不变成真实元素）");
        const fenceInput = luteInputs.find((s) => s.includes("onerror"));
        assert(!!fenceInput && fenceInput.includes("```"), "fence 原样（含围栏标记）交给 Lute", fenceInput && fenceInput.slice(0, 60));
        assert(out.includes("E=mc^2"), "公式块内容保留");
    }

    console.log("== 2. fence 里的 $$ 不生成公式块 ==");
    {
        luteInputs = [];
        const out = mdToSiyuanHTML(["```", "$$", "x=1", "$$", "```", "公式 $$y=2$$"].join("\n"), stubLute);
        assert(mathCount(out) === 1, "fence 内的 $$ 不切分，只有外面的 $$y=2$$ 生成公式块", out);
        assert(out.includes("x=1") && out.includes("y=2"), "内容都在");
    }

    console.log("== 3. 公式属性转义 ==");
    {
        luteInputs = [];
        const out = mdToSiyuanHTML(R`$$a < b & "c"$$`, stubLute);
        const attr = out.match(/data-content="([^"]*)"/);
        assert(attr !== null && decodeURIComponent(attr[1]) === "a &lt; b &amp; &quot;c&quot;",
            "data-content 转义 & < 引号", out);
    }

    console.log("== 4. 链接目标（含 & 引号括号）结构完整交给 Lute ==");
    {
        luteInputs = [];
        const url = R`https://a.b/x?q=1&r=2&s="x"(y)`;
        const out = mdToSiyuanHTML(`[说明](${url})`, stubLute);
        const input = luteInputs[0] || "";
        assert(input.includes(url) && input.includes("[说明]"), "链接整段（含 [说明] 与 URL）原样交给 Lute", input);
        assert(out.includes(url), "输出保留完整 URL", out);
    }

    console.log("== 5. 孤立 $ 遮蔽只防 Lute 错配，恢复后字面一致 ==");
    {
        luteInputs = [];
        const out = mdToSiyuanHTML("费用 $5 与 $x$", stubLute);
        assert(out.includes("费用 $5 与 $x$"), "原文逐字保留（$5 金额不被配对吃掉）", out);
    }

    console.log("== 6. 未闭合 $$ 不生成公式块 ==");
    {
        luteInputs = [];
        const out = mdToSiyuanHTML("$$\nx=1", stubLute);
        assert(mathCount(out) === 0, "未闭合块美元不生成公式块", out);
        assert(out.includes("x=1"), "内容仍在");
    }

    console.log("== 7. 纯文本无介入 ==");
    {
        luteInputs = [];
        const out = mdToSiyuanHTML("普通一句话。", stubLute);
        assert(out.includes("普通一句话。") && mathCount(out) === 0, "普通文本原样");
    }

    console.log(`\nsiyuan-dom 测试: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });