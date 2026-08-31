// CDP 粘贴验证（阶段 2）：真实编辑器里粘夹具，检查修复效果
const http = require("http");
const fs = require("fs");
const path = require("path");
const katex = require("katex");

const DOC_ID = "20260831185315-sfsje3w";

function getJSON(p) {
    return new Promise((resolve, reject) => {
        http.get({host: "127.0.0.1", port: 9222, path: p}, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on("error", reject);
    });
}

async function connect() {
    const targets = await getJSON("/json/list");
    const page = targets.find((t) => t.type === "page" && t.url.includes("stage/build/app/"));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const evalJS = (expr, awaitPromise = false) => new Promise((resolve) => {
        const id = ++msgId;
        ws.send(JSON.stringify({id, method: "Runtime.evaluate",
            params: {expression: expr, returnByValue: true, awaitPromise}}));
        pending.set(id, (m) => {
            if (m.result && m.result.exceptionDetails) {
                resolve({error: m.result.exceptionDetails.text + " " +
                    (m.result.exceptionDetails.exception?.description || "")});
            } else {
                resolve(m.result?.result?.value);
            }
        });
    });
    return {ws, evalJS};
}

async function openDoc(evalJS, docId) {
    return evalJS(`(async () => {
        // 展开所有笔记本根节点，再找文档
        const roots = [...document.querySelectorAll('.file-tree [data-type="navigation-root"], .file-tree .b3-list-item--category')];
        for (const root of roots) {
            if (root.querySelector('.arrow') && !root.classList.contains('b3-list-item--focus')
                && root.getAttribute('data-type') !== 'navigation-root') {
                // 已展开的不重复点
            }
        }
        for (let attempt = 0; attempt < 30; attempt++) {
            const item = document.querySelector('.file-tree [data-node-id="${docId}"]');
            if (item) {
                item.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
                item.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
                item.dispatchEvent(new MouseEvent("click", {bubbles: true}));
                return "clicked@try" + attempt;
            }
            // 尝试点击根节点展开
            const rootItem = document.querySelector('.file-tree [data-type="navigation-root"]');
            if (rootItem) rootItem.dispatchEvent(new MouseEvent("click", {bubbles: true}));
            await new Promise(r => setTimeout(r, 400));
        }
        return "not-found";
    })()`, true);
}

async function pastePlain(evalJS, text) {
    const payload = JSON.stringify(text);
    return evalJS(`(() => {
        const wysiwyg = document.querySelector(".protyle-wysiwyg");
        if (!wysiwyg) return {error: "no editor"};
        const editable = wysiwyg.querySelector('[contenteditable="true"]');
        editable.focus();
        const sel = getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        const dt = new DataTransfer();
        dt.setData("text/plain", ${payload});
        const ev = new ClipboardEvent("paste", {clipboardData: dt, bubbles: true, cancelable: true});
        editable.dispatchEvent(ev);
        return "dispatched";
    })()`);
}

async function dumpStats(evalJS, label) {
    const r = await evalJS(`(() => {
        const wys = document.querySelector(".protyle-wysiwyg");
        const inline = [...wys.querySelectorAll('[data-type="inline-math"]')];
        const blocks = [...wys.querySelectorAll('[data-type="NodeMathBlock"]')];
        const errs = [...wys.querySelectorAll(".katex-error")];
        const texts = inline.map(n => (n.getAttribute("data-content") || "").slice(0, 40));
        const rawDollar = wys.innerText.includes("$0<x") || wys.innerText.includes('$2\\cos');
        const feff = wys.innerText.includes("\ufeff");
        return {
            docId: document.querySelector(".protyle")?.getAttribute("data-node-id"),
            inlineCount: inline.length,
            inlineContents: texts,
            blockCount: blocks.length,
            katexErrors: errs.length,
            errTexts: errs.slice(0, 2).map(e => e.textContent.slice(0, 60)),
            rawDollarLeft: rawDollar,
            feffLeft: feff,
        };
    })()`);
    console.log("== " + label + " ==");
    console.log(JSON.stringify(r, null, 1));
    return r;
}

async function main() {
    const {ws, evalJS} = await connect();

    const opened = await openDoc(evalJS, DOC_ID);
    console.log("打开:", JSON.stringify(opened));
    await new Promise((r) => setTimeout(r, 2500));
    const docCheck = await evalJS(`document.querySelector(".protyle")?.getAttribute("data-node-id")`);
    console.log("当前编辑器文档:", docCheck);
    if (docCheck !== DOC_ID) {
        console.log("文档未打开，尝试刷新页面后重试...");
        await evalJS(`location.reload()`, false);
        ws.close();
        await new Promise((r) => setTimeout(r, 6000));
        return await retryAfterReload();
    }

    // A: 纯 plain 粘贴夹具
    const fixture = fs.readFileSync(path.join(__dirname, "fixtures/boxed-recursion-plain.txt"), "utf8");
    const r1 = await pastePlain(evalJS, fixture);
    console.log("粘贴A:", JSON.stringify(r1));
    await new Promise((r) => setTimeout(r, 3000));
    await dumpStats(evalJS, "纯 plain 粘贴结果");

    // B: 带 KaTeX HTML + FEFF 的划选复制形态（单段验证 FEFF 清理）
    const fragPlain = "因为 $y_0\\ge2$，所以 $0<x\\le1$。而 $x$ 是方程。";
    const fragHtml = '<p>因为 <span class="katex"><span class="katex-mathml"><math><semantics>' +
        '<row><mi>y</mi><mn>0</mn><mo>≥</mo><mn>2</mn></row>' +
        '<annotation encoding="application/x-tex">y_0\\ge2</annotation></semantics></math></span>' +
        '<span class="katex-html">visual</span></span>&#65279;，所以 <span class="katex">' +
        '<span class="katex-mathml"><math><semantics><row><mn>0</mn><mo>&lt;</mo><mi>x</mi><mo>≤</mo><mn>1</mn></row>' +
        '<annotation encoding="application/x-tex">0&lt;x\\le1</annotation></semantics></math></span>' +
        '<span class="katex-html">visual</span></span>&#65279;。而 <span class="katex">' +
        '<span class="katex-mathml"><math><semantics><row><mi>x</mi></row>' +
        '<annotation encoding="application/x-tex">x</annotation></semantics></math></span>' +
        '<span class="katex-html">visual</span></span>&#65279; 是方程。</p>';
    const payload = {plain: fragPlain, html: fragHtml};
    const r2 = await evalJS(`(() => {
        const wysiwyg = document.querySelector(".protyle-wysiwyg");
        const editable = wysiwyg.querySelector('[contenteditable="true"]');
        editable.focus();
        const sel = getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        const dt = new DataTransfer();
        dt.setData("text/plain", ${JSON.stringify(payload.plain)});
        dt.setData("text/html", ${JSON.stringify(payload.html)});
        const ev = new ClipboardEvent("paste", {clipboardData: dt, bubbles: true, cancelable: true});
        editable.dispatchEvent(ev);
        return "dispatched";
    })()`);
    console.log("粘贴B:", JSON.stringify(r2));
    await new Promise((r) => setTimeout(r, 3000));
    await dumpStats(evalJS, "KaTeX HTML + FEFF 剪贴板结果");

    ws.close();
    process.exit(0);
}

async function retryAfterReload() {
    const {ws, evalJS} = await connect();
    const opened = await openDoc(evalJS, DOC_ID);
    console.log("重开:", JSON.stringify(opened));
    await new Promise((r) => setTimeout(r, 2500));
    console.log("当前编辑器文档:", await evalJS(`document.querySelector(".protyle")?.getAttribute("data-node-id")`));
    ws.close();
    process.exit(0);
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });