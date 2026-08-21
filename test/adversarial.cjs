/**
 * 对抗用例：针对代码审查发现的疑点做诊断性验证。
 * 输出每个用例的实际结果，用于确认 bug 后再修复。
 * 运行：node test/adversarial.cjs
 */
const path = require("path");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_fix-latex.cjs"), logLevel: "silent",
    });
    await esbuild.build({
        entryPoints: [path.join(root, "src/mathml.ts")],
        bundle: true, format: "cjs", platform: "node",
        external: ["mathml2latex"],
        outfile: path.join(__dirname, "_mathml.cjs"), logLevel: "silent",
    });
    const { fixLatexText } = require("./_fix-latex.cjs");
    const mml = require("./_mathml.cjs");

    const report = [];
    const show = (name, input, output, expected) => {
        const ok = output === expected;
        report.push({ name, input, output, expected, ok });
    };
    const showContains = (name, input, output, needle, expectContain) => {
        const ok = output.includes(needle) === expectContain;
        report.push({ name, input, output, needle, expectContain, ok });
    };

    console.log("== A. 美元符号在普通文本中的误伤 ==");
    let out = fixLatexText("价格 $ 5 和 $ 10 元");
    show("A1 美元前后带空格的金额", "价格 $ 5 和 $ 10 元", out, "价格 $ 5 和 $ 10 元");
    out = fixLatexText("赚了 $ 100，花了 $ 50");
    show("A2 两处带空格金额", "赚了 $ 100，花了 $ 50", out, "赚了 $ 100，花了 $ 50");
    out = fixLatexText("价格 $5 and $10");
    show("A3 无空格金额（既有用例）", "价格 $5 and $10", out, "价格 $5 and $10");

    console.log("== B. 括号内容误判为数学 ==");
    out = fixLatexText("打开 (C:\\Users\\jh) 文件夹");
    show("B1 Windows 路径括号", "打开 (C:\\Users\\jh) 文件夹", out, "打开 (C:\\Users\\jh) 文件夹");
    out = fixLatexText("哈哈 (^_^) 和 (T_T)");
    show("B2 颜文字 (^_^)", "哈哈 (^_^) 和 (T_T)", out, "哈哈 (^_^) 和 (T_T)");
    out = fixLatexText("表情 (^^) 和 (Q_Q)");
    show("B3 颜文字 (^^)", "表情 (^^) 和 (Q_Q)", out, "表情 (^^) 和 (Q_Q)");
    out = fixLatexText("调用 foo(bar_baz) 方法");
    show("B4 函数调用带下划线参数", "调用 foo(bar_baz) 方法", out, "调用 foo(bar_baz) 方法");
    out = fixLatexText("变量 (my_var) 已定义");
    show("B5 变量名带下划线", "变量 (my_var) 已定义", out, "变量 (my_var) 已定义");

    console.log("== C. 裸方括号误判 ==");
    out = fixLatexText("配置 [步骤1=初始化] 完成");
    show("C1 中文方括号含等号", "配置 [步骤1=初始化] 完成", out, "配置 [步骤1=初始化] 完成");
    out = fixLatexText("[[y=Wx]] 双括号");
    show("C2 双层方括号", "[[y=Wx]] 双括号", out, "[[y=Wx]] 双括号");
    out = fixLatexText("求 [x^2] 的导数");
    showContains("C3 单个上标转块级（新行为）", "求 [x^2] 的导数", out, "$$", true);
    out = fixLatexText("[^1] 脚注引用");
    show("C4 脚注引用 [^1] 不误转", "[^1] 脚注引用", out, "[^1] 脚注引用");
    out = fixLatexText("[ref_id] 标识符");
    show("C5 标识符 [ref_id] 不误转", "[ref_id] 标识符", out, "[ref_id] 标识符");

    console.log("== D. 代码围栏保护 ==");
    out = fixLatexText("````\n$x$ 和 $$y$$ 是代码\n````");
    show("D1 四反引号围栏", "````\n$x$ 和 $$y$$ 是代码\n````", out, "````\n$x$ 和 $$y$$ 是代码\n````");
    out = fixLatexText("~~~\n$x$ 代码\n~~~");
    show("D2 波浪线围栏", "~~~\n$x$ 代码\n~~~", out, "~~~\n$x$ 代码\n~~~");

    console.log("== E. 行内公式边界 ==");
    out = fixLatexText("($a_i$) 括号里已有公式");
    show("E1 括号包已有行内公式", "($a_i$) 括号里已有公式", out, "($a_i$) 括号里已有公式");
    out = fixLatexText("式子 $ x $ 和 $ y $ 相邻");
    show("E2 多行内带空格公式", "式子 $ x $ 和 $ y $ 相邻", out, "式子 $x$ 和 $y$ 相邻");

    console.log("== F. 数学区域内容 ==");
    out = fixLatexText("$$\\begin{bmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{bmatrix}$$");
    showContains("F1 矩阵保留", "$$\\begin{bmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{bmatrix}$$", out, "1 & 2 \\\\", true);

    console.log("== G. MathML：Wikipedia 真实页面 ==");
    const wiki = require("fs").readFileSync(path.join(__dirname, "fixtures/web/wiki-gauss.html"), "utf8");
    const dom = new JSDOM(wiki);
    global.DOMParser = dom.window.DOMParser;
    global.Node = dom.window.Node;
    global.HTMLElement = dom.window.HTMLElement;
    const doc = new DOMParser().parseFromString(wiki, "text/html");
    const mathNodes = doc.querySelectorAll("math, mml\\:math, m\\:math");
    console.log("  math 节点数:", mathNodes.length);
    let convOk = 0, convFail = 0;
    for (const el of mathNodes) {
        try {
            const latex = require("mathml2latex").convert(el.outerHTML);
            if (latex && latex.trim()) convOk++;
            else convFail++;
        } catch (e) { convFail++; }
    }
    console.log("  mathml2latex 转换成功:", convOk, "失败:", convFail);

    // 完整走 convertMathMLInHTML（提取一个含 math 的片段，避免整页巨大）
    const bodyHTML = doc.body.innerHTML;
    const m = bodyHTML.match(/<p[^>]*>[\s\S]{0,3000}?<math[\s\S]{0,2000}?<\/math>[\s\S]{0,1000}?<\/p>/i);
    let fragResult = null;
    if (m) {
        const frag = new DOMParser().parseFromString(m[0], "text/html");
        // 直接把 fragment 的 innerHTML 传给转换器
        try {
            fragResult = mml.convertMathMLInHTML(m[0]);
        } catch (e) {
            fragResult = { error: e.message };
        }
    }
    console.log("  片段转换结果:", fragResult ? JSON.stringify(fragResult).slice(0, 300) : "未找到片段");

    console.log("\n===== 汇总 =====");
    for (const r of report) {
        const marker = r.ok ? "PASS" : "FAIL";
        console.log(`[${marker}] ${r.name}`);
        if (!r.ok) console.log(`      输入: ${JSON.stringify(r.input)}`);
        if (!r.ok) console.log(`      输出: ${JSON.stringify(r.output)}`);
    }
    const fails = report.filter((r) => !r.ok);
    console.log(`\n对抗用例: ${report.length - fails.length} 通过, ${fails.length} 失败(疑点确认)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
