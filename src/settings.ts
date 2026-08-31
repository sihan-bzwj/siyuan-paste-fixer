/**
 * 设置面板与持久化（v0.2.3 拆分自 index.ts）。
 *
 * 注意：SDK 类型的 Plugin.setting 在运行时可能为 undefined（本地环境实测），
 * 与 text-process 一致地用官方 `new Setting(...)` 自建实例并向插件开放保存回调。
 */

import { Setting } from "siyuan";

export interface PasteFixerSettings {
    codePolicy?: string;
    aiPolicy?: string;
    webPolicy?: string;
    mixedPolicy?: string;
    hintsEnabled?: boolean;
}

export const SETTINGS_PATH = "/data/storage/petal/paste-fixer/data.json";

/** 从 petal 文件加载设置；任何失败都用空对象（默认策略兜底）。 */
export async function loadSettingsFromFile(): Promise<PasteFixerSettings> {
    try {
        const r = await fetch("/api/file/getFile", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({path: SETTINGS_PATH}),
        });
        if (!r.ok) {
            return {};
        }
        const txt = await r.text();
        if (!txt || !txt.trim()) {
            return {};
        }
        return JSON.parse(txt) as PasteFixerSettings;
    } catch (e) {
        return {};
    }
}

/** 写入 petal 文件（putFile 为 multipart 接口，与思源存储约定一致）。 */
export async function saveSettingsToFile(settings: PasteFixerSettings): Promise<void> {
    try {
        const blob = new Blob([JSON.stringify(settings)], {type: "application/json"});
        const fd = new FormData();
        fd.append("file", blob, "data.json");
        fd.append("path", SETTINGS_PATH);
        fd.append("isDir", "false");
        await fetch("/api/file/putFile", {method: "POST", body: fd});
    } catch (e) {
        /* 持久化失败不影响本次会话行为 */
    }
}

/** 场景策略下拉选项（设置面板与顶栏开关共用文案来源）。 */
export function policyOptions(i18n: Record<string, string>): Array<{text: string, value: string}> {
    return [
        {text: i18n.settingSmart, value: "smart"},
        {text: i18n.settingFix, value: "fix"},
        {text: i18n.settingPass, value: "pass"},
    ];
}

/** 策略下拉元素：变更即时落盘。 */
export function buildPolicySelect(
    i18n: Record<string, string>,
    key: string,
    currentValue: string,
    settings: PasteFixerSettings,
    save: (settings: PasteFixerSettings) => void,
): HTMLElement {
    const select = document.createElement("select");
    select.className = "b3-select";
    for (const opt of policyOptions(i18n)) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.text;
        o.selected = opt.value === currentValue;
        select.appendChild(o);
    }
    select.addEventListener("change", () => {
        (settings as unknown as Record<string, unknown>)[key] = select.value;
        save(settings);
    });
    return select;
}

/** 提示开关元素：变更即时落盘。 */
export function buildHintsCheckbox(
    settings: PasteFixerSettings,
    save: (settings: PasteFixerSettings) => void,
): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "b3-switch";
    box.checked = settings.hintsEnabled !== false;
    box.addEventListener("change", () => {
        settings.hintsEnabled = box.checked;
        save(settings);
    });
    return box;
}

/**
 * 注册设置面板（官方 API：new Setting + addItem）。
 * 五组：四个场景策略下拉 + 场景提示开关。任何失败不影响粘贴修复。
 */
export function createSettingsPanel(
    i18n: Record<string, string>,
    settings: PasteFixerSettings,
    save: (settings: PasteFixerSettings) => void,
): Setting {
    const setting = new Setting({confirmCallback: () => save(settings)});
    const addSelect = (
        key: "codePolicy" | "aiPolicy" | "webPolicy" | "mixedPolicy",
        title: string,
        desc: string,
        current: string,
    ): void => {
        setting.addItem({
            title,
            description: desc,
            direction: "row",
            createActionElement: () => buildPolicySelect(i18n, key, current, settings, save),
        });
    };
    addSelect("codePolicy", i18n.settingCodeTitle, i18n.settingCodeDesc, settings.codePolicy || "smart");
    addSelect("aiPolicy", i18n.settingAITitle, i18n.settingAIDesc, settings.aiPolicy || "smart");
    addSelect("webPolicy", i18n.settingWebTitle, i18n.settingWebDesc, settings.webPolicy || "smart");
    addSelect("mixedPolicy", i18n.settingMixedTitle, i18n.settingMixedDesc, settings.mixedPolicy || "smart");
    setting.addItem({
        title: i18n.settingHints,
        description: i18n.settingHintsDesc,
        direction: "row",
        createActionElement: () => buildHintsCheckbox(settings, save),
    });
    return setting;
}