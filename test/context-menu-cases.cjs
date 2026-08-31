// v0.2.3 右键菜单专项测试（src/context-menu.ts，第二轮：common-menu-open 事件化）
// 覆盖审查要求：菜单单例复用（预先存在同一个 .b3-menu）、连续 10 次无重复项/
// 残余 separator、open-menu-content 优先接管、dispose 清 owned 标记、
// 末班车 DOM 注入、跨编辑器选区不信任。
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

    const i18n = {menuConvert: "修复为公式", menuRevert: "还原为纯文本", fail: "转换失败", noSelection: "请先选中"};
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

    console.log("== 1. 菜单单例复用：common-menu-open 注入到已存在的同一菜单 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b1", "选中文本");
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu(); // 菜单在右键**之前**就存在（真实思源单例）
        rightClick(block);
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        const owned = menu.querySelectorAll("[data-paste-fixer-owned]");
        assert(owned.length === 3, "注入 3 个 owned 节点（分隔线+两项）", String(owned.length));
        assert(menu.querySelectorAll(".b3-menu__separator").length === 1, "恰好一个 separator");
        const texts = Array.from(menu.querySelectorAll(".b3-menu__text")).map((el) => el.textContent);
        assert(texts.includes("修复为公式") && texts.includes("还原为纯文本"), "两项标签正确", texts.join(","));
        done(handlers);
    }

    console.log("== 2. API 路径：common-menu-open 的 menu 带 addItem 时用 API ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b2", "text");
        const {handlers} = makeHandlers();
        rightClick(block);
        let apiCalls = 0;
        handlers.onCommonMenuOpen({detail: {menu: {addItem: () => apiCalls++}}});
        assert(apiCalls === 2, "menu.addItem 调用两次", String(apiCalls));
        done(handlers);
    }

    console.log("== 3. 连续 10 次右键复用同一菜单：无重复项/残余 separator ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b3", "text");
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu();
        for (let i = 1; i <= 10; i++) {
            rightClick(block);
            handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
            const owned = menu.querySelectorAll("[data-paste-fixer-owned]");
            if (owned.length !== 3) {
                assert(false, `第 ${i} 次右键 owned 节点数`, String(owned.length));
                break;
            }
        }
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 3, "10 次后仍只有 3 个 owned 节点");
        assert(menu.querySelectorAll(".b3-menu__separator").length === 1, "10 次后仍只有 1 个 separator（无残余）");
        assert(menu.querySelectorAll(".b3-menu__item").length === 2, "10 次后仍只有 2 个按钮");
        const tips = Array.from(menu.querySelectorAll("[data-paste-fixer-interaction]"))
            .map((el) => el.getAttribute("data-paste-fixer-interaction"));
        assert(new Set(tips).size === 1, "只剩最后一次 interaction 的注入项", tips.join(","));
        done(handlers);
    }

    console.log("== 4. open-menu-content 优先：handled 后 common-menu-open 不再注入 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b4", "text");
        const {handlers} = makeHandlers();
        rightClick(block); // 武装
        let apiCalls = 0;
        const range = document.createRange();
        range.setStart(block.firstChild, 0);
        range.setEnd(block.firstChild, 2);
        handlers.onOpenMenuContent({detail: {menu: {addItem: () => apiCalls++}, range}});
        assert(apiCalls === 2, "官方通路 addItem 两次", String(apiCalls));
        handlers.onCommonMenuOpen({detail: {menu: {element: null}}});
        const menu = mkSingletonMenu();
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 0, "官方通路到达后 common-menu-open 不再注入");
        done(handlers);
    }

    console.log("== 5. 末班车：两个事件都不触发，超时后注入当前可见菜单 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b5", "text");
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu();
        rightClick(block);
        await new Promise((r) => setTimeout(r, 650)); // 超过 500ms 观察窗
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 3, "末班车 DOM 注入出现", String(menu.querySelectorAll("[data-paste-fixer-owned]").length));
        done(handlers);
    }

    console.log("== 6. dispose：清掉 owned 标记（含 separator），无计时器残留 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b6", "text");
        const {handlers} = makeHandlers();
        const menu = mkSingletonMenu();
        rightClick(block);
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        assert(document.querySelectorAll("[data-paste-fixer-owned]").length === 3, "dispose 前有注入项");
        handlers.dispose();
        await new Promise((r) => setTimeout(r, 650));
        assert(document.querySelectorAll("[data-paste-fixer-owned]").length === 0, "dispose 清除所有 owned 节点（按钮+分隔线）");
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        assert(menu.querySelectorAll("[data-paste-fixer-owned]").length === 0, "dispose 后不再注入（armed=false）");
        done(handlers);
    }

    console.log("== 7. 跨编辑器选区不信任：fallback 用目标处 collapsed 选区 ==");
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
        const {handlers, messages} = makeHandlers();
        rightClick(t2);
        const menu = mkSingletonMenu();
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        menu.querySelector('[data-paste-fixer-owned][data-paste-fixer-action="fix"]').click();
        await tick();
        assert(messages.length === 1 && messages[0] === "请先选中", "用右编辑器 collapsed 选区执行（提示选择）", messages.join(","));
        done(handlers);
    }

    console.log("== 8. 同一编辑器选区可信：直接作用于选区 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "t8", "A \\(x\\) B");
        const selRange = document.createRange();
        selRange.setStart(block.firstChild, 0);
        selRange.setEnd(block.firstChild, block.firstChild.length);
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(selRange);
        let updateCalls = 0;
        global.fetch = async (url, opts) => {
            if (String(url).includes("updateBlock")) updateCalls++;
            return {ok: true, json: async () => ({code: 0})};
        };
        const {handlers, messages} = makeHandlers();
        rightClick(block);
        const menu = mkSingletonMenu();
        handlers.onCommonMenuOpen({detail: {menu: {element: menu}}});
        menu.querySelector('[data-paste-fixer-action="fix"]').click();
        await tick();
        assert(updateCalls === 1, "整块选区走 updateBlock（选区被采用）", String(updateCalls));
        assert(messages.length === 1 && messages[0] === "done", "提示 done", messages.join(","));
        done(handlers);
    }

    console.log(`\n右键菜单测试: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });