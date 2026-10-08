/**
 * 仅在独立测试文档中挂接工作区的修复产物，不覆盖 D:\siyuan 的安装文件。
 * 原版插件继续服务用户已有文档；候选版消费真实的官方事件和原生上下文。
 * 路径、笔记本名称由 live-paste.cjs 提供；不保存真实剪贴板内容到日志。
 * 本脚本的 SDK 适配器只提供实例字段与提示记录，不替代任何转换/写回逻辑。
 */
(async () => {
    const original = window.siyuan.ws.app.plugins.find(p => p.name === 'paste-fixer');
    if (!original || window.__pasteFixerLiveQA) throw new Error('插件缺失或测试上下文已经存在');
    const remote = require('@electron/remote'), fs = require('fs'), config = window.__pasteFixerLiveConfig;
    const q = window.__pasteFixerLiveQA = {
        original, settingsBefore: {...original.settings}, created: [], results: [], calls: [], pastes: [], emits: [], messages: [],
        notebook: null,
        clipboardBackup: await remote.clipboard.read(), originalFetch: window.fetch, originalEmit: original.eventBus.emit,
    };
    class Plugin {
        constructor() { this.i18n = original.i18n; this.eventBus = original.eventBus; }
    }
    const sdk = {Plugin, Menu: class {}, Setting: class {}, showMessage: text => q.messages.push(String(text))};
    if (config.installedMode) {
        // 安装复测直接使用宿主已加载的实例，转换和手动动作都经过真实 SDK。
        q.plugin = original;
    } else {
        const module = {exports: {}};
        const source = fs.readFileSync(config.bundlePath, 'utf8');
        new Function('require', 'module', 'exports', source)(name => {
            if (name === 'siyuan') return sdk;
            throw new Error('候选产物依赖不确定：' + name);
        }, module, module.exports);
        q.plugin = new module.exports.default();
    }
    q.plugin.settings = {...q.settingsBefore, hintsEnabled: false};
    q.scopeDoc = element => element?.closest?.('.protyle')?.dataset.nodeId;
    q.inScope = id => q.created.some(doc => doc.id === id);
    q.pasteListener = event => {
        const id = q.scopeDoc(event.target);
        if (q.inScope(id)) q.pastes.push({at: Date.now(), doc: id, trusted: event.isTrusted, plain: event.clipboardData.getData('text/plain')});
    };
    q.domListener = event => {
        if (q.inScope(q.scopeDoc(event.target))) q.plugin.onDomPaste(event);
        else original.onDomPaste(event);
    };
    q.busListener = event => {
        if (q.inScope(q.scopeDoc(event.detail.protyle?.wysiwyg?.element))) q.plugin.onPaste(event);
        else original.onPaste(event);
    };
    document.removeEventListener('paste', original.onDomPaste, true);
    document.addEventListener('paste', q.domListener, true);
    document.addEventListener('paste', q.pasteListener, true);
    original.eventBus.off('paste', original.onPaste);
    original.eventBus.on('paste', q.busListener);
    original.eventBus.emit = function (name, detail) {
        const id = q.scopeDoc(detail?.protyle?.wysiwyg?.element);
        if (name !== 'paste' || !q.inScope(id)) return q.originalEmit.call(this, name, detail);
        const record = {at: Date.now(), doc: id, input: detail.textPlain};
        q.emits.push(record);
        record.returned = q.originalEmit.call(this, name, {...detail, resolve: value => {
            record.resolved = {plain: value.textPlain, html: value.textHTML, sy: value.siyuanHTML};
            return detail.resolve(value);
        }});
        return record.returned;
    };
    window.fetch = async function (url, options) {
        let record;
        if (String(url) === '/api/block/updateBlock') {
            const body = JSON.parse(options.body);
            const block = document.querySelector('[data-node-id="' + body.id + '"]');
            if (q.inScope(q.scopeDoc(block))) {
                record = {at: Date.now(), url: String(url), body};
                q.calls.push(record);
            }
        }
        const response = await q.originalFetch.call(this, url, options);
        if (record) { record.http = response.status; record.result = await response.clone().json(); }
        return response;
    };
    q.wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    q.api = async (url, body) => {
        const result = await (await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json();
        if (result.code !== 0) throw new Error(url + ': ' + result.msg);
        return result.data;
    };
    const createdNotebook = await q.api('/api/notebook/createNotebook', {name: config.notebookName});
    q.notebook = createdNotebook.notebook || createdNotebook;
    if (!q.notebook.id) throw new Error('新建笔记本没有返回 ID');
    q.openNewDoc = async name => {
        const id = await q.api('/api/filetree/createDocWithMd', {notebook: q.notebook.id, path: '/' + name, markdown: ''});
        const doc = {id, name}; q.created.push(doc); q.current = doc;
        remote.getCurrentWebContents().send('siyuan-open-url', 'siyuan://blocks/' + id);
        for (let i = 0; i < 40; i++) {
            await q.wait(100);
            if (document.querySelector('.protyle[data-node-id="' + id + '"] .protyle-wysiwyg [contenteditable="true"]')) return doc;
        }
        throw new Error('新测试笔记未打开');
    };
    q.focusDoc = id => {
        const editor = document.querySelector('.protyle[data-node-id="' + id + '"] .protyle-wysiwyg');
        if (!editor || !q.inScope(id)) throw new Error('目标不在独立测试范围');
        editor.focus();
        const range = document.createRange(); range.selectNodeContents(editor.querySelector('[contenteditable="true"]')); range.collapse(false);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        return editor;
    };
    q.snapshot = async (doc, since) => {
        const editor = document.querySelector('.protyle[data-node-id="' + doc.id + '"] .protyle-wysiwyg');
        const nodes = [...editor.querySelectorAll('[data-type="inline-math"], [data-type="NodeMathBlock"]')];
        return {doc, at: Date.now(), dom: {text: editor.innerText, formulas: nodes.map(el => el.dataset.content), errors: nodes.filter(el => el.classList.contains('ft__error') || /KaTeX parse error/i.test(el.textContent)).map(el => ({content: el.dataset.content, message: el.textContent}))},
            pastes: q.pastes.filter(p => p.doc === doc.id && p.at >= since), emits: q.emits.filter(p => p.doc === doc.id && p.at >= since),
            writes: q.calls.filter(p => p.at >= since),
            stored: await q.api('/api/query/sql', {stmt: `SELECT id,type,content,markdown,root_id FROM blocks WHERE root_id='${doc.id}' LIMIT 256`})};
    };
    q.runCase = async test => {
        const doc = await q.openNewDoc(test.name);
        q.plugin.settings = {...q.settingsBefore, hintsEnabled: false, ...test.settings};
        q.focusDoc(doc.id);
        const input = test.fixture ? fs.readFileSync(config.fixtureDirectory + '/' + test.fixture, 'utf8') : test.input;
        const since = Date.now();
        await remote.clipboard.writeText(input); remote.getCurrentWebContents().paste();
        await q.wait(4300);
        const result = await q.snapshot(doc, since); result.input = input; result.settings = {...q.plugin.settings}; q.results.push(result);
        return {doc, trusted: result.pastes.map(p => p.trusted), formulas: result.dom.formulas, errors: result.dom.errors.map(e => e.content), writes: result.writes.length, emit: result.emits.map(e => e.returned)};
    };
    q.runManualCase = async () => {
        const input = String.raw`公式 \frac{a}{b} 与 \neg P`;
        await q.runCase({name: '08 手动分式修复', input, settings: {undelimitedPolicy: 'off'}});
        const doc = q.current, editor = q.focusDoc(doc.id), range = document.createRange();
        range.selectNodeContents(editor.querySelector('[contenteditable="true"]'));
        getSelection().removeAllRanges(); getSelection().addRange(range);
        const since = Date.now(); q.plugin.onSelectionChange();
        await q.plugin.runSelectionAction('fix'); await q.wait(4300);
        const result = await q.snapshot(doc, since); result.input = input; result.action = 'manual-fix'; q.results.push(result);
        return result;
    };
    remote.getCurrentWindow().show(); remote.getCurrentWindow().focus(); remote.getCurrentWebContents().focus();
    return {installedTemporarily: true, notebook: q.notebook};
})()
