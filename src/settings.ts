/**
 * 设置面板与持久化（v0.2.3 拆分自 index.ts）。
 *
 * 注意：SDK 类型的 Plugin.setting 在运行时可能为 undefined（本地环境实测），
 * 与 text-process 一致地用官方 `new Setting(...)` 自建实例并向插件开放保存回调。
 *
 * 持久化约定：
 * - 加载时校验策略值（smart/fix/pass），非法值回默认；
 * - 保存走串行队列，多次快速点击顶栏时按调用顺序落盘，最后一次操作永远最后生效；
 * - 面板元素创建时动态读取当前设置，顶栏先改策略再开面板不会显示旧值。
 */

import { Setting } from "siyuan";
import { ScenarioPolicy } from "./scenario";

export interface PasteFixerSettings {
    codePolicy?: ScenarioPolicy;
    aiPolicy?: ScenarioPolicy;
    webPolicy?: ScenarioPolicy;
    mixedPolicy?: ScenarioPolicy;
    hintsEnabled?: boolean;
}

export const SETTINGS_PATH = "/data/storage/petal/paste-fixer/data.json";

const POLICY_KEYS = ["codePolicy", "aiPolicy", "webPolicy", "mixedPolicy"] as const;
const VALID_POLICIES: readonly ScenarioPolicy[] = ["smart", "fix", "pass"];

/** 非法/缺失策略值统一回默认（undefined → 调用方用 DEFAULT_POLICY 兜底）。 */
function normalizePolicy(value: unknown): ScenarioPolicy | undefined {
    return VALID_POLICIES.includes(value as ScenarioPolicy) ? value as ScenarioPolicy : undefined;
}

/** 从 petal 文件加载设置；任何失败/非法值都用空对象（默认策略兜底）。 */
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
        const raw = JSON.parse(txt) as Record<string, unknown>;
        const out: PasteFixerSettings = {};
        for (const key of POLICY_KEYS) {
            const v = normalizePolicy(raw[key]);
            if (v) {
                out[key] = v;
            }
        }
        if (typeof raw.hintsEnabled === "boolean") {
            out.hintsEnabled = raw.hintsEnabled;
        }
        return out;
    } catch (e) {
        return {};
    }
}

// 串行保存队列：连写时按调用顺序落盘，避免异步返回乱序导致旧值覆盖新值
let saveChain: Promise<void> = Promise.resolve();

async function putFile(payload: string): Promise<void> {
    const blob = new Blob([payload], {type: "application/json"});
    const fd = new FormData();
    fd.append("file", blob, "data.json");
    fd.append("path", SETTINGS_PATH);
    fd.append("isDir", "false");
    const r = await fetch("/api/file/putFile", {method: "POST", body: fd});
    if (!r.ok) {
        throw new Error("putFile http " + r.status);
    }
    const j = await r.json() as {code?: number, msg?: string};
    if (j.code !== 0) {
        throw new Error(j.msg || "putFile code " + j.code);
    }
}

/** 写入 petal 文件；失败 console.warn（不打扰用户），且不阻断后续保存。 */
export function saveSettingsToFile(settings: PasteFixerSettings): Promise<void> {
    const payload = JSON.stringify(settings);
    saveChain = saveChain
        .then(() => putFile(payload))
        .catch((e) => {
            console.warn("[paste-fixer] 设置保存失败", e instanceof Error ? e.message : e);
        });
    return saveChain;
}

/** 场景策略下拉选项（设置面板与顶栏开关共用文案来源）。 */
export function policyOptions(i18n: Record<string, string>): Array<{text: string, value: string}> {
    return [
        {text: i18n.settingSmart, value: "smart"},
        {text: i18n.settingFix, value: "fix"},
        {text: i18n.settingPass, value: "pass"},
    ];
}

/** 当前生效策略（含默认值兜底）。 */
export function policyOf(settings: PasteFixerSettings, key: (typeof POLICY_KEYS)[number]): ScenarioPolicy {
    return normalizePolicy(settings[key]) ?? "smart";
}

/** 策略下拉元素：创建时动态读取当前设置，变更即时落盘。 */
export function buildPolicySelect(
    i18n: Record<string, string>,
    key: (typeof POLICY_KEYS)[number],
    settings: PasteFixerSettings,
    save: (settings: PasteFixerSettings) => void,
): HTMLElement {
    const select = document.createElement("select");
    select.className = "b3-select";
    const current = policyOf(settings, key);
    for (const opt of policyOptions(i18n)) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.text;
        o.selected = opt.value === current;
        select.appendChild(o);
    }
    select.addEventListener("change", () => {
        settings[key] = normalizePolicy(select.value) ?? "smart";
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
        key: (typeof POLICY_KEYS)[number],
        title: string,
        desc: string,
    ): void => {
        setting.addItem({
            title,
            description: desc,
            direction: "row",
            createActionElement: () => buildPolicySelect(i18n, key, settings, save),
        });
    };
    addSelect("codePolicy", i18n.settingCodeTitle, i18n.settingCodeDesc);
    addSelect("aiPolicy", i18n.settingAITitle, i18n.settingAIDesc);
    addSelect("webPolicy", i18n.settingWebTitle, i18n.settingWebDesc);
    addSelect("mixedPolicy", i18n.settingMixedTitle, i18n.settingMixedDesc);
    setting.addItem({
        title: i18n.settingHints,
        description: i18n.settingHintsDesc,
        direction: "row",
        createActionElement: () => buildHintsCheckbox(settings, save),
    });
    return setting;
}