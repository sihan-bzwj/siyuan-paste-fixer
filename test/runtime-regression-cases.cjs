/**
 * 真实粘贴问题的回归测试。
 * 直接执行打包后的插件，并复现思源 3.8.6 的“可取消事件 + 微任务 resolve”协议。
 * 笔记接口使用记录桩；这里验证控制流程，不把桩测试声称为真实落盘。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const katex = require('katex');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '..');
let passed = 0;
let bundle;
const raw = String.raw;
function check(name, run) { run(); passed++; console.log('  ✓', name); }

/** 隔离运行时：计时器可手动推进，取消动作也真实删除待执行任务。 */
function runtime(settings = {}) {
    const dom = new JSDOM('<!doctype html><body></body>', {url: 'http://test.invalid', runScripts: 'outside-only'});
    const win = dom.window, timers = new Map(), writes = [];
    let nextTimer = 0;
    win.setTimeout = fn => { timers.set(++nextTimer, fn); return nextTimer; };
    win.clearTimeout = id => timers.delete(id);
    win.fetch = async (url, options) => {
        if (url === '/api/block/updateBlock') writes.push(JSON.parse(options.body));
        return {ok: true, json: async () => ({code: 0})};
    };
    class Plugin {
        constructor() {
            this.i18n = JSON.parse(fs.readFileSync(path.join(root, 'i18n/zh_CN.json'), 'utf8'));
            const target = new win.EventTarget();
            this.eventBus = {
                on: (name, listener) => target.addEventListener(name, listener),
                off: (name, listener) => target.removeEventListener(name, listener),
                emit: (name, detail) => target.dispatchEvent(new win.CustomEvent(name, {detail, cancelable: true})),
            };
        }
    }
    const sdk = {Plugin, showMessage() {}, Menu: class {}, Setting: class {}};
    const module = {exports: {}};
    win.eval('(function(require,module,exports){' + bundle + '\n})')(name => {
        if (name === 'siyuan') return sdk;
        throw new Error('未知运行时依赖：' + name);
    }, module, module.exports);
    const plugin = new module.exports.default();
    plugin.settings = {...settings};
    plugin.eventBus.on('paste', plugin.onPaste);
    return {dom, win, plugin, timers, writes};
}

/** 与思源粘贴调度相同：未取消时立即放行，resolve 在微任务里生效。 */
async function hostPaste(rt, textPlain, extra = {}) {
    let resolved = false;
    const result = await new Promise(finish => {
        const detail = {textPlain, textHTML: '', siyuanHTML: '', files: [], ...extra,
            resolve: value => { resolved = true; Promise.resolve(value).then(finish); }};
        if (rt.plugin.eventBus.emit('paste', detail)) finish(undefined);
    });
    return {result, resolved};
}

function editor(rt) {
    const element = rt.win.document.createElement('div');
    element.className = 'protyle-wysiwyg';
    const target = rt.win.document.createElement('div');
    element.append(target);
    rt.win.document.body.append(element);
    return {element, target};
}
function capture(rt, target, input, textHTML = '') {
    rt.plugin.onDomPaste({target, clipboardData: {files: [], getData: type => type === 'text/plain' ? input : type === 'text/html' ? textHTML : ''}});
}
function addBroken(rt, element, id) {
    const block = rt.win.document.createElement('div');
    block.dataset.nodeId = id;
    block.dataset.type = 'NodeParagraph';
    block.innerHTML = '<div contenteditable="true"><span data-type="inline-math" data-content="\\proptoe" class="ft__error">KaTeX parse error</span></div>';
    element.append(block);
    return block;
}
async function tick(rt) {
    const first = rt.timers.entries().next().value;
    if (first) { rt.timers.delete(first[0]); first[1](); }
    await new Promise(resolve => setImmediate(resolve));
}
function assertParseable(markdown) {
    for (const match of markdown.matchAll(/\$([^$\n]+)\$/g)) katex.renderToString(match[1], {throwOnError: true, strict: 'ignore'});
}

async function main() {
    const built = await esbuild.build({entryPoints: [path.join(root, 'src/index.ts')], bundle: true, format: 'cjs', platform: 'browser', external: ['siyuan'], write: false, logLevel: 'silent'});
    bundle = built.outputFiles[0].text;
    console.log('== 官方事件协议与参数完整性 ==');
    const rt = runtime();
    const logic = await hostPaste(rt, raw`· \lor 换成 \land`);
    check('宿主实际采用转换结果（不是只观察 resolve 被调用）', () => assert.equal(logic.result.textPlain, raw`· $\lor$ 换成 $\land$`));
    for (const [input, expected] of [
        [raw`公式 \frac{a}{b} 与 \neg P`, raw`公式 $\frac{a}{b}$ 与 $\neg P$`],
        [raw`公式 \sqrt[3]{x_i} 与 \neg P`, raw`公式 $\sqrt[3]{x_i}$ 与 $\neg P$`],
        [raw`公式 \text{中文} 与 \neg P`, raw`公式 $\text{中文}$ 与 $\neg P$`],
        [raw`区间 \left[x_i,y_j\right] 与 \neg P`, raw`区间 $\left[x_i,y_j\right]$ 与 $\neg P$`],
    ]) {
        const {result} = await hostPaste(rt, input);
        check('完整转换参数：' + input, () => { assert.equal(result.textPlain, expected); assertParseable(result.textPlain); });
    }
    for (const input of ['用户字段 user_id 和 group_id 保持原样', '文件名 report_v1 和 notes_v2', raw`公式 \frac{a} 与 \neg P`, raw`公式 \sqrt{x_i 与 \neg P`]) {
        const {result} = await hostPaste(rt, input);
        check('无法安全转换时保留原文：' + input, () => assert.equal(result?.textPlain ?? input, input));
    }
    for (const extra of [{files: [{name: 'a.png'}]}, {siyuanHTML: '<div>内部结构</div>'}]) {
        check('附件或内部复制保留宿主默认处理', () => {});
        assert.equal((await hostPaste(rt, raw`\lor \land`, extra)).result, undefined);
    }
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/duel-normalform-sup.txt'), 'utf8');
    const full = (await hostPaste(rt, fixture)).result.textPlain;
    check('上标恢复完整定理，未把 HTML 标签拆成公式', () => {
        assert.ok(full.includes(raw`$\neg A(P_1, P_2, \dots, P_n) \Leftrightarrow A^*(\neg P_1, \neg P_2, \dots, \neg P_n)$`));
        assert.ok(full.includes(raw`$A^* \Leftrightarrow B^*$`));
        assert.ok(!full.includes('<sup>') && !full.includes('</sup>'));
        assertParseable(full);
    });
    const repeated = (await hostPaste(rt, full)).result?.textPlain ?? full;
    check('重复粘贴已定界的整篇文本不增加美元或改变正文', () => assert.equal(repeated, full));
    rt.dom.window.close();

    console.log('== 异步兜底策略、取消、卸载 ==');
    for (const policy of ['smart', 'fix', 'conservative', 'pass', 'off']) {
        const run = runtime({aiPolicy: policy});
        const {element, target} = editor(run);
        const input = raw`$\proptoe$`, html = '<p><strong>保留格式</strong></p>';
        capture(run, target, input, html);
        check(policy + '：原生快照阶段不安排修复任务', () => assert.equal(run.timers.size, 0));
        await hostPaste(run, input, {textHTML: html});
        addBroken(run, element, 'policy-' + policy);
        await tick(run);
        check(policy + '：异步写回遵守同一次粘贴策略', () => assert.equal(run.writes.length, ['smart', 'fix'].includes(policy) ? 1 : 0));
        run.plugin.onunload();
        check(policy + '：卸载取消全部待执行任务', () => assert.equal(run.timers.size, 0));
        run.dom.window.close();
    }
    for (const stop of ['关闭', '卸载', '新粘贴']) {
        const run = runtime();
        const {element, target} = editor(run);
        const input = raw`$\proptoe$`, html = '<strong>格式</strong>';
        capture(run, target, input, html);
        await hostPaste(run, input, {textHTML: html});
        addBroken(run, element, 'cancel-' + stop);
        if (stop === '关闭') run.plugin.settings.aiPolicy = 'off';
        if (stop === '卸载') run.plugin.onunload();
        if (stop === '新粘贴') capture(run, target, '普通文本');
        await tick(run);
        check(stop + '：先前已排队任务不再写回', () => assert.equal(run.writes.length, 0));
        run.dom.window.close();
    }
    console.log(`运行时回归测试：${passed} 通过，0 失败`);
}
main().catch(error => {console.error(error); process.exitCode = 1;});
