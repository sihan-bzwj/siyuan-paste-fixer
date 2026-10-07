/**
 * i18n 资源文件守卫：JSON 必须可解析、代码可见的键必须齐全且非空。
 *
 * 背景（v0.2.9 现场）：settingUndelimitedDesc 里写了裸 LaTeX 命令 `\lor`、`\neg`，
 * JSON 反斜杠未转义（`\l` 非法转义、`\n` 变真实换行），思源前端 response.json()
 * 解析失败后把整个 i18n 回退成空对象——设置面板所有标题显示为 "undefined"。
 * 文案里再写 LaTeX 命令时必须写成 `\\lor`（JSON 转义后 UI 显示 `\lor`）。
 */
const fs = require("fs");
const path = require("path");

let passed = 0;

function assert(condition, name, detail = "") {
    if (!condition) {
        console.error("  ✗", name, detail ? "\n    " + detail : "");
        process.exitCode = 1;
        return;
    }
    passed++;
    console.log("  ✓", name);
}

// settings.ts 下拉与提示、index.ts 提示语、context-menu/manual-action 回执——
// 代码通过 i18n.xxx 或 i18n[reason] 读取的全部键
const REQUIRED_KEYS = [
    "name", "description", "convertSelection",
    "menuConvert", "menuRevert", "revertDone", "alreadyMath", "looksNotMath",
    "noChange", "done", "noSelection", "fail",
    "settingCodeTitle", "settingCodeDesc",
    "settingAITitle", "settingAIDesc",
    "settingWebTitle", "settingWebDesc",
    "settingMixedTitle", "settingMixedDesc",
    "settingUndelimitedTitle", "settingUndelimitedDesc",
    "settingSmart", "settingConservative", "settingOff",
    "settingHints", "settingHintsDesc",
    "hintCode", "hintAI", "hintAIPassive", "hintWeb", "hintWebPassive",
    "hintMixed", "hintMixedPassive", "hintUndelimited", "hintUndelimitedFixed",
    "hintSwitchConservative", "hintSwitchSmart",
    "hintSwitchedConservative", "hintSwitchedSmart",
    "quickCode", "quickAI", "quickWeb", "quickMixed", "quickUndelimited", "quickHints",
    "crossBlockRefuse", "batchPartial", "blockNeedsWholeBlock", "blockRichRefuse",
    "blockTypeRefuse", "inCodeRange", "hintRichPreserved", "hintPasteRepair",
];

console.log("== A. i18n 目录全部 JSON 可解析（思源 response.json() 不抛错）==");
const i18nDir = path.join(__dirname, "..", "i18n");
const files = fs.readdirSync(i18nDir).filter((f) => f.endsWith(".json"));
assert(files.includes("zh_CN.json"), "存在 zh_CN.json");

let parsed = null;
for (const file of files) {
    const raw = fs.readFileSync(path.join(i18nDir, file), "utf8");
    try {
        parsed = JSON.parse(raw);
        assert(typeof parsed === "object" && parsed !== null, `${file} JSON.parse 通过`);
    } catch (e) {
        assert(false, `${file} JSON.parse 通过`, e.message);
    }
}

console.log("== B. 代码可见的键齐全且非空 ==");
for (const key of REQUIRED_KEYS) {
    const value = parsed ? parsed[key] : undefined;
    assert(typeof value === "string" && value.trim().length > 0, `键 ${key} 存在且非空`);
}

console.log(`\ni18n 资源测试: ${passed} 通过`);
if (process.exitCode) process.exit(process.exitCode);
