// 用前端 window.Lute 直接实测行内数学配对规则（只读，不碰文档）
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
        pending.set(id, (m) => resolve(m.result?.result?.value ?? {err: JSON.stringify(m.result?.exceptionDetails).slice(0, 200)}));
    });

    // 用插件同一配置的 Lute 实例
    const cases = [
        "A $y_0\\ge2$ B",        // 常规字母开头
        "A $0<x\\le1$ B",        // 数字开头（用户案例）
        "A $2x$ B",              // 数字开头
        "A $4^n$ B",             // 数字开头上标
        "A $x_1$ B",             // 字母开头下标
        "A $2$ B",               // 纯数字
        "A $(x)$ B",             // 括号开头
        "A $x+1$ B",             // 含 +
        "A $-x$ B",              // 负号开头
        "A $\\frac12$ B",        // 命令开头
        "A $x_i$点 B",           // 中文直接贴闭合（#12178）
        "A $x_i$，B",            // 中文逗号贴闭合
        "A $x_i$。B",            // 中文句号贴闭合
        "A $x_i$$y_j$ B",        // 紧邻两公式
        "A $x$ $y$ B",           // 空格间隔两公式
        "A $x_y$ B",
        "A $3.14$ B",            // 小数
        "A $x<y$ B",             // 尖括号
        "A $f(x)$ B",            // 函数括号
        "A $x\\in\\mathbb R$ B",
    ];
    const list = JSON.stringify(cases.map((c) => c.replace(/\\/g, "\\\\")));
    const r = await evalJS(`(() => {
        const L = window.Lute && window.Lute.New();
        if (!L) return {error: "no Lute"};
        L.SetInlineMath(true); L.SetInlineAsterisk(true); L.SetGFMStrikethrough(true);
        L.SetSub(true); L.SetSup(true); L.SetTag(true); L.SetInlineUnderscore(true);
        const cases = ${list};
        return cases.map((c) => {
            const html = L.Md2BlockDOM(c);
            const m = html.match(/data-content="([^"]*)"/g) || [];
            return {in: c, match: html.includes("inline-math"), contents: m.slice(0, 3)};
        });
    })()`);
    for (const row of r) {
        const mark = row.match ? "MATH" : "TEXT";
        console.log("[" + mark + "] " + JSON.stringify(row.in) + " -> " + JSON.stringify(row.contents));
    }
    ws.close();
    process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });