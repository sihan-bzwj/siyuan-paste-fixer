// 最小样例：$$ 块在思源前端粘贴路径的解析结果
const http = require("http");
function getJSON(p) {
    return new Promise((resolve, reject) => {
        http.get({host: "127.0.0.1", port: 9222, path: p}, (res) => {
            let d = ""; res.on("data", (c) => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on("error", reject);
    });
}
async function main() {
    const targets = await getJSON("/json/list");
    const page = targets.find((t) => t.type === "page" && t.url.includes("stage/build/app/?"));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const evalJS = (expr) => new Promise((resolve) => {
        const id = ++msgId;
        ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: expr, returnByValue: true}}));
        pending.set(id, resolve);
    });

    const before = (await evalJS(`document.querySelectorAll('[data-type="NodeMathBlock"]').length`)).result?.result?.value;

    // 派发仅含一个 $$ 块的粘贴（绕过插件：直接标 __pasteFixer 让 DOM 通道放行）
    const r = await evalJS(`(() => {
        try {
            const editable = document.querySelector(".protyle-wysiwyg [contenteditable='true']");
            editable.focus();
            const dt = new DataTransfer();
            dt.setData("text/plain", "标记A\\n\\n$$\\nx=1\\n$$\\n\\n标记B");
            const ev = new ClipboardEvent("paste", {clipboardData: dt, bubbles: true, cancelable: true});
            ev.__pasteFixer = true;
            editable.dispatchEvent(ev);
            return "ok";
        } catch (e) { return "ERR:" + e.message; }
    })()`);
    console.log("派发:", r.result?.result?.value);
    await new Promise((res) => setTimeout(res, 1500));
    const after = await evalJS(`(() => {
        const blocks = Array.from(document.querySelectorAll(".protyle-wysiwyg > div")).slice(-6);
        return blocks.map((b) => ({
            type: b.getAttribute("data-type"),
            md: (b.getAttribute("data-content") || b.textContent || "").slice(0, 60),
        }));
    })()`);
    console.log("最后6个块:", JSON.stringify(after.result?.result?.value, null, 1));
    ws.close();
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
