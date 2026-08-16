// 栈实现 convertBareBlocks 专项边界用例（编码真实设计行为）
const { fixLatexText } = require("./_fix-latex.cjs");
let fail = 0;
const t = (name, cond, extra) => {
    if (cond) console.log(" ✓", name);
    else { fail++; console.log(" ✗", name, extra ? "| " + JSON.stringify(extra).slice(0, 80) : ""); }
};

// 1. 含 = 的中文方括号按等号规则整体转换（既有行为，夹具依赖）
let r = fixLatexText("[普通 [y=Wx] 文字]");
t("含等号嵌套块整体转换（既有规则）", r.includes("$$") && r.includes("[y=Wx]"), r);

// 2. 多层嵌套不破坏输出
r = fixLatexText("[a [b [x_i]]]");
t("三层嵌套不损坏内容", r.includes("x_i"), r);

// 3. 转义定界符不干扰裸块扫描
r = fixLatexText("\\[已转义\\] 和 [y=Wx]");
t("\\\\[ 不干扰裸块", r.includes("$$\ny=Wx\n$$"), r);

// 4. 数组与链接不误转
r = fixLatexText("[2,3,4] 和 [链接](https://a.b)");
t("数组/链接不误转", r === "[2,3,4] 和 [链接](https://a.b)", r);

// 5. 相邻块：紧贴的 [x][y] 触发链接引用守卫跳过第一个（防 [ref][id]）；带分隔符则全转
r = fixLatexText("[y=Wx][a=x]");
t("紧贴块触发链接守卫（既有行为）", !r.includes("$$\ny=Wx"), r);
r = fixLatexText("[y=Wx] [a=x]");
t("带空格相邻块全转", r.includes("$$\ny=Wx\n$$") && r.includes("$$\na=x\n$$"), r);

// 6. 病态输入：快速完成、不损坏内容（未闭合 [ 淹没后续块属可接受降级）
const big = "[".repeat(50000) + "\n[y=Wx]";
const t0 = Date.now();
r = fixLatexText(big);
t("5 万未闭合 [ 秒回不损坏", Date.now() - t0 < 2000 && r.length === big.length, (Date.now() - t0) + "ms");

// 7. 幂等性：已修复文本再过一遍不变化
const fixed1 = fixLatexText("[ y=Wx ]");
const fixed2 = fixLatexText(fixed1);
t("修复幂等（二次处理不变）", fixed1 === fixed2, [fixed1, fixed2]);

console.log(fail === 0 ? "\n栈实现专项用例全部通过" : "\n失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
