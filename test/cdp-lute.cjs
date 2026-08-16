// 探测全局 Lute：能否自建实例 + Md2BlockDOM 输出形态
const http = require("http");
http.get({host: "127.0.0.1", port: 9222, path: "/json/list"}, (res) => {
    let d = ""; res.on("data", (c) => d += c); res.on("end", () => {
        const page = JSON.parse(d).find((t) => t.url.includes("stage/build/app/?"));
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        const js = `(() => {
            const L = window.Lute;
            if (!L) return "no global Lute";
            let inst = null;
            try { inst = L.New(); } catch (e) { return "New() failed: " + e.message; }
            const r = {newNodeID: typeof L.NewNodeID};
            try {
                inst.SetInlineMath(true);
                const dom = inst.Md2BlockDOM("T1\\n\\n$x_i$\\n\\n$$\\ny=Wx\\n$$");
                r.md2dom = dom.slice(0, 400);
            } catch (e) { r.domErr = e.message; }
            return JSON.stringify(r);
        })()`;
        ws.onopen = () => ws.send(JSON.stringify({id: 1, method: "Runtime.evaluate", params: {expression: js, returnByValue: true}}));
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); console.log(m.result?.result?.value); process.exit(0); };
    });
}).on("error", (e) => console.log("ERR", e.message));
