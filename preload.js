const { contextBridge, ipcRenderer } = require('electron');

// the page may only use these channels; anything else fails here before it reaches the main process
const INVOKE = ['instances', 'mc-versions', 'create', 'delete', 'open-folder', 'settings', 'save-settings', 'search', 'pack-versions', 'install-pack',
  'mods', 'search-mods', 'install-mod', 'remove-mod', 'update-mod', 'kill', 'launch', 'ms-login-start', 'ms-login-cancel', 'ms-logout', 'open-ms-link',
  'update-instance', 'instance-cover', 'instance-cover-clear', 'titlebar', 'update-install', 'update-open', 'duplicate', 'export-pack', 'import-pack'];
const EVENTS = ['progress', 'log', 'state', 'ms-login', 'update'];

contextBridge.exposeInMainWorld('api', {
  invoke: (ch, ...a) => (INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error(`unknown channel ${ch}`))),
  on: (ch, cb) => { if (EVENTS.includes(ch)) ipcRenderer.on(ch, (_e, ...a) => cb(...a)); },
});
