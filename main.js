const { app, BrowserWindow, ipcMain, shell, safeStorage, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const L = require('./launcher');
const A = require('./auth');
const I = require('./i18n');

let win;
const running = new Map();
const send = (...a) => win && !win.isDestroyed() && win.webContents.send(...a);
// only our own page may call into the main process
const PAGE = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => {
  if (e.senderFrame?.url !== PAGE) throw new Error(`blocked IPC from ${e.senderFrame?.url}`);
  return fn(...a);
});

const syncLang = s => I.setLang(I.resolve(s.language, app.getLocale()));
app.whenReady().then(() => {
  syncLang(L.getSettings());
  // the launcher never needs camera, mic, notifications…; copying the login code is the one exception
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 620, backgroundColor: '#0c0e13',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0c0e13', symbolColor: '#8d95a6', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // the window only ever shows index.html: no navigation away, no pop-up windows
  win.webContents.on('will-navigate', (e, url) => { if (url !== PAGE) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.once('did-finish-load', checkUpdates);
  setInterval(checkUpdates, 6 * 3600e3);
});

// ---------- updates ----------
// Setup install: electron-updater fetches latest.yml from the newest GitHub release, downloads in the background
// and checks the sha512 from it; the new version installs on restart. A ZIP copy can't replace itself, so it only gets a notice.
const RELEASES = 'https://github.com/bluexoak/lumen-launcher/releases/latest';
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k] > y[k]; return false; };
let updater = null, noticed = '';
async function checkUpdates() {
  if (!app.isPackaged) return;
  try {
    if (fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Lumen.exe'))) {
      if (!updater) {
        updater = require('electron-updater').autoUpdater;
        updater.on('update-downloaded', i => send('update', 'ready', i.version));
        updater.on('error', e => console.error('update:', e.message));
      }
      await updater.checkForUpdates();
    } else {
      const r = await fetch('https://api.github.com/repos/bluexoak/lumen-launcher/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lumen-launcher' } });
      const v = r.ok && String((await r.json()).tag_name || '').replace(/^v/, '');
      if (/^\d+\.\d+\.\d+$/.test(v) && newer(v, app.getVersion()) && v !== noticed) { noticed = v; send('update', 'available', v); }
    }
  } catch (e) { console.error('update check:', e.message); }
}
handle('update-install', () => updater?.quitAndInstall());
handle('update-open', () => shell.openExternal(RELEASES));
app.on('window-all-closed', () => app.quit());

handle('instances', L.listInstances);
handle('mc-versions', L.mcVersions);
handle('create', async ({ name, mc, loader }) => {
  if (!['vanilla', 'fabric', 'quilt'].includes(loader) || typeof mc !== 'string' || !/^[\w.-]{1,40}$/.test(mc)) throw new Error('invalid instance');
  return L.createInstance({ name: String(name || '').slice(0, 40), mc, loader, loaderVersion: loader === 'vanilla' ? null : await L.latestLoader(loader, mc) });
});
handle('delete', id => { if (!running.has(id)) return L.deleteInstance(id); });
handle('update-instance', (id, patch) => L.updateInstance(id, patch));
// the picture comes from the OS file dialog, so the page can never hand in an arbitrary path
handle('instance-cover', async id => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return false;
  await L.setInstanceCover(id, r.filePaths[0]);
  return true;
});
handle('instance-cover-clear', id => L.clearInstanceCover(id));
// window buttons take the colour of whatever the page shows behind them
handle('titlebar', (color, symbolColor) => {
  const hex = /^#[0-9a-f]{6}$/i;
  if (hex.test(color) && hex.test(symbolColor)) win?.setTitleBarOverlay({ color, symbolColor, height: 40 });
});
handle('open-folder', id => shell.openPath(id ? L.instDir(id) : L.ROOT));
handle('settings', L.getSettings);
// the account entry is written only by the login flow below, never by the page
handle('save-settings', s => { const { account, ...rest } = s || {}; const r = L.saveSettings(rest); syncLang(r); return r; });
handle('search', L.searchModpacks);
handle('pack-versions', L.modpackVersions);
handle('install-pack', (project, version) => L.installModpack(project, version, (d, t) => send('progress', 'pack', d, t)));
handle('mods', L.listMods);
handle('search-mods', L.searchMods);
handle('install-mod', (id, projectId, have, kind) => L.installMod(id, projectId, new Set(Array.isArray(have) ? have : []), kind));
handle('remove-mod', L.removeMod);
handle('update-mod', L.updateMod);
handle('kill',id => running.get(id)?.kill());

// ---------- Microsoft account ----------
// tokens are encrypted with Windows DPAPI (safeStorage); only name + uuid go into settings.json
const tokenFile = path.join(L.ROOT, 'account.bin');
function saveTokens(t) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error(I.t('err.crypto'));
  fs.mkdirSync(L.ROOT, { recursive: true });
  fs.writeFileSync(tokenFile, safeStorage.encryptString(JSON.stringify(t)));
}
const loadTokens = () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenFile))); } catch { return null; } };

let pending = null;
handle('ms-login-start', async () => {
  pending?.cancel();
  const login = (pending = await A.startDeviceLogin(A.CLIENT_ID));
  login.done
    .then(r => { saveTokens(r); L.saveSettings({ account: { name: r.mc.name, uuid: r.mc.uuid } }); send('ms-login', 'done', r.mc.name); })
    .catch(e => send('ms-login', 'error', e.message))
    .finally(() => { if (pending === login) pending = null; });
  return { userCode: login.userCode, uri: login.uri };
});
handle('ms-login-cancel', () => pending?.cancel());
handle('ms-logout', () => { fs.rmSync(tokenFile, { force: true }); return L.saveSettings({ account: null }); });
// only ever opens Microsoft's own device-login page, whatever the renderer passes
handle('open-ms-link', uri => { if (/^https:\/\/(www\.)?microsoft\.com\/[\w/-]*$/.test(uri)) shell.openExternal(uri); });

// fresh Minecraft token for a launch: cached one if still valid, else silent refresh (Microsoft rotates the refresh token)
async function msAuth() {
  const s = L.getSettings();
  if (!s.account) return null;
  let t = loadTokens();
  if (!t) throw new Error(I.t('err.ms_missing'));
  if (Date.now() > t.mc.expiresAt) {
    t = await A.refreshLogin(A.CLIENT_ID, t.refreshToken);
    saveTokens(t);
    if (t.mc.name !== s.account.name) L.saveSettings({ account: { name: t.mc.name, uuid: t.mc.uuid } });
  }
  return { ...t.mc, clientId: A.CLIENT_ID };
}

handle('launch', async id => {
  if (running.has(id)) return;
  const inst = L.getInstance(id);
  const auth = await msAuth();
  const child = await L.launch(inst, { ...L.getSettings(), auth }, s => send('log', id, s), (d, t) => send('progress', id, d, t));
  L.saveInstance({ ...inst, lastPlayed: Date.now() });
  running.set(id, child);
  send('state', id, 'running');
  child.on('exit', code => { running.delete(id); send('state', id, 'stopped', code); });
});
