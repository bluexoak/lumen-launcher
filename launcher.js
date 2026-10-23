// Core: Mojang/Fabric/Quilt version resolution, downloads, Java, launch, Modrinth modpacks.
const fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto'), os = require('os');
const { spawn, execFile } = require('child_process');
const execFileP = require('util').promisify(execFile);
const I = require('./i18n');

const ROOT = process.env.LUMEN_HOME || path.join(process.env.APPDATA || os.homedir(), '.lumen');
const P = {
  libs: path.join(ROOT, 'libraries'), assets: path.join(ROOT, 'assets'), versions: path.join(ROOT, 'versions'),
  instances: path.join(ROOT, 'instances'), runtimes: path.join(ROOT, 'runtimes'), tmp: path.join(ROOT, 'tmp'), cache: path.join(ROOT, 'cache'),
};
const UA = 'lumen-launcher/0.1 (+https://github.com/bluexoak/lumen-launcher)';
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const OS = 'windows'; // ponytail: Windows only; map process.platform → osx/linux for other OSes
const ARCH = process.arch === 'ia32' ? 'x86' : process.arch;
// Windows' bsdtar extracts zip/jar natively (Git's GNU tar on PATH can't)
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

// ---------- net ----------
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

// fetch + cache to disk so already-installed instances still launch offline
async function cachedJson(url, file) {
  try {
    const j = await getJson(url);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(j));
    return j;
  } catch (e) {
    if (fs.existsSync(file)) return JSON.parse(await fsp.readFile(file, 'utf8'));
    throw e;
  }
}

async function download(url, dest, { sha1, sha256, size } = {}) {
  if (fs.existsSync(dest) && (size == null || fs.statSync(dest).size === size)) return;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (sha1 && crypto.createHash('sha1').update(buf).digest('hex') !== sha1) throw new Error(I.t('err.checksum', { url }));
      if (sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== sha256) throw new Error(I.t('err.checksum', { url }));
      await fsp.writeFile(dest, buf);
      return;
    } catch (e) { if (attempt >= 3) throw e; }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ---------- version json ----------
function allowed(rules) {
  if (!rules) return true;
  let ok = false;
  for (const r of rules) {
    if (r.features) continue; // demo/custom-resolution/quickplay: all off
    if (r.os?.name && r.os.name !== OS) continue;
    if (r.os?.arch && r.os.arch !== ARCH) continue;
    ok = r.action === 'allow';
  }
  return ok;
}

function mavenPath(name) {
  const [coords, ext = 'jar'] = name.split('@');
  const [g, a, v, c] = coords.split(':');
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext}`;
}

// loader profile on top of vanilla; child libs win on group:artifact:classifier clashes
function merge(base, child) {
  const key = l => { const [g, a, , c] = l.name.split(':'); return `${g}:${a}:${c || ''}`; };
  const seen = new Set(child.libraries.map(key));
  return {
    ...base, id: child.id, jar: base.id, mainClass: child.mainClass,
    libraries: [...child.libraries, ...base.libraries.filter(l => !seen.has(key(l)))],
    arguments: {
      game: [...(base.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(base.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    },
  };
}

const LOADER_META = {
  fabric: 'https://meta.fabricmc.net/v2/versions/loader',
  quilt: 'https://meta.quiltmc.org/v3/versions/loader',
};

async function mcVersions() {
  return (await cachedJson(MANIFEST, path.join(P.cache, 'manifest.json'))).versions.map(v => ({ id: v.id, type: v.type }));
}

async function latestLoader(loader, mc) {
  const list = await getJson(`${LOADER_META[loader]}/${encodeURIComponent(mc)}`);
  if (!list.length) throw new Error(I.t('err.loader_mc', { loader, mc }));
  return (list.find(x => x.loader.stable ?? !x.loader.version.includes('beta')) || list[0]).loader.version;
}

async function resolveVersion(mc, loader, loaderVersion) {
  const manifest = await cachedJson(MANIFEST, path.join(P.cache, 'manifest.json'));
  const entry = manifest.versions.find(v => v.id === mc);
  if (!entry) throw new Error(I.t('err.unknown_mc', { mc }));
  const file = path.join(P.versions, mc, mc + '.json');
  await download(entry.url, file, { sha1: entry.sha1 });
  const v = JSON.parse(await fsp.readFile(file, 'utf8'));
  v.jar = v.id;
  if (!LOADER_META[loader]) return v;
  const profile = await cachedJson(`${LOADER_META[loader]}/${mc}/${loaderVersion}/profile/json`,
    path.join(P.cache, loader, `${mc}-${loaderVersion}.json`));
  return merge(v, profile);
}

// ---------- install ----------
async function install(v, gameDir, onProgress) {
  const jobs = [], cp = [], natives = [];
  const client = v.downloads.client;
  jobs.push({ url: client.url, dest: path.join(P.versions, v.jar, v.jar + '.jar'), sha1: client.sha1, size: client.size });

  for (const l of v.libraries) {
    if (!allowed(l.rules)) continue;
    const art = l.downloads?.artifact;
    if (art?.url) {
      const dest = path.join(P.libs, art.path || mavenPath(l.name));
      jobs.push({ url: art.url, dest, sha1: art.sha1, size: art.size });
      cp.push(dest);
    } else if (!l.downloads) { // maven-style (Fabric/Quilt)
      const rel = mavenPath(l.name), dest = path.join(P.libs, rel);
      jobs.push({ url: (l.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/') + rel, dest, sha1: l.sha1, size: l.size });
      cp.push(dest);
    }
    const nat = l.natives?.[OS]; // pre-1.19 native jars to extract
    const c = nat && l.downloads?.classifiers?.[nat.replace('${arch}', process.arch === 'ia32' ? '32' : '64')];
    if (c) {
      const dest = path.join(P.libs, c.path);
      jobs.push({ url: c.url, dest, sha1: c.sha1, size: c.size });
      natives.push(dest);
    }
  }

  const ai = v.assetIndex, idxFile = path.join(P.assets, 'indexes', ai.id + '.json');
  await download(ai.url, idxFile, { sha1: ai.sha1 });
  const idx = JSON.parse(await fsp.readFile(idxFile, 'utf8'));
  const obj = h => path.join(P.assets, 'objects', h.slice(0, 2), h);
  for (const o of Object.values(idx.objects))
    jobs.push({ url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`, dest: obj(o.hash), sha1: o.hash, size: o.size });

  const log = v.logging?.client?.file; // Mojang's log4j config (also the Log4Shell fix for old versions)
  if (log) jobs.push({ url: log.url, dest: path.join(P.assets, 'log_configs', log.id), sha1: log.sha1, size: log.size });

  let done = 0;
  await pool(jobs, 16, async j => { await download(j.url, j.dest, j); onProgress(++done, jobs.length); });

  const nativesDir = path.join(P.versions, v.id, 'natives');
  await fsp.mkdir(nativesDir, { recursive: true });
  for (const n of natives) await execFileP(TAR, ['-xf', n, '-C', nativesDir, '--exclude', 'META-INF']);

  // pre-1.7.10 games read assets by name instead of hash
  let virtualDir = path.join(P.assets, 'virtual', ai.id);
  if (idx.map_to_resources) virtualDir = path.join(gameDir, 'resources');
  if (idx.virtual || idx.map_to_resources)
    for (const [name, o] of Object.entries(idx.objects)) {
      const dest = path.join(virtualDir, name);
      if (!fs.existsSync(dest)) { await fsp.mkdir(path.dirname(dest), { recursive: true }); await fsp.copyFile(obj(o.hash), dest); }
    }
  return { cp, nativesDir, virtualDir };
}

// ---------- java ----------
function javaMajor(home) {
  const m = fs.readFileSync(path.join(home, 'release'), 'utf8').match(/JAVA_VERSION="(\d+)(?:\.(\d+))?/);
  return m[1] === '1' ? +m[2] : +m[1];
}

async function findJava(major, override, allowDownload = true) {
  if (override) { // settings.json can be edited by hand: still only ever run an existing java(w).exe
    if (!/^java(w)?\.exe$/i.test(path.basename(override)) || !fs.existsSync(override)) throw new Error(I.t('err.java_path'));
    return override;
  }
  const roots = [P.runtimes, ...['Java', 'Eclipse Adoptium', 'Zulu', 'Microsoft', 'BellSoft'].map(d => path.join('C:\\Program Files', d))];
  for (const r of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(r); } catch { continue; }
    for (const d of dirs) {
      const home = path.join(r, d), exe = path.join(home, 'bin', 'java.exe');
      try { if (javaMajor(home) === major && fs.existsSync(exe)) return exe; } catch {}
    }
  }
  if (!allowDownload) throw new Error(I.t('err.java', { major }));
  // the asset API gives the zip together with its SHA-256, so a tampered download is rejected
  const assets = await getJson(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse`);
  const pkg = assets.map(a => a.binary.package).find(p => p.name.endsWith('.zip'));
  if (!pkg) throw new Error(I.t('err.java', { major }));
  const zip = path.join(P.tmp, `jre${major}.zip`);
  await fsp.rm(zip, { force: true }); // never trust a leftover partial download
  await download(pkg.link, zip, { sha256: pkg.checksum });
  await fsp.mkdir(P.runtimes, { recursive: true });
  await execFileP(TAR, ['-xf', zip, '-C', P.runtimes]);
  await fsp.rm(zip, { force: true });
  return findJava(major, null, false);
}

// ---------- launch ----------
function offlineUuid(name) { // same as Java's UUID.nameUUIDFromBytes("OfflinePlayer:" + name)
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80;
  return h.toString('hex');
}

// Mojang's log config prints XML events; turn them back into readable lines
function logPump(onLog) {
  let buf = '';
  const ev = /^([\s\S]*?)<log4j:Event[^>]*?level="(\w+)"[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>[\s\S]*?<\/log4j:Event>\s*/;
  return d => {
    buf += d;
    let m;
    while ((m = buf.match(ev))) {
      if (m[1].trim()) onLog(m[1]);
      onLog(`[${m[2]}] ${m[3]}\n`);
      buf = buf.slice(m[0].length);
    }
    if (!buf.includes('<log4j:Event')) { if (buf) onLog(buf); buf = ''; }
  };
}

async function launch(inst, settings, onLog, onProgress) {
  const gameDir = instDir(inst.id);
  onLog(I.t('log.preparing', { mc: inst.mc, loader: inst.loader }) + '\n');
  const v = await resolveVersion(inst.mc, inst.loader, inst.loaderVersion);
  const { cp, nativesDir, virtualDir } = await install(v, gameDir, onProgress);
  cp.push(path.join(P.versions, v.jar, v.jar + '.jar'));
  const java = await findJava(v.javaVersion?.majorVersion || 8, settings.javaPath);
  const a = settings.auth; // Microsoft account from main.js, else offline name
  const name = a?.name || settings.username || 'Player';
  const vars = {
    auth_player_name: name, version_name: v.id, game_directory: gameDir, assets_root: P.assets, game_assets: virtualDir,
    assets_index_name: v.assetIndex.id, auth_uuid: a?.uuid || offlineUuid(name), auth_access_token: a?.token || '0',
    auth_session: a ? `token:${a.token}:${a.uuid}` : '0', clientid: a?.clientId || '', auth_xuid: a?.xuid || '',
    user_type: a ? 'msa' : 'legacy', user_properties: '{}', version_type: v.type,
    natives_directory: nativesDir, launcher_name: 'lumen', launcher_version: '0.1', classpath: cp.join(';'),
    classpath_separator: ';', library_directory: P.libs,
  };
  const sub = s => s.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const flat = list => list.flatMap(a => (typeof a === 'string' ? [a] : allowed(a.rules) ? [].concat(a.value) : []));
  const jvm = v.arguments ? flat(v.arguments.jvm || []) : ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];
  const game = v.arguments ? flat(v.arguments.game || []) : v.minecraftArguments.split(' ');
  const log = v.logging?.client;
  const args = [
    `-Xmx${settings.ram || 4096}M`, '-Dlog4j2.formatMsgNoLookups=true',
    ...(log ? [log.argument.replace('${path}', path.join(P.assets, 'log_configs', log.file.id))] : []),
    ...jvm.map(sub), v.mainClass, ...game.map(sub),
  ];
  onLog(I.t('log.starting', { java }) + '\n');
  const child = spawn(java, args, { cwd: gameDir, windowsHide: true });
  const pump = logPump(onLog);
  child.stdout.on('data', d => pump(d.toString()));
  child.stderr.on('data', d => onLog(d.toString()));
  return child;
}

// ---------- instances & settings ----------
// ids come from the renderer: only accept the shape createInstance makes, so ".." can never reach rm -rf
const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const instDir = id => { if (!INSTANCE_ID.test(id)) throw new Error(`invalid instance id: ${id}`); return path.join(P.instances, id); };
const settingsFile = path.join(ROOT, 'settings.json');

function listInstances() {
  let dirs = [];
  try { dirs = fs.readdirSync(P.instances); } catch {}
  const modCount = d => { try { return fs.readdirSync(path.join(P.instances, d, 'mods')).filter(f => /\.jar$/i.test(f)).length; } catch { return 0; } };
  return dirs.flatMap(d => { try { return [{ ...JSON.parse(fs.readFileSync(path.join(P.instances, d, 'instance.json'), 'utf8')), modCount: modCount(d) }]; } catch { return []; } })
    .sort((a, b) => (b.lastPlayed || b.created) - (a.lastPlayed || a.created));
}
const getInstance = id => JSON.parse(fs.readFileSync(path.join(instDir(id), 'instance.json'), 'utf8'));
function saveInstance(inst) { fs.mkdirSync(instDir(inst.id), { recursive: true }); fs.writeFileSync(path.join(instDir(inst.id), 'instance.json'), JSON.stringify(inst, null, 2)); }

function createInstance(o) {
  const slug = (o.name || 'instanz').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'instanz';
  const inst = { id: `${slug}-${crypto.randomBytes(2).toString('hex')}`, name: o.name || `Minecraft ${o.mc}`, mc: o.mc, loader: o.loader || 'vanilla',
    loaderVersion: o.loaderVersion || null, icon: o.icon || null, banner: o.banner || null, modpack: o.modpack || null, created: Date.now() };
  saveInstance(inst);
  return inst;
}
const deleteInstance = id => fsp.rm(instDir(id), { recursive: true, force: true });

function getSettings() { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return { username: 'Player', ram: 4096, javaPath: '' }; } }
// every key settings.json may hold, with its check; unknown keys are dropped
const SETTINGS = {
  username: v => /^\w{3,16}$/.test(v) || I.t('err.name'),
  ram: v => (Number.isInteger(v) && v >= 1024 && v <= 65536) || 'ram: 1024–65536 MB',
  javaPath: v => v === '' || (/^java(w)?\.exe$/i.test(path.basename(v)) && fs.existsSync(v)) || I.t('err.java_path'),
  clientId: v => v === '' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || I.t('err.client_id'),
  theme: v => ['nacht', 'papier', 'neon', 'pixel', 'poster'].includes(v) || 'theme',
  layout: v => ['book', 'carousel', 'list', 'shelf', 'terminal'].includes(v) || 'layout',
  language: v => ['auto', 'de', 'en'].includes(v) || 'language',
  account: v => v === null || (typeof v?.name === 'string' && typeof v?.uuid === 'string') || 'account',
};
function saveSettings(s) {
  const clean = {};
  for (const [k, v] of Object.entries(s || {})) {
    if (!SETTINGS[k]) continue;
    const ok = SETTINGS[k](v);
    if (ok !== true) throw new Error(ok);
    clean[k] = v;
  }
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ ...getSettings(), ...clean }, null, 2));
  return getSettings();
}

// ---------- modrinth ----------
const MR = 'https://api.modrinth.com/v2';
const searchModpacks = (q = '', offset = 0) =>
  getJson(`${MR}/search?limit=24&offset=${offset}&index=${q ? 'relevance' : 'downloads'}&query=${encodeURIComponent(q)}&facets=${encodeURIComponent('[["project_type:modpack"]]')}`);
const modpackVersions = id => getJson(`${MR}/project/${encodeURIComponent(id)}/version`);

// hosts a .mrpack may download from, per Modrinth's format spec; anything else is refused
const PACK_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'];
const packHostAllowed = u => { try { const x = new URL(u); return x.protocol === 'https:' && PACK_HOSTS.includes(x.hostname); } catch { return false; } };

function safeJoin(dir, rel) {
  const p = path.resolve(dir, rel);
  if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error(I.t('err.unsafe_path', { path: rel }));
  return p;
}

async function installModpack(project, version, onProgress) {
  const file = version.files.find(f => f.primary) || version.files[0];
  const tmp = path.join(P.tmp, crypto.randomUUID()), x = path.join(tmp, 'x');
  let inst;
  try {
    await fsp.mkdir(x, { recursive: true });
    await download(file.url, path.join(tmp, 'pack.mrpack'), { sha1: file.hashes.sha1 });
    await execFileP(TAR, ['-xf', path.join(tmp, 'pack.mrpack'), '-C', x]); // bsdtar refuses ../ and absolute paths
    const idx = JSON.parse(await fsp.readFile(path.join(x, 'modrinth.index.json'), 'utf8'));
    const d = idx.dependencies;
    const loader = d['fabric-loader'] ? 'fabric' : d['quilt-loader'] ? 'quilt' : d.forge || d.neoforge ? null : 'vanilla';
    if (!loader) throw new Error(I.t('err.forge'));
    inst = createInstance({ name: project.title, mc: d.minecraft, loader, loaderVersion: d['fabric-loader'] || d['quilt-loader'],
      icon: project.icon_url, banner: project.featured_gallery || project.gallery?.[0] || null, modpack:{ project: project.project_id, version: version.version_number } });
    const dir = instDir(inst.id);
    const files = idx.files.filter(f => f.env?.client !== 'unsupported');
    let done = 0;
    await pool(files, 8, async f => {
      const url = f.downloads.find(packHostAllowed);
      if (!url) throw new Error(I.t('err.pack_host', { path: f.path }));
      await download(url, safeJoin(dir, f.path), { sha1: f.hashes.sha1, size: f.fileSize });
      onProgress(++done, files.length);
    });
    for (const o of ['overrides', 'client-overrides']) {
      const src = path.join(x, o);
      if (fs.existsSync(src)) await fsp.cp(src, dir, { recursive: true });
    }
    return inst;
  } catch (e) {
    if (inst) await deleteInstance(inst.id);
    throw e;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

// ---------- per-instance mods ----------
const modsDir = id => path.join(instDir(id), 'mods');
const sha1File = f => fsp.readFile(f).then(b => crypto.createHash('sha1').update(b).digest('hex'));
const loadersFor = inst => (inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]);
// updates are stable releases only, matching what installMod picks
const updateFilter = inst => ({ loaders: loadersFor(inst), game_versions: [inst.mc], version_types: ['release'] });

async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

// installed jars, matched to Modrinth projects by hash (falls back to file names offline), plus available updates
async function listMods(id) {
  const inst = getInstance(id);
  let files = [];
  try { files = (await fsp.readdir(modsDir(id))).filter(f => /\.jar(\.disabled)?$/i.test(f)); } catch {}
  const byHash = {};
  for (const f of files) byHash[await sha1File(path.join(modsDir(id), f))] = f;
  const hashes = Object.keys(byHash);
  let versions = {}, projects = {}, latest = {};
  if (files.length) try {
    [versions, latest] = await Promise.all([
      postJson(`${MR}/version_files`, { hashes, algorithm: 'sha1' }),
      postJson(`${MR}/version_files/update`, { hashes, algorithm: 'sha1', ...updateFilter(inst) }),
    ]);
    const ids = [...new Set(Object.values(versions).map(v => v.project_id))];
    if (ids.length) for (const p of await getJson(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`)) projects[p.id] = p;
  } catch {}
  return Object.entries(byHash).map(([h, file]) => {
    const v = versions[h], p = v && projects[v.project_id], u = latest[h];
    return { file, projectId: v?.project_id || null, title: p?.title || file.replace(/\.jar(\.disabled)?$/i, ''), icon: p?.icon_url || null,
      version: v?.version_number || null, update: v && u && u.date_published > v.date_published ? u.version_number : null };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

// ponytail: swaps the jar only; new required dependencies of the update aren't pulled in
async function updateMod(id, file) {
  const inst = getInstance(id), old = modFile(id, file);
  const v = await postJson(`${MR}/version_file/${await sha1File(old)}/update?algorithm=sha1`, updateFilter(inst));
  const f = v.files.find(f => f.primary) || v.files[0];
  const dest = path.join(modsDir(id), path.basename(f.filename));
  if (dest === old) await fsp.rm(old); // same file name: download() would otherwise keep the old jar
  await download(f.url, dest, { sha1: f.hashes.sha1, size: f.size });
  if (dest !== old) await fsp.rm(old);
  return v.version_number;
}

function searchMods(id, q = '', offset = 0) {
  const inst = getInstance(id);
  const facets = [['project_type:mod'], loadersFor(inst).map(l => `categories:${l}`), [`versions:${inst.mc}`]];
  return getJson(`${MR}/search?limit=30&offset=${offset}&index=${q ? 'relevance' : 'downloads'}&query=${encodeURIComponent(q)}&facets=${encodeURIComponent(JSON.stringify(facets))}`);
}

// newest compatible version + required dependencies; returns names of what got installed
async function installMod(id, projectId, have = new Set()) {
  if (have.has(projectId)) return [];
  have.add(projectId);
  const inst = getInstance(id);
  const vs = await getJson(`${MR}/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent(JSON.stringify(loadersFor(inst)))}&game_versions=${encodeURIComponent(JSON.stringify([inst.mc]))}`);
  const v = vs.find(v => v.version_type === 'release') || vs[0];
  if (!v) throw new Error(I.t('err.no_version', { mc: inst.mc, loader: inst.loader }));
  const f = v.files.find(f => f.primary) || v.files[0];
  await download(f.url, path.join(modsDir(id), path.basename(f.filename)), { sha1: f.hashes.sha1, size: f.size });
  const added = [v.name];
  for (const d of v.dependencies)
    if (d.dependency_type === 'required' && d.project_id) added.push(...await installMod(id, d.project_id, have));
  return added;
}

// mod file names come from the renderer: a plain jar in that instance's mods folder, nothing else
function modFile(id, file) {
  if (file !== path.basename(file) || !/\.jar(\.disabled)?$/i.test(file)) throw new Error(`invalid mod file: ${file}`);
  return path.join(modsDir(id), file);
}
const removeMod = (id, file) => fsp.rm(modFile(id, file));

module.exports = { ROOT, instDir, listInstances, getInstance, saveInstance, createInstance, deleteInstance, getSettings, saveSettings,
  mcVersions, latestLoader, launch, searchModpacks, modpackVersions, installModpack, listMods, searchMods, installMod, updateMod, removeMod };

if (require.main === module) { // node launcher.js → self-check
  const assert = require('assert');
  assert.equal(mavenPath('net.fabricmc:fabric-loader:0.16.0'), 'net/fabricmc/fabric-loader/0.16.0/fabric-loader-0.16.0.jar');
  assert.equal(mavenPath('org.lwjgl:lwjgl:3.3.3:natives-windows'), 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar');
  assert.equal(allowed([{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }]), true);
  assert.equal(allowed([{ action: 'allow', os: { name: 'osx' } }]), false);
  assert.equal(allowed([{ action: 'allow', features: { is_demo_user: true } }]), false);
  const m = merge({ id: '1.21', libraries: [{ name: 'org.ow2.asm:asm:9.1' }, { name: 'a:b:1' }], arguments: { game: ['x'] } },
    { id: 'fabric', mainClass: 'K', libraries: [{ name: 'org.ow2.asm:asm:9.7' }], arguments: { game: ['y'] } });
  assert.deepEqual(m.libraries.map(l => l.name), ['org.ow2.asm:asm:9.7', 'a:b:1']);
  assert.deepEqual(m.arguments.game, ['x', 'y']);
  assert.equal(m.jar, '1.21');
  assert.match(offlineUuid('Steve'), /^[0-9a-f]{12}3[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
  assert.throws(() => safeJoin('C:\\x', '..\\evil'));
  const out = []; logPump(s => out.push(s))('<log4j:Event logger="a" level="INFO" thread="m"><log4j:Message><![CDATA[Hallo]]></log4j:Message></log4j:Event>\nplain\n');
  assert.deepEqual(out, ['[INFO] Hallo\n', 'plain\n']);
  assert.throws(() => saveSettings({ clientId: 'nope' }), /Format/);
  for (const bad of ['..', '../..', '.', 'a/../..', 'A', '']) assert.throws(() => instDir(bad), /invalid instance id/);
  assert.ok(instDir('survival-0c5e').endsWith('survival-0c5e'));
  for (const bad of ['..', '../x.jar', 'x.exe', 'sub\\x.jar']) assert.throws(() => modFile('survival-0c5e', bad), /invalid mod file/);
  assert.throws(() => saveSettings({ ram: '4096; rm' }), /ram/);
  assert.throws(() => saveSettings({ javaPath: 'C:\\Windows\\System32\\cmd.exe' }), /java/i);
  assert.ok(packHostAllowed('https://cdn.modrinth.com/data/x.jar'));
  for (const bad of ['http://cdn.modrinth.com/x.jar', 'https://evil.example/x.jar', 'https://cdn.modrinth.com.evil.example/x', 'nope']) assert.ok(!packHostAllowed(bad), bad);
  console.log('ok');
}
