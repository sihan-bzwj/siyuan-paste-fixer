/**
 * 一条命令执行真实粘贴回归：构建 → 临时加载候选版 → 原生粘贴 → 检查 DOM/内核/文件 → 恢复。
 * 只新建独立测试笔记本，不覆盖安装插件、不重启运行中的思源，不改已有笔记。
 * Windows 示例：node test/live-paste.cjs --workspace D:\siyuan --app D:\app\SiYuan\SiYuan.exe
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const raw = String.raw;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 明确提供笔记库路径，防止误测另一个正在打开的库。 */
function options() {
    const args = process.argv.slice(2), values = {};
    for (let i = 0; i < args.length;) {
        if (args[i] === '--installed') { values.installed = true; i++; continue; }
        if (!['--workspace', '--app', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('参数格式：--workspace 路径 [--app SiYuan.exe] [--output 工作区内目录]');
        values[args[i].slice(2)] = args[i + 1];
        i += 2;
    }
    if (!values.workspace) throw new Error('必须提供已允许独立测试的 --workspace 路径');
    values.workspace = path.resolve(values.workspace);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    values.output = path.resolve(values.output || path.join(root, '../_qa_paste_live', stamp));
    const relativeOutput = path.relative(path.dirname(root), values.output);
    if (relativeOutput.startsWith('..' + path.sep) || relativeOutput === '..' || path.isAbsolute(relativeOutput)) throw new Error('--output 必须位于源码工作区内');
    return values;
}

/** 只在没有思源进程时启动；已运行但无 CDP 时直接报错，不为测试重启它。 */
async function connectPage(config) {
    const pages = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(page => page.type === 'page' && /\/stage\/build\/app\/(?:\?|$)/.test(page.url));
    try { const found = await pages(); if (found.length === 1) return found[0]; } catch (_) {}
    if (process.platform !== 'win32' || !config.app) throw new Error('思源 CDP 不可用；首次运行请提供 --app，或以 --remote-debugging-port=9222 启动思源');
    const processCheck = spawnSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-Process -Name SiYuan,siyuan-kernel -ErrorAction SilentlyContinue).Count"], {encoding: 'utf8', windowsHide: true});
    if (processCheck.status !== 0 || Number(processCheck.stdout.trim()) !== 0) throw new Error('思源已运行但没有可用的 9222 调试端口；保留当前进程，请在方便时自行启动调试实例');
    const quote = text => "'" + text.replaceAll("'", "''") + "'";
    const command = `Start-Process -FilePath ${quote(path.resolve(config.app))} -ArgumentList @(${quote('--workspace=' + config.workspace)},'--remote-debugging-port=9222') -WindowStyle Hidden`;
    const start = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {encoding: 'utf8', windowsHide: true});
    if (start.status !== 0) throw new Error('启动思源失败：' + start.stderr);
    for (let attempt = 0; attempt < 30; attempt++) {
        await wait(1000);
        try { const found = await pages(); if (found.length === 1) return found[0]; } catch (_) {}
    }
    throw new Error('思源启动后没有出现唯一的主页面');
}

/** 持有一个 CDP 连接，每条操作独立超时；关闭连接不关闭或刷新思源。 */
async function cdp(page) {
    const socket = new WebSocket(page.webSocketDebuggerUrl), pending = new Map();
    let sequence = 0;
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data), task = pending.get(message.id);
        if (!task) return;
        pending.delete(message.id); clearTimeout(task.timeout);
        if (message.error || message.result?.exceptionDetails) task.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        else task.resolve(message.result?.result?.value);
    };
    socket.onclose = () => { for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(new Error('思源调试连接已关闭')); } pending.clear(); };
    return {
        evaluate: expression => new Promise((resolve, reject) => {
            const id = ++sequence;
            const timeout = setTimeout(() => { pending.delete(id); reject(new Error('思源命令执行超时')); }, 20000);
            pending.set(id, {resolve, reject, timeout});
            socket.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true}}));
        }),
        close: () => socket.close(),
    };
}

/** 不用“无异常/公式数很多”代替验证：关键公式必须内容一致，策略不允许写回。 */
function validate(result, test) {
    const reasons = [], formulas = result.dom.formulas;
    if (!result.pastes?.some(event => event.trusted)) reasons.push('未捕获原生可信粘贴');
    for (const expected of test.formulas || []) if (!formulas.includes(expected)) reasons.push('缺少完整公式：' + expected);
    if (test.formulaCount !== undefined && formulas.length !== test.formulaCount) reasons.push('公式数量不符合预期');
    if (test.preserve && !result.stored.some(block => block.markdown === test.input)) reasons.push('原文未完整保留');
    if (test.noWrites && result.writes.length) reasons.push('策略禁止时仍发生写回');
    if (!test.allowRenderErrors && result.dom.errors.length) reasons.push('存在公式渲染错误');
    if (test.noSupFragments && formulas.some(tex => /p>|A<|<\/?sup>/.test(tex))) reasons.push('HTML 上标标签被拆进公式');
    return {name: test.name, pass: reasons.length === 0, reasons};
}

function cases() {
    return [
        {name: '01 逻辑命令', input: raw`· \lor 换成 \land`, formulas: [raw`\lor`, raw`\land`], formulaCount: 2},
        {name: '02 完整分式', input: raw`公式 \frac{a}{b} 与 \neg P`, formulas: [raw`\frac{a}{b}`, raw`\neg P`], formulaCount: 2},
        {name: '03 字段名保护', input: '用户字段 user_id 和 group_id 保持原样', preserve: true, formulaCount: 0, noWrites: true},
        {name: '04 关闭策略', input: raw`$\proptoe$`, settings: {aiPolicy: 'off'}, preserve: true, formulas: [raw`\proptoe`], formulaCount: 1, noWrites: true, allowRenderErrors: true},
        {name: '05 保守策略', input: raw`$\proptoe$`, settings: {aiPolicy: 'conservative'}, preserve: true, formulas: [raw`\proptoe`], formulaCount: 1, noWrites: true, allowRenderErrors: true},
        {name: '06 完整离散数学笔记', fixture: 'duel-normalform-sup.txt', formulas: [raw`\neg A(P_1, P_2, \dots, P_n) \Leftrightarrow A^*(\neg P_1, \neg P_2, \dots, \neg P_n)`, raw`A^* \Leftrightarrow B^*`, '{2^n-1}'], formulaCount: 49, noSupFragments: true},
        {name: '07 数字与中文参数', input: raw`范围 2^n-1，变量 x_i，标签 \text{中文} 与 \neg P`, formulas: ['{2^n-1}', 'x_i', raw`\text{中文}`, raw`\neg P`], formulaCount: 4},
    ];
}

/** 仅复制本次创建的 .sy；保存哈希，复核 DOM 与实际落盘的公式内容。 */
function diskEvidence(workspace, report, output) {
    const directory = path.join(output, 'notes'); fs.mkdirSync(directory, {recursive: true});
    return report.created.map(doc => {
        const source = path.join(workspace, 'data', report.notebook.id, doc.id + '.sy');
        const bytes = fs.readFileSync(source), tree = JSON.parse(bytes);
        if (tree.ID !== doc.id) throw new Error('落盘根 ID 不匹配');
        const formulas = [];
        const visit = node => { if (node.TextMarkType === 'inline-math') formulas.push(node.TextMarkInlineMathContent); for (const child of node.Children || []) visit(child); };
        visit(tree); fs.writeFileSync(path.join(directory, doc.id + '.sy'), bytes);
        return {doc, source, sha256: sha256(bytes), formulas};
    });
}

async function main() {
    const config = options(); fs.mkdirSync(config.output, {recursive: true});
    const build = spawnSync(process.execPath, [path.join(root, 'esbuild.config.mjs')], {cwd: root, stdio: 'inherit', windowsHide: true});
    if (build.status !== 0) throw new Error('构建失败');
    const bundlePath = path.join(root, 'dist/index.js'), bundleHash = sha256(fs.readFileSync(bundlePath));
    fs.copyFileSync(bundlePath, path.join(config.output, 'candidate-index.js'));
    const settingsPath = path.join(config.workspace, 'data/storage/petal/paste-fixer/data.json');
    const settingsBefore = fs.readFileSync(settingsPath), installedPath = path.join(config.workspace, 'data/plugins/paste-fixer/index.js');
    const installedBefore = sha256(fs.readFileSync(installedPath));
    const client = await cdp(await connectPage(config));
    const report = {startedAt: new Date().toISOString(), pluginVersion: JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version, installedMode: !!config.installed, bundleHash, installedHash: installedBefore, checks: [], scope: config.installed ? '实际已安装插件；原生粘贴和内核落盘；不覆盖插件文件' : '工作区候选产物临时挂接；实际原生粘贴和内核落盘；不覆盖已安装插件'};
    let setupAttempted = false;
    try {
        // 新启动的页面可能已经暴露 CDP，但插件尚未加载；等待就绪，不刷新页面。
        let ready = false;
        for (let attempt = 0; attempt < 30; attempt++) {
            ready = await client.evaluate("!!(window.siyuan?.config?.system && window.siyuan.ws?.app?.plugins?.some(plugin => plugin.name === 'paste-fixer'))");
            if (ready) break;
            await wait(500);
        }
        if (!ready) throw new Error('思源主页面或已安装插件尚未就绪');
        if (await client.evaluate('!!window.__pasteFixerLiveQA')) throw new Error('已有真实粘贴测试正在执行，请等待它完成');
        const system = await client.evaluate('window.siyuan.config.system');
        if (path.resolve(system.workspaceDir).toLowerCase() !== config.workspace.toLowerCase()) throw new Error('当前打开的笔记库与 --workspace 不一致');
        if (config.installed && installedBefore !== bundleHash) throw new Error('已安装代码与当前构建不同，拒绝把旧版结果记为当前修复通过');
        report.siyuanVersion = system.kernelVersion;
        const runtimeConfig = {bundlePath, installedMode: !!config.installed, fixtureDirectory: path.join(__dirname, 'fixtures'), notebookName: '粘贴修复自动回归 ' + new Date().toLocaleString('sv-SE', {timeZone: 'Asia/Shanghai'}).replaceAll(':', '-')};
        await client.evaluate('window.__pasteFixerLiveConfig=' + JSON.stringify(runtimeConfig));
        setupAttempted = true;
        await client.evaluate(fs.readFileSync(path.join(__dirname, 'live-runtime.js'), 'utf8'));
        for (const test of cases()) {
            await client.evaluate('window.__pasteFixerLiveQA.runCase(' + JSON.stringify(test) + ')');
            const result = await client.evaluate('window.__pasteFixerLiveQA.results.at(-1)');
            const check = validate(result, test); report.checks.push(check);
            console.log(`[${check.pass ? 'PASS' : 'FAIL'}] ${check.name}${check.reasons.length ? '：' + check.reasons.join('；') : ''}`);
        }
        const manual = await client.evaluate('window.__pasteFixerLiveQA.runManualCase()');
        const manualCheck = {name: '08 手动分式修复', pass: manual.dom.formulas.includes(raw`\frac{a}{b}`) && manual.dom.errors.length === 0 && manual.writes.some(write => write.http === 200 && write.result.code === 0), reasons: []};
        report.checks.push(manualCheck); console.log(`[${manualCheck.pass ? 'PASS' : 'FAIL'}] ${manualCheck.name}`);
        const evidence = await client.evaluate('(async()=>{const q=window.__pasteFixerLiveQA;const final=[];for(const doc of q.created)final.push({doc,blocks:await q.api("/api/query/sql",{stmt:`SELECT id,type,content,markdown,root_id FROM blocks WHERE root_id=\'${doc.id}\' LIMIT 256`})});return {notebook:q.notebook,created:q.created,results:q.results,final};})()');
        Object.assign(report, evidence);
        report.disk = diskEvidence(config.workspace, report, config.output);
        // 每个自动用例和最终手动用例均与磁盘内容逐项比对，防止只验证界面。
        for (const doc of report.created) {
            const finalResult = report.results.filter(result => result.doc.id === doc.id).at(-1);
            const disk = report.disk.find(item => item.doc.id === doc.id);
            if (JSON.stringify(finalResult.dom.formulas) !== JSON.stringify(disk.formulas)) report.checks.push({name: '落盘一致：' + doc.name, pass: false, reasons: ['DOM 和 .sy 公式内容不一致']});
        }
    } catch (error) {
        report.error = error.message; console.error(error.message);
    } finally {
        if (setupAttempted) {
            try { report.restore = await client.evaluate(fs.readFileSync(path.join(__dirname, 'live-restore.js'), 'utf8')); }
            catch (error) { report.restoreError = error.message; console.error('恢复失败：' + error.message); }
        }
        client.close();
        report.settingsUnchanged = fs.readFileSync(settingsPath).equals(settingsBefore);
        report.installedUnchanged = sha256(fs.readFileSync(installedPath)) === installedBefore;
        report.finishedAt = new Date().toISOString();
        const complete = report.checks.length >= 8 && report.checks.every(check => check.pass) && !report.error && !report.restoreError && report.restore?.clipboardRestored && report.restore?.eventsRestored && report.settingsUnchanged && report.installedUnchanged;
        report.pass = Boolean(complete);
        fs.writeFileSync(path.join(config.output, 'results.json'), JSON.stringify(report, null, 2));
        const summary = `# 真实粘贴自动回归\n\n结果：${report.pass ? '通过' : '失败'}。思源 ${report.siyuanVersion || '未知'}，插件 ${report.pluginVersion}。\n\n` + report.checks.map(check => `- ${check.pass ? '通过' : '失败'}：${check.name}${check.reasons.length ? '；' + check.reasons.join('；') : ''}`).join('\n') + `\n\n笔记本：${report.notebook?.name || '未创建'}。\n\n范围：${report.scope}。测试期间插件文件和持久化设置保持原样。剪贴板/事件恢复：${report.restore?.clipboardRestored && report.restore?.eventsRestored ? '成功' : '未确认'}。\n\n完整数据：[results.json](results.json)，落盘副本：notes/。\n`;
        fs.writeFileSync(path.join(config.output, 'report.md'), summary);
        console.log(`${report.pass ? 'PASS' : 'FAIL'}，证据：${config.output}`);
        if (!complete) process.exitCode = 1;
    }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
