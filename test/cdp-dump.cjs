// 读取用户文档中粘贴后的实际 DOM 损坏结构（只读）
const http = require("http");

function getJSON(p) {
    return new Promise((resolve, reject) => {
        http.get({host: "127.0.0.1", port: 9222, path: p}, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on("error", reject);
    });
}

async function main() {
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
        pending.set(id, (m) => resolve(m.result?.result?.value ?? {err: JSON.stringify(m.result?.exceptionDetails).slice(0, 300)}));
    });
    const expr = `(() => {
        const wys = document.querySelector(".protyle-wysiwyg");
        if (!wys) return {error: "no wysiwyg"};
        const inlineMath = [...wys.querySelectorAll('[data-type="inline-math"]')];
        const mathBlocks = [...wys.querySelectorAll('[data-type="NodeMathBlock"]')];
        const katexErrs = [...wys.querySelectorAll(".katex-error")];
        const sample = [];
        const walk = (node) => {
            if (sample.length > 60) return;
            if (node.nodeType === 3) {
                if (/[<>$]/.test(node.nodeValue)) sample.push("TXT:" + JSON.stringify(node.nodeValue.slice(0, 70)));
                return;
            }
            const el = node;
            const dt = el.getAttribute && el.getAttribute("data-type");
            const dc = el.getAttribute && el.getAttribute("data-content");
            if (dt === "inline-math" || dt === "NodeMathBlock") {
                sample.push("NODE[" + dt + "]=" + JSON.stringify((dc || "").slice(0, 80)));
            }
            if (el.childNodes) [...el.childNodes].forEach(walk);
        };
        [...wys.childNodes].forEach(walk);
        return {
            inlineMathCount: inlineMath.length,
            inlineContents: inlineMath.map(n => (n.getAttribute("data-content") || "").slice(0, 60)),
            blockCount: mathBlocks.length,
            blockContents: mathBlocks.slice(0, 5).map(n => (n.getAttribute("data-content") || "").slice(0, 60)),
            katexErrors: katexErrs.length,
            katexErrTexts: katexErrs.slice(0, 3).map(n => n.textContent.slice(0, 70)),
            sample,
        };
    })()`;
    const r = await evalJS(expr);
    console.log(JSON.stringify(r, null, 1));
    ws.close();
    process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });