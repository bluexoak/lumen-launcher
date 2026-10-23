// node build.js → public/de/index.html + public/en/index.html from src/page.html and src/strings.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const strings = require('./src/strings');
const page = fs.readFileSync(path.join(__dirname, 'src/page.html'), 'utf8');
const keys = [...new Set([...page.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))];

for (const [lang, t] of Object.entries(strings)) {
  const missing = keys.filter(k => !(k in t)), unused = Object.keys(t).filter(k => !keys.includes(k));
  assert(!missing.length, `${lang}: missing ${missing.join(', ')}`);
  assert(!unused.length, `${lang}: unused ${unused.join(', ')}`);
  // values may hold inline HTML but never attributes, so escaping " keeps attribute placeholders safe
  const html = page.replace(/\{\{(\w+)\}\}/g, (_, k) => t[k].replace(/"/g, '&quot;'));
  fs.mkdirSync(path.join(__dirname, 'public', lang), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'public', lang, 'index.html'), html);
  console.log(`${lang}: ${keys.length} strings`);
}
