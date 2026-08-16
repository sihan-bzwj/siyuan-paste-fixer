// 打开演示文档并截图保存为 preview.png
const http = require("http");
const fs = require("fs");
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
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++msgId;
        ws.send(JSON.stringify({id, method, params}));
        pending.set(id, resolve);
    });
    const evalJS = (expr) => send("Runtime.evaluate", {expression: expr, returnByValue: true});

    // 打开演示文档
    await evalJS(`window.location.href = "siyuan://blocks/20260816151638-auopjqw"`);
    await new Promise((r) => setTimeout(r, 3500)); // 等文档打开 + 公式渲染

    // 隐藏顶栏/底栏让预览更干净？不——保持真实界面。直接截取可视区
    const shot = await send("Page.captureScreenshot", {format: "png"});
    if (shot.result && shot.result.data) {
        fs.writeFileSync(process.argv[2] || "preview.png", Buffer.from(shot.result.data, "base64"));
        console.log("saved preview.png,", Math.round(shot.result.data.length * 3 / 4 / 1024), "KB");
    } else {
        console.log("screenshot failed:", JSON.stringify(shot).slice(0, 200));
    }
    ws.close();
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
