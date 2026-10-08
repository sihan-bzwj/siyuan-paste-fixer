/** 不论测试成功还是失败，都撤下临时事件处理，并恢复所有剪贴板格式。 */
(async () => {
    const q = window.__pasteFixerLiveQA;
    if (!q) return {nothingToRestore: true};
    const remote = require('@electron/remote');
    if (q.plugin && q.plugin !== q.original) q.plugin.onunload();
    else {
        // 直接测已安装实例时只清理本轮任务，不能把正在服务的插件卸载。
        q.original.postPasteTask?.cancel();
        q.original.pasteSnapshot = null;
        q.original.pasteScope = null;
        q.original.settings = {...q.settingsBefore};
    }
    if (q.busListener) q.original.eventBus.off('paste', q.busListener);
    q.original.eventBus.on('paste', q.original.onPaste);
    q.original.eventBus.emit = q.originalEmit;
    if (q.domListener) document.removeEventListener('paste', q.domListener, true);
    if (q.pasteListener) document.removeEventListener('paste', q.pasteListener, true);
    document.addEventListener('paste', q.original.onDomPaste, true);
    window.fetch = q.originalFetch;
    document.activeElement?.blur();
    if (q.clipboardBackup) {
        const electron = remote.require('electron'), items = [];
        for (const old of q.clipboardBackup) {
            // Electron 在空剪贴板时也可能返回一个 types=[] 的只读占位项。
            if (!old.types.length) continue;
            const data = {};
            for (const type of old.types) data[type] = await old.getType(type);
            items.push(new electron.ClipboardItem(data));
        }
        if (items.length) await remote.clipboard.write(items);
        else await remote.clipboard.clear();
        q.clipboardBackup = null;
    }
    const result = {clipboardRestored: true, eventsRestored: q.original.eventBus.emit === q.originalEmit,
        fetchRestored: window.fetch === q.originalFetch, settingsUnchanged: JSON.stringify(q.original.settings) === JSON.stringify(q.settingsBefore)};
    delete window.__pasteFixerLiveQA;
    delete window.__pasteFixerLiveConfig;
    return result;
})()
