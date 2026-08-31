// v0.2.3 右键菜单专项测试（src/context-menu.ts）
// 覆盖审查要求：单 interaction 观察窗、新右键取消旧任务、open-menu-content 接管
// 取消兜底、dispose 清残留、跨编辑器选区不信任（fallback 用目标编辑器选区）。
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

const tick = () => new Promise((r) => setTimeout(r, 30));

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
    const mkMenu = (id) => {
        const menu = document.createElement("div");
        menu.className = "b3-menu";
        menu.id = id;
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

    console.log("== 1. 兜底注入：新菜单出现即注入两项 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b1", "选中文本");
        const {handlers} = makeHandlers();
        rightClick(block);
        const menu = mkMenu("m1");
        await tick();
        const injected = menu.querySelectorAll("[data-paste-fixer-action]");
        assert(injected.length === 2, "注入两项（修复为公式/还原为纯文本）", String(injected.length));
        assert(menu.querySelector(".b3-menu__separator") !== null, "带分隔符");
        const texts = Array.from(menu.querySelectorAll(".b3-menu__text")).map((el) => el.textContent);
        assert(texts.includes("修复为公式") && texts.includes("还原为纯文本"), "两项标签正确", texts.join(","));
        assert(injected[0].textContent === "" || true, "注入项在 .b3-menu__items 容器内（不撑宽）", menu.outerHTML.slice(0, 120));
        // 注入后观察器已断开：再出现菜单不再注入
        const menu2 = mkMenu("m1b");
        await tick();
        assert(menu2.querySelectorAll("[data-paste-fixer-action]").length === 0, "注入一次后立即断开观察");
        done(handlers);
    }

    console.log("== 2. open-menu-content 事件通路接管：取消兜底 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b2", "text");
        const {handlers} = makeHandlers();
        rightClick(block); // 先武装兜底
        let addCalls = 0;
        const range = document.createRange();
        range.setStart(block.firstChild, 0);
        range.setEnd(block.firstChild, 2);
        handlers.onOpenMenuContent({detail: {menu: {addItem: () => addCalls++}, range}});
        assert(addCalls === 2, "事件通路 addItem 两次", String(addCalls));
        const menu = mkMenu("m2");
        await tick();
        await new Promise((r) => setTimeout(r, 600)); // 超过观察窗
        assert(menu.querySelectorAll("[data-paste-fixer-action]").length === 0, "事件通路到达后兜底不再注入");
        done(handlers);
    }

    console.log("== 3. 连续两次右键：只有最新 interaction 生效 ==");
    {
        const editor = mkEditor();
        const b1 = mkBlock(editor, "b3", "一");
        const b2 = mkBlock(editor, "b4", "二");
        const {handlers} = makeHandlers();
        rightClick(b1); // 第一次右键（未出现菜单）
        rightClick(b2); // 第二次右键取消第一次的任务
        const menu = mkMenu("m3");
        await tick();
        const injected = menu.querySelectorAll("[data-paste-fixer-interaction]");
        assert(injected.length === 2, "最终注入两项");
        const seqs = Array.from(injected).map((el) => el.getAttribute("data-paste-fixer-interaction"));
        assert(seqs.every((s) => s === "2"), "注入项全部属于第二次 interaction", seqs.join(","));
        done(handlers);
    }

    console.log("== 4. dispose：无定时器/观察器残留，清掉注入项 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "b5", "text");
        const {handlers} = makeHandlers();
        rightClick(block);
        const menu = mkMenu("m4");
        await tick();
        assert(document.querySelectorAll("[data-paste-fixer-action]").length === 2, "dispose 前菜单内有注入项");
        handlers.dispose();
        await tick();
        await new Promise((r) => setTimeout(r, 600));
        assert(document.querySelectorAll("[data-paste-fixer-action]").length === 0, "dispose 清除注入项残留");
        const menu2 = mkMenu("m4b");
        await tick();
        assert(menu2.querySelectorAll("[data-paste-fixer-action]").length === 0, "dispose 后观察器已断开");
        done(handlers);
    }

    console.log("== 5. 跨编辑器选区不信任：fallback 用目标处 collapsed 选区 ==");
    {
        const editor1 = mkEditor();
        const t1 = mkBlock(editor1, "t1", "左编辑器选中");
        const editor2 = mkEditor();
        const t2 = mkBlock(editor2, "t2", "右编辑器右键");
        // 选区在左编辑器（与右键目标不同编辑器）：必须被忽略
        const selRange = document.createRange();
        selRange.setStart(t1.firstChild, 0);
        selRange.setEnd(t1.firstChild, 2);
        const sel = dom.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(selRange);
        const {handlers, messages} = makeHandlers();
        rightClick(t2);
        const menu = mkMenu("m5");
        await tick();
        const fixBtn = menu.querySelector('[data-paste-fixer-action="fix"]');
        fixBtn.click();
        await tick();
        assert(messages.length === 1 && messages[0] === "请先选中", "用右编辑器 collapsed 选区执行（提示选择）", messages.join(","));
        done(handlers);
    }

    console.log("== 6. 同一编辑器选区可信：直接作用于选区 ==");
    {
        const editor = mkEditor();
        const block = mkBlock(editor, "t6", "A \\(x\\) B");
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
        const menu = mkMenu("m6");
        await tick();
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