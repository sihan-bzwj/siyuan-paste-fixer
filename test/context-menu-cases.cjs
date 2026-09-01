// v0.2.4 右键菜单专项测试（src/context-menu.ts：common-menu-open 事件化 + 上下文项）
// 覆盖：菜单单例复用（预先存在同一个 .b3-menu）、连续 10 次无重复项/残余 separator、
// open-menu-content 优先接管、dispose 清 owned 标记、末班车 DOM 注入、
// 跨编辑器选区不信任、按上下文显示菜单项（选区=强制转换/公式=还原/光标内=还原/无选区=不显示）。
const path = require("path");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

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

const tick = () => new Promise((r) => setTimeout(r, 20));

const done = (handlers) => {
    document.body.innerHTML = "";
    if (handlers) {
        document.removeEventListener("contextmenu", handlers.onContextMenu, true);
    }
};

async function main() {
    await esbuild.build({
        entryPoints: [path.join(root, "src/fix-latex.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_fix-latex.cjs"), logLevel: "silent",
    });
    await esbuild.build({
        entryPoints: [path.join(root, "src/context-menu.ts")],
        bundle: true, format: "cjs", platform: "node",
        outfile: path.join(__dirname, "_context-menu.cjs"), logLevel: "silent",
    });
    const { fixLatexText } = require("./_fix-latex.cjs");
    const C = require("./_context-menu.cjs");

    const dom = new JSDOM("<!DOCTYPE html><body></body>", {url: "http://localhost/"});
    global.document = dom.window.document;
    global.window = dom.window;
    global.NodeFilter = dom.window.NodeFilter;
    global.InputEvent = dom.window.InputEvent;
    global.MutationObserver = dom.window.MutationObserver;
    global.getSelection = () => dom.window.getSelection();

    const i18n = {menuConvert: "强制转换为公式", menuRevert: "还原为纯文本", fail: "转换失败", noSelection: "请先选中"};
    const mkEditor = () => {
        const editor = document.createElement("div");
        editor.className = "protyle-wysiwyg";
        document.body.appendChild(editor);
        return editor;
    };
    const mkBlock = (editor, id, text) => {
        const div = document.createElement("div");
        div.setAttribute("data-node-id", id);
        div.setAttribute("data-type", "NodeParagraph");
        div.textContent = text;
        editor.appendChild(div);
        return div;
    };
    /** 思源菜单单例：预先存在于 DOM，每次弹出复用同一个元素 */
    const mkSingletonMenu = () => {
        const menu = document.createElement("div");
        menu.className = "b3-menu fn__none";
        const items = document.createElement("div");
        items.className = "b3-menu__items";
        menu.appendChild(items);
        document.body.appendChild(menu);
        return menu;
    };
    const makeHandlers = (attach = true) => {
        const messages = [];
        const handlers = C.createMenuHandlers({
            i18n,
            fixText: fixLatexText,
            convertToPlain: (s) => s,
            i18nGet: (k) => i18n[k] || k,
            showMessage: (m) => messages.push(m),
        });
        if (attach) {
            document.addEventListener("contextmenu", handlers.onContextMenu, true);
        }
        return {handlers, messages};
    };
    const rightClick = (block) => {
        block.dispatchEvent(new dom.window.MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
    };
    const selectIn = (block, start = 0, end) => {
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        const range = document.createRange();
        range.setStart(block.firstChild, start);
        range.setEnd(block.firstChild, end !== undefined ? end : block.firstChild.length);
        sel.addRange(range);
        return range;
    };
    const actions = (menu) => Array.from(menu.querySelectorAll("[data-paste-fixer-action]")).map((el) => el.getAttribute("data-paste-fixer-action"));

    console.log("== 1. 菜单单例复用：有选区时注入「强制转换为公式」 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b1", "x^2 文本");
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu(); // 菜单在右键**之前**就存在（真实思源单例）
        selectIn(block);
        rightClick(block);
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        const owned = menu.querySelectorAll("[data-paste-fixer-owned]");
        assert(owned.length === 2, "注入 2 个 owned 节点（分隔线+一项）", String(owned.length));
        assert(actions(menu).join(",") === "fix", "只有「强制转换为公式」", actions(menu).join(","));
        assert(menu.querySelectorAll(".b3-menu__separator").length === 1, "恰好一个 separator");
        done(handlers);
    }

    console.log("== 2. 选区覆盖公式节点：两项都显示 ==");
    {
        const editor = mkEditor();
        const block = document.createElement("div");
        block.setAttribute("data-node-id", "b2");
        block.setAttribute("data-type", "NodeParagraph");
        block.innerHTML = '前 <span data-type="inline-math" data-subtype="math" data-content="x_i"></span> 后';
        editor.appendChild(block);
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu();
        selectIn(block, 0, block.childNodes.length === 0 ? 0 : undefined);
        // 全选：跨文本节点建 range
        const range = document.createRange();
        range.setStart(block.firstChild, 0);
        range.setEnd(block.lastChild, block.lastChild.length);
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        rightClick(block);
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        assert(actions(menu).sort().join(",") === "fix,revert", "混合选区两项都出（强制转换+还原）", actions(menu).sort().join(","));
        done(handlers);
    }

    console.log("== 3. 光标在公式内：只「还原为纯文本」 ==");
    {
        const editor = mkEditor();
        const block = document.createElement("div");
        block.setAttribute("data-node-id", "b3");
        block.setAttribute("data-type", "NodeParagraph");
        block.innerHTML = '<span data-type="inline-math" data-subtype="math" data-content="x_i"></span>';
        editor.appendChild(block);
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu();
        const span = block.querySelector('[data-type="inline-math"]');
        const range = document.createRange();
        range.setStart(span, 0);
        range.collapse(true);
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        rightClick(block);
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        assert(actions(menu).join(",") === "revert", "光标在公式内只有「还原为纯文本」", actions(menu).join(","));
        done(handlers);
    }

    console.log("== 4. 普通文字且无选择：不显示公式操作 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b4", "普通文字");
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu();
        rightClick(block); // 无选区 → collapsed 在普通文字
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 0, "不注入任何项", String(menu.querySelectorAll("[data-paste-fixer-owned]").length));
        done(handlers);
    }

    console.log("== 5. API 路径：common-menu-open 的 menu 带 addItem 时用 API ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b5", "x^2");
        const {handlers} = makeHandlers();
        selectIn(block);
        rightClick(block);
        let apiCalls = 0;
        handlers.onCommonMenuOpen({detail: {menu: {addItem: () => apiCalls++}}});
        assert(apiCalls === 1, "menu.addItem 调用一次（仅 fix）", String(apiCalls));
        done(handlers);
    }

    console.log("== 6. 连续 10 次右键复用同一菜单：无重复项/残余 separator ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b6", "x^2");
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu();
        for (let i = 1; i <= 10; i++) {
            selectIn(block);
            rightClick(block);
            handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
            const owned = menu.querySelectorAll("[data-paste-fixer-owned]");
            if (owned.length !== 2) {
                assert(false, `第 ${i} 次右键 owned 节点数`, String(owned.length));
                break;
            }
        }
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 2, "10 次后仍只有 2 个 owned 节点");
        assert(menu.querySelectorAll(".b3-menu__separator").length === 1, "10 次后仍只有 1 个 separator（无残余）");
        assert(menu.querySelectorAll(".b3-menu__item").length === 1, "10 次后仍只有 1 个按钮");
        const tips = Array.from(menu.querySelectorAll("[data-paste-fixer-interaction]"))
            .map((el) => el.getAttribute("data-paste-fixer-interaction"));
        assert(new Set(tips).size === 1, "只剩最后一次 interaction 的注入项", tips.join(","));
        done(handlers);
    }

    console.log("== 7. open-menu-content 优先：handled 后 common-menu-open 不再注入 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b7", "x^2");
        const {handlers} = makeHandlers();
        selectIn(block);
        rightClick(block); // 武装
        let apiCalls = 0;
        const range = document.createRange();
        range.setStart(block.firstChild, 0);
        range.setEnd(block.firstChild, 2);
        handlers.onOpenMenuContent({detail: {menu: {addItem: () => apiCalls++}, range}});
        assert(apiCalls === 1, "官方通路 addItem 一次（上下文）", String(apiCalls));
        handlers.onCommonMenuOpen({detail: {menu: {element: null}}});
        const menu = mkSingletonMenu();
        selectIn(block);
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 0, "官方通路到达后 common-menu-open 不再注入");
        done(handlers);
    }

    console.log("== 8. 末班车：两个事件都不触发，超时后注入当前可见菜单 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b8", "x^2");
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu();
        selectIn(block);
        rightClick(block);
        await new Promise((r) => setTimeout(r, 650)); // 超过 500ms 观察窗
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 2, "末班车 DOM 注入出现", String(menu.querySelectorAll("[data-paste-fixer-owned]").length));
        done(handlers);
    }

    console.log("== 9. dispose：清掉 owned 标记（含 separator），无计时器残留 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b9", "x^2");
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu();
        selectIn(block);
        rightClick(block);
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        assert(document.querySelectorAll("[data-paste-fixer-owned]").length === 2, "dispose 前有注入项");
        handlers.dispose();
        await new Promise((r) => setTimeout(r, 650));
        assert(document.querySelectorAll("[data-paste-fixer-owned]").length === 0, "dispose 清除所有 owned 节点（按钮+分隔线）");
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 0, "dispose 后不再注入（armed=false）");
        done(handlers);
    }

    console.log("== 10. 跨编辑器选区不信任：fallback 用目标处 collapsed 选区 ==");
    {
        const editor1 = mkEditor();
        const t1 = mkBlock(editor1, "t1", "左编辑器选中");
        const editor2 = mkEditor();
        const t2 = mkBlock(editor2, "t2", "右编辑器右键");
        const selRange = document.createRange();
        selRange.setStart(t1.firstChild, 0);
        selRange.setEnd(t1.firstChild, 2);
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(selRange);
        const {handlers} = makeHandlers();
        rightClick(t2); // 选区在左编辑器，与右键目标不同 → 忽略
        const menu = mkSingletonMenu();
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 0, "跨编辑器选区不信任：无项（视为无选区）");
        done(handlers);
    }

    console.log("== 11. 同一编辑器选区可信：直接作用于选区 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "t11", "A \\(x\\) B");
        const range = selectIn(block, 0, block.firstChild.length);
        void range;
        let updateCalls = [];
        global.fetch = async (url, opts) => {
            if (String(url).includes("updateBlock")) updateCalls.push(JSON.parse(opts.body));
            return {ok: true, json: async () => ({code: 0})};
        };
        const {handlers, messages} = makeHandlers();
        rightClick(block);
        const menu = mkSingletonMenu();
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        menu.querySelector('[data-paste-fixer-action="fix"]').click();
        await tick();
        assert(updateCalls.length === 1, "整块选区走 updateBlock（选区被采用）", String(updateCalls.length));
        assert(updateCalls[0].data.includes("$x$"), "破损定界符清理后包装", updateCalls[0].data);
        assert(messages.length === 1 && messages[0] === "done", "提示 done", messages.join(","));
        done(handlers);
    }

    console.log("== 12. 代码区域硬边界：代码块/行内代码不出现插件公式操作 ==");
    {
        const editor = mkEditor();
        let block = document.createElement("div");
        block.setAttribute("data-node-id", "c1");
        block.setAttribute("data-type", "NodeCodeBlock");
        block.textContent = "x_i";
        editor.appendChild(block);
        const menu1 = mkSingletonMenu();
        const {handlers: handlers1} = makeHandlers();
        selectIn(block);
        rightClick(block);
        handlers1.onCommonMenuOpen({detail: {menu: {element: menu1}}});
        assert(menu1.querySelectorAll("[data-paste-fixer-owned]").length === 0, "代码块内不注入项");
        done(handlers1);
        document.body.innerHTML = "";

        const editor2 = mkEditor();
        const p = document.createElement("div");
        p.setAttribute("data-node-id", "c2");
        p.setAttribute("data-type", "NodeParagraph");
        p.innerHTML = '前 <span data-type="code">y</span> 后';
        editor2.appendChild(p);
        const menu2 = mkSingletonMenu();
        const {handlers: handlers2} = makeHandlers();
        const range = document.createRange();
        range.setStart(p.firstChild, 0);
        range.setEnd(p.lastChild, p.lastChild.length);
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        rightClick(p);
        handlers2.onCommonMenuOpen({detail: {menu: {element: menu2}}});
        assert(menu2.querySelectorAll("[data-paste-fixer-owned]").length === 0, "含行内代码 span 的选区不注入项");
        done(handlers2);
        document.body.innerHTML = "";
    }

    console.log("== 13. 跨块选区：只显示「还原为纯文本」（公式）/ 不显示（无公式） ==");
    {
        const editor = mkEditor();
        const b1 = document.createElement("div");
        b1.setAttribute("data-node-id", "m1");
        b1.setAttribute("data-type", "NodeParagraph");
        b1.innerHTML = '<span data-type="inline-math" data-subtype="math" data-content="x"></span> 第一段';
        editor.appendChild(b1);
        const b2 = document.createElement("div");
        b2.setAttribute("data-node-id", "m2");
        b2.setAttribute("data-type", "NodeParagraph");
        b2.textContent = "第二段普通文字";
        editor.appendChild(b2);
        const {handlers, messages} = makeHandlers();
        const menu = mkSingletonMenu();
        const range = document.createRange();
        range.setStart(b1.firstChild, 0);
        range.setEnd(b2.firstChild, 4);
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        rightClick(b1);
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        assert(actions(menu).sort().join(",") === "revert", "跨块含公式：只显示「还原为纯文本」", actions(menu).sort().join(","));
        // 点击后节点级还原
        menu.querySelector('[data-paste-fixer-action="revert"]').click();
        await tick();
        assert(b1.querySelector('[data-type="inline-math"]') === null, "跨块还原真实生效", b1.innerHTML);
        assert(b2.textContent === "第二段普通文字", "普通段不碰");
        assert(messages.length === 1 && messages[0] === "revertDone", "提示 revertDone", messages.join(","));
        done(handlers);
        document.body.innerHTML = "";

        // 跨块无公式：什么都不显示
        const editor2 = mkEditor();
        const n1 = mkBlock(editor2, "n1", "甲");
        const n2 = mkBlock(editor2, "n2", "乙");
        const {handlers: h2} = makeHandlers();
        const menu2 = mkSingletonMenu();
        const r2 = document.createRange();
        r2.setStart(n1.firstChild, 0);
        r2.setEnd(n2.firstChild, 1);
        const sel2 = dom.window.getSelection();
        sel2.removeAllRanges();
        sel2.addRange(r2);
        rightClick(n1);
        h2.onCommonMenuOpen({detail: {menu: {element: menu2}}});
        assert(menu2.querySelectorAll("[data-paste-fixer-owned]").length === 0, "跨块无公式：不显示任何项");
        done(h2);
        document.body.innerHTML = "";
    }

    console.log(`\n右键菜单测试: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });