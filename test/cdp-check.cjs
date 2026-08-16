// CDP 驱动思源桌面版进行真实粘贴测试
const http = require("http");

function getJSON(path) {
    return new Promise((resolve, reject) => {
        http.get({host: "127.0.0.1", port: 9222, path}, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => {
                try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
            });
        }).on("error", reject);
    });
}

async function main() {
    const targets = await getJSON("/json/list");
    const page = targets.find((t) => t.type === "page" && t.url.includes("stage/build/app/?"));
    if (!page) { console.log("targets:", targets.map(t => t.url)); throw new Error("main page not found"); }
    console.log("主窗口:", page.title.slice(0, 50));

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
        }
    };
    const evalJS = async (expr, awaitPromise = false) => {
        const id = ++msgId;
        ws.send(JSON.stringify({
            id, method: "Runtime.evaluate",
            params: {expression: expr, returnByValue: true, awaitPromise},
        }));
        const m = await new Promise((res) => pending.set(id, res));
        if (m.result && m.result.exceptionDetails) {
            return {error: m.result.exceptionDetails.text + " " + (m.result.exceptionDetails.exception?.description || "")};
        }
        return m.result?.result?.value;
    };

    // 1. 检查编辑器与插件状态
    const state = await evalJS(`(() => {
        const wysiwyg = document.querySelector(".protyle-wysiwyg");
        const topbarBtn = document.querySelector('[id^="plugin_paste-fixer"]');
        const mathBlocks = document.querySelectorAll('[data-type="NodeMathBlock"]').length;
        const editable = wysiwyg ? wysiwyg.querySelector('[contenteditable="true"]') : null;
        return {
            hasEditor: !!wysiwyg,
            hasEditable: !!editable,
            pluginTopbarBtn: !!topbarBtn,
            mathBlocks,
            docTitle: (document.querySelector(".protyle-title__input") || {}).textContent || "?",
        };
    })()`);
    console.log("编辑器状态:", JSON.stringify(state, null, 1));
    ws.close();
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
