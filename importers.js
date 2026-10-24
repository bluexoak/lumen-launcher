// Instances from other launchers: find them, read Minecraft version + loader, copy the game folder's content into a Lumen instance.
// Read-only towards the other launchers: nothing there is changed or moved.
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os');
const L = require('./launcher');
const I = require('./i18n');

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
// what makes up a playthrough; versions, libraries and the other launcher's caches stay behind
const COPY = ['saves', 'mods', 'resourcepacks', 'shaderpacks', 'config', 'defaultconfigs', 'kubejs', 'options.txt', 'servers.dat', 'screenshots'];
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const subdirs = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(d, e.name)); } catch { return []; } };
const found = (source, name, mc, loader, loaderVersion, gameDir) =>
  (mc && gameDir ? { source, name: String(name || mc).slice(0, 40), mc: String(mc), loader, loaderVersion: loaderVersion ? String(loaderVersion) : null, gameDir } : null);

// Prism / PolyMC / MultiMC: instance.cfg + mmc-pack.json, game files in .minecraft/ or minecraft/
function readPrism(dir) {
  const pack = readJson(path.join(dir, 'mmc-pack.json'));
  if (!pack?.components) return null;
  const c = uid => pack.components.find(x => x.uid === uid)?.version;
  const [loader, lv] = c('net.fabricmc.fabric-loader') ? ['fabric', c('net.fabricmc.fabric-loader')] : c('org.quiltmc.quilt-loader') ? ['quilt', c('org.quiltmc.quilt-loader')]
    : c('net.neoforged') ? ['neoforge', c('net.neoforged')] : c('net.minecraftforge') ? ['forge', c('net.minecraftforge')]
    : pack.components.some(x => /liteloader|rift/i.test(x.uid)) ? ['other', null] : ['vanilla', null];
  let name = path.basename(dir);
  try { name = fs.readFileSync(path.join(dir, 'instance.cfg'), 'utf8').match(/^name=(.*)$/m)?.[1]?.trim() || name; } catch {}
  const gameDir = ['.minecraft', 'minecraft'].map(d => path.join(dir, d)).find(d => fs.existsSync(d));
  return found('Prism', name, c('net.minecraft'), loader, lv, gameDir);
}

// CurseForge app: minecraftinstance.json, baseModLoader.name like "fabric-0.19.3-1.20.1" or "neoforge-21.1.259"
function readCurseForge(dir) {
  const j = readJson(path.join(dir, 'minecraftinstance.json'));
  if (!j?.gameVersion) return null;
  const kind = j.baseModLoader?.name?.split('-')[0]?.toLowerCase();
  return found('CurseForge', j.name, j.gameVersion, j.baseModLoader ? (LOADERS.includes(kind) ? kind : 'other') : 'vanilla', j.baseModLoader?.forgeVersion, dir);
}

// ATLauncher: instance.json with launcher.loaderVersion { type: "Fabric" | "Forge" | "NeoForge" | "Quilt", version }
function readATLauncher(dir) {
  const j = readJson(path.join(dir, 'instance.json'));
  if (!j?.id || !j.launcher) return null;
  const lv = j.launcher.loaderVersion, kind = lv?.type?.toLowerCase();
  return found('ATLauncher', j.launcher.name, j.id, lv ? (LOADERS.includes(kind) ? kind : 'other') : 'vanilla', lv?.version, dir);
}

// Modrinth App: versions and loaders live in its SQLite database, opened read-only
function readModrinthApp() {
  const root = path.join(APPDATA, 'ModrinthApp'), dbFile = path.join(root, 'app.db');
  if (!fs.existsSync(dbFile)) return [];
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      return db.prepare('SELECT path, name, game_version, mod_loader, mod_loader_version FROM profiles').all().map(r => {
        const kind = String(r.mod_loader || 'vanilla').toLowerCase();
        return found('Modrinth App', r.name, r.game_version, LOADERS.includes(kind) ? kind : 'other', r.mod_loader_version, safeChild(path.join(root, 'profiles'), r.path));
      });
    } finally { db.close(); }
  } catch { return []; }
}
// a path read from another app's data must stay inside that app's folder
function safeChild(dir, rel) {
  const p = path.resolve(dir, String(rel || ''));
  return p.startsWith(path.resolve(dir) + path.sep) && fs.existsSync(p) ? p : null;
}

// official launcher: profiles in launcher_profiles.json; "latest-release" means whatever is newest
async function readOfficial() {
  const mc = path.join(APPDATA, '.minecraft'), j = readJson(path.join(mc, 'launcher_profiles.json'));
  if (!j?.profiles) return [];
  let versions = [];
  try { versions = await L.mcVersions(); } catch {}
  const out = [], seen = new Set();
  for (const p of Object.values(j.profiles)) {
    let id = p.lastVersionId;
    if (id === 'latest-release') id = versions.find(v => v.type === 'release')?.id;
    if (id === 'latest-snapshot') id = versions[0]?.id;
    if (!id) continue;
    // loader versions (fabric-loader-0.16.7-1.21.1, 1.20.1-forge-47.3.12, neoforge-21.1.77) name their base game in their version json
    const v = readJson(path.join(mc, 'versions', id, id + '.json'));
    const base = v?.inheritsFrom || id;
    const m = id.match(/^fabric-loader-([^-]+)-/) ? ['fabric', id.match(/^fabric-loader-([^-]+)-/)[1]] : id.match(/^quilt-loader-([^-]+)-/) ? ['quilt', id.match(/^quilt-loader-([^-]+)-/)[1]]
      : id.match(/^neoforge-(.+)$/) ? ['neoforge', id.match(/^neoforge-(.+)$/)[1]] : id.match(/-forge-(.+)$/) ? ['forge', id.match(/-forge-(.+)$/)[1]] : ['vanilla', null];
    const gameDir = p.gameDir && fs.existsSync(p.gameDir) ? p.gameDir : mc;
    const key = `${gameDir}|${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(found(I.t('imp.official'), p.name || (m[0] === 'vanilla' ? `Minecraft ${base}` : `${base} ${m[0]}`), base, m[0], m[1], gameDir));
  }
  return out;
}

// a folder the user picked: whichever format it is
const readFolder = dir => readPrism(dir) || readCurseForge(dir) || readATLauncher(dir);

async function scan() {
  const lists = [
    await readOfficial(),
    ...['PrismLauncher', 'PolyMC'].map(d => subdirs(path.join(APPDATA, d, 'instances')).map(readPrism)),
    subdirs(path.join(os.homedir(), 'curseforge', 'minecraft', 'Instances')).map(readCurseForge),
    subdirs(path.join(APPDATA, 'ATLauncher', 'instances')).map(readATLauncher),
    readModrinthApp(),
  ];
  return lists.flat().filter(Boolean);
}

// copies, never moves: the other launcher keeps working
async function importInstance(f) {
  if (!LOADERS.includes(f.loader)) throw new Error(I.t('err.import_loader'));
  const loaderVersion = f.loader === 'vanilla' ? null : f.loaderVersion || (['fabric', 'quilt'].includes(f.loader) ? await L.latestLoader(f.loader, f.mc) : null);
  const inst = L.createInstance({ name: f.name, mc: f.mc, loader: f.loader, loaderVersion });
  try {
    for (const c of COPY) {
      const src = path.join(f.gameDir, c);
      if (fs.existsSync(src)) await fsp.cp(src, path.join(L.instDir(inst.id), c), { recursive: true });
    }
  } catch (e) { await L.deleteInstance(inst.id); throw e; }
  return inst;
}

module.exports = { scan, readFolder, importInstance };

if (require.main === module) { // node importers.js → self-check with fake launcher folders
  const assert = require('assert');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-imp-'));
  const mk = (rel, body) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)); };
  mk('prism/instance.cfg', '[General]\nname=My Pack\n');
  mk('prism/mmc-pack.json', { components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.16.7' }] });
  mk('prism/.minecraft/options.txt', 'x');
  assert.deepEqual(readFolder(path.join(tmp, 'prism')), { source: 'Prism', name: 'My Pack', mc: '1.20.1', loader: 'fabric', loaderVersion: '0.16.7', gameDir: path.join(tmp, 'prism', '.minecraft') });
  mk('cf/minecraftinstance.json', { name: 'ATM', gameVersion: '1.21.1', baseModLoader: { name: 'neoforge-21.1.259', forgeVersion: '21.1.259' } });
  assert.equal(readFolder(path.join(tmp, 'cf')).loader, 'neoforge');
  mk('atl/instance.json', { id: '1.20.1', launcher: { name: 'BMC', loaderVersion: { type: 'Forge', version: '47.3.12' } } });
  assert.deepEqual([readFolder(path.join(tmp, 'atl')).loader, readFolder(path.join(tmp, 'atl')).loaderVersion], ['forge', '47.3.12']);
  mk('lite/mmc-pack.json', { components: [{ uid: 'net.minecraft', version: '1.12.2' }, { uid: 'com.mumfrey.liteloader', version: '1' }] });
  mk('lite/minecraft/x', '');
  assert.equal(readFolder(path.join(tmp, 'lite')).loader, 'other');
  assert.equal(readFolder(tmp), null);
  assert.equal(safeChild(tmp, '..'), null);
  assert.equal(safeChild(tmp, 'prism'), path.join(tmp, 'prism'));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok');
}
