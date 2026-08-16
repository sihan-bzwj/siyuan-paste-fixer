// CDP 真实粘贴测试：派发 ClipboardEvent，验证插件双通道转换
const http = require("http");
const fs = require("fs");
const path = require("path");

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
    const original = fs.readFileSync(path.join(__dirname, "fixtures/ghost2-original.txt"), "utf8");
    const targets = await getJSON("/json/list");
    const page = targets.find((t) => t.type === "page" && t.url.includes("stage/build/app/?"));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const evalJS = (expr) => new Promise((resolve) => {
        const id = ++msgId;
        ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, returnByValue: true}}));
        pending.set(id, (m) => resolve(m.result));
    });

    const payload = JSON.stringify(original);
    const before = await evalJS(`document.querySelectorAll('[data-type="NodeMathBlock"]').length`);
    console.log("粘贴前公式块数:", before.result?.value);

    // 聚焦编辑器 + 派发带破损文本的真实 paste 事件
    const r = await evalJS(`(() => {
        try {
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
            dt.setData("text/plain", ${payload});
            const ev = new ClipboardEvent("paste", {clipboardData: dt, bubbles: true, cancelable: true});
            editable.dispatchEvent(ev);
            return "dispatched";
        } catch (e) { return "ERR: " + e.message; }
    })()`);
    console.log("派发结果:", r.result?.value, r.exceptionDetails ? r.exceptionDetails.text : "");

    // 等待插入与渲染
    await new Promise((res) => setTimeout(res, 2500));
    const after = await evalJS(`(() => ({
        mathBlocks: document.querySelectorAll('[data-type="NodeMathBlock"]').length,
        inlineMath: document.querySelectorAll('[data-type="inline-math"]').length,
        lastText: (Array.from(document.querySelectorAll('.protyle-wysiwyg [contenteditable]')).slice(-8)
            .map(e => e.textContent.slice(0, 40)).join(" | ")),
    }))()`);
    console.log("粘贴后:", JSON.stringify(after.result?.value, null, 1));
    ws.close();
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
