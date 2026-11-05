/**
 * 同类插件共存探测（v0.3.0）。
 *
 * 集市里还有别的插件会改写粘贴内容（Achuan-2 的「文本处理」、clock-05 的
 * latex-paste）。两套插件都挂 paste 事件、都改菜单，处理顺序由注册顺序决定，
 * 用户很难判断是谁没生效。这里只做一次提示，不参与任何决策：探测失败按"没有
 * 冲突"处理，绝不影响粘贴本身。
 */

const CONFLICTS: Array<{name: string, pattern: RegExp}> = [
    {name: "text-process", pattern: /(^|[-_])text[-_]?process$/i},
    {name: "latex-paste", pattern: /(^|[-_])latex[-_]?paste$/i},
];

/** 从 /data/plugins 下的目录名里挑出已知会改写粘贴的插件；同名只报一次。 */
export function findConflictingPlugins(names: Iterable<string>): string[] {
    const found: string[] = [];
    for (const name of names) {
        for (const conflict of CONFLICTS) {
            if (!conflict.pattern.test(name)) {
                continue;
            }
            if (!found.includes(conflict.name)) {
                found.push(conflict.name);
            }
        }
    }
    return found;
}
