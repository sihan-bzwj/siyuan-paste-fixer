// v0.2.3 设置模块专项测试（src/settings.ts）
// 覆盖审查要求：非法策略值回默认、面板元素创建时动态读取当前值、
// 保存串行队列（最后一次操作最后落盘）。
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

async function main() {
    // siyuan npm 包只有类型声明，用 stub 提供运行时的 Setting 类
    const stubPath = path.join(__dirname, "_siyuan-stub.cjs");
    require("fs").writeFileSync(stubPath, [
        "class Setting {",
        "    constructor(opts) { this.opts = opts || {}; this.items = []; }",
        "    addItem(item) { this.items.push(item); }",
        "}",
        "module.exports = { Setting };",
        "",
    ].join("\n"));
    await esbuild.build({
        entryPoints: [path.join(root, "src/settings.ts")],
        bundle: true, format: "cjs", platform: "node",
        alias: {"siyuan": stubPath},
        outfile: path.join(__dirname, "_settings.cjs"), logLevel: "silent",
    });
    const S = require("./_settings.cjs");

    const dom = new JSDOM("<!DOCTYPE html><body></body>", {url: "http://localhost/"});
    global.document = dom.window.document;
    global.window = dom.window;

    const i18n = {
        settingSmart: "智能（推荐）",
        settingFix: "始终修复公式",
        settingPass: "始终原样粘贴",
    };
    const tick = () => new Promise((r) => setTimeout(r, 20));

    console.log("== 1. 加载校验：非法策略值回默认 ==");
    {
        global.fetch = async (url) => {
            if (String(url).includes("getFile")) {
                return {ok: true, text: async () => JSON.stringify({
                    codePolicy: "evil",
                    aiPolicy: "fix",
                    webPolicy: 12,
                    mixedPolicy: "smart",
                    hintsEnabled: "no",
                })};
            }
            return {ok: true, text: async () => ""};
        };
        const s = await S.loadSettingsFromFile();
        assert(s.codePolicy === undefined, "非法 codePolicy 回默认");
        assert(s.aiPolicy === "fix", "合法 aiPolicy 保留", s.aiPolicy);
        assert(s.webPolicy === undefined, "非字符串 webPolicy 回默认");
        assert(s.mixedPolicy === "smart", "合法 mixedPolicy 保留");
        assert(s.hintsEnabled === undefined, "非布尔 hintsEnabled 回默认");
    }

    console.log("== 2. 加载容错：坏 JSON / 空文件 ==");
    {
        global.fetch = async (url) => {
            if (String(url).includes("getFile")) {
                return {ok: true, text: async () => "{not json"};
            }
            return {ok: true, text: async () => ""};
        };
        assert(Object.keys(await S.loadSettingsFromFile()).length === 0, "坏 JSON 回空对象");
        global.fetch = async (url) => {
            if (String(url).includes("getFile")) {
                return {ok: true, text: async () => ""};
            }
            return {ok: true, text: async () => ""};
        };
        assert(Object.keys(await S.loadSettingsFromFile()).length === 0, "空文件回空对象");
    }

    console.log("== 3. 保存串行队列：最后一次操作最后落盘 ==");
    {
        let putCalls = [];
        let releaseFirst;
        const gate = new Promise((r) => (releaseFirst = r));
        global.fetch = async (url, opts) => {
            if (String(url).includes("putFile")) {
                const file = opts.body.get("file");
                const payload = await file.text();
                const path_ = opts.body.get("path");
                putCalls.push({payload, path: path_});
                if (putCalls.length === 1) {
                    await gate; // 第一次写入挂起，验证第二次不会并发开始
                }
                return {ok: true, json: async () => ({code: 0})};
            }
            return {ok: true, json: async () => ({code: 0})};
        };
        const p1 = S.saveSettingsToFile({aiPolicy: "fix"});
        const p2 = S.saveSettingsToFile({aiPolicy: "pass"});
        await tick();
        assert(putCalls.length === 1, "第二次保存未并发开始（串行队列）", String(putCalls.length));
        releaseFirst();
        await Promise.all([p1, p2]);
        assert(putCalls.length === 2, "两次都完成", String(putCalls.length));
        assert(putCalls[1].payload === JSON.stringify({aiPolicy: "pass"}), "最后落盘的是最后一次的值", putCalls[1].payload);
        assert(putCalls[0].path === "/data/storage/petal/paste-fixer/data.json", "路径符合 petal 约定", putCalls[0].path);
    }

    console.log("== 3b. 保存失败检查：HTTP 错误 / 内核 code != 0 → warn ==");
    {
        const warns = [];
        const origWarn = console.warn;
        console.warn = (...args) => warns.push(args.join(" "));
        global.fetch = async (url) => {
            if (String(url).includes("putFile")) {
                return {ok: false, status: 500};
            }
            return {ok: true, json: async () => ({code: 0})};
        };
        await S.saveSettingsToFile({aiPolicy: "fix"});
        assert(warns.length === 1 && warns[0].includes("http 500"), "HTTP 失败 → warn", warns.join("|"));
        global.fetch = async (url) => {
            if (String(url).includes("putFile")) {
                return {ok: true, json: async () => ({code: 1, msg: "kernel error"})};
            }
            return {ok: true, json: async () => ({code: 0})};
        };
        await S.saveSettingsToFile({aiPolicy: "pass"});
        assert(warns.length === 2 && warns[1].includes("kernel error"), "内核 code!=0 → warn", warns.join("|"));
        // 成功后不再 warn
        global.fetch = async (url) => {
            if (String(url).includes("putFile")) {
                return {ok: true, json: async () => ({code: 0})};
            }
            return {ok: true, json: async () => ({code: 0})};
        };
        await S.saveSettingsToFile({mixedPolicy: "smart"});
        assert(warns.length === 2, "成功路径不 warn", String(warns.length));
        console.warn = origWarn;
    }

    console.log("== 4. 策略下拉：创建时动态读取当前设置 ==");
    {
        let saved = null;
        const settings = {codePolicy: "pass"};
        const select = S.buildPolicySelect(i18n, "codePolicy", settings, (s) => (saved = s));
        assert(select.value === "pass", "已存 pass 值时下拉初始为 pass", select.value);
        // 顶栏先改策略、再打开面板：新元素必须读到新值
        settings.codePolicy = "fix";
        let saved2 = null;
        const select2 = S.buildPolicySelect(i18n, "codePolicy", settings, (s) => (saved2 = s));
        assert(select2.value === "fix", "面板元素动态读取（顶栏改后不显示旧值）", select2.value);
        // 变更下拉即时落盘
        select2.value = "smart";
        select2.dispatchEvent(new dom.window.Event("change"));
        assert(settings.codePolicy === "smart" && saved2 && saved2.codePolicy === "smart", "change 即写 settings 与保存回调", JSON.stringify(saved2));
    }

    console.log("== 5. 提示开关 ==");
    {
        const settings = {};
        let saved = null;
        const box = S.buildHintsCheckbox(settings, (s) => (saved = s));
        assert(box.checked === true, "默认开启");
        box.checked = false;
        box.dispatchEvent(new dom.window.Event("change"));
        assert(settings.hintsEnabled === false && saved.hintsEnabled === false, "关闭即时落盘");
    }

    console.log("== 6. 设置面板注册（new Setting + 5 项） ==");
    {
        const settings = {};
        const panel = S.createSettingsPanel({
            settingCodeTitle: "代码内容策略", settingCodeDesc: "",
            settingAITitle: "AI 数学文本策略", settingAIDesc: "",
            settingWebTitle: "网页公式策略", settingWebDesc: "",
            settingMixedTitle: "混合内容策略", settingMixedDesc: "",
            settingHints: "场景提示", settingHintsDesc: "",
        }, settings, () => {});
        assert(panel.items.length === 5, "五个设置项", String(panel.items.length));
        assert(typeof panel.opts.confirmCallback === "function", "confirmCallback 注册");
    }

    console.log(`\n设置模块测试: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });