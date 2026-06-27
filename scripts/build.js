#!/usr/bin/env node
// Renders packages/site/templates/*.html × content/translations/*.json → dist/
// then copies CSS/JS assets and generates dist/integrity.json.
//
// Render matrix:
//   en  → index, join, demand, mirror, trust  (dist/*.html)
//   hi/ta/te/bn → index, join, demand          (dist/<lang>/*.html)
//
// Template keys use {{key}} syntax. A missing key is a hard error.
// {{base}} in translation values ("../mirror.html") is resolved before substitution.
//
// Strip-script-before-hash invariant is preserved in buildIntegrity — mirrors verify.js.

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT      = path.join(__dirname, '..');
const SRC       = path.join(ROOT, 'packages/site');
const TEMPLATES = path.join(SRC, 'templates');
const TRANS_DIR = path.join(ROOT, 'content/translations');
const DIST      = path.join(ROOT, 'dist');

const DOMAIN = 'https://cjp.fheya.de';

const LANGS = [
  { code: 'en', label: 'EN',  pages: ['index', 'join', 'demand', 'mirror', 'trust'] },
  { code: 'hi', label: 'हि', pages: ['index', 'join', 'demand'] },
  { code: 'ta', label: 'த',  pages: ['index', 'join', 'demand'] },
  { code: 'te', label: 'తె', pages: ['index', 'join', 'demand'] },
  { code: 'bn', label: 'বা', pages: ['index', 'join', 'demand'] },
];

// Set of pages each language covers — used to pick fallback targets in lang switcher
const LANG_PAGES = {};
for (const l of LANGS) LANG_PAGES[l.code] = new Set(l.pages);

function targetPage(langCode, page) {
  return LANG_PAGES[langCode].has(page) ? page : 'index';
}

// Build the <div class="langs"> inner HTML for a given (currentLang, currentPage)
function buildLangSwitcher(currentLang, currentPage) {
  return LANGS.map(l => {
    const tp = targetPage(l.code, currentPage);
    let href;
    if (currentLang === 'en') {
      href = l.code === 'en' ? tp + '.html' : l.code + '/' + tp + '.html';
    } else {
      if (l.code === 'en')            href = '../' + tp + '.html';
      else if (l.code === currentLang) href = tp + '.html';
      else                             href = '../' + l.code + '/' + tp + '.html';
    }
    const cur = l.code === currentLang ? ' class="cur"' : '';
    return '<a href="' + href + '"' + cur + '>' + l.label + '</a>';
  }).join('\n    ');
}

// Build the canonical/OG meta block — only for English, empty for other languages
function buildCanonicalOgBlock(langCode, page, trans) {
  if (langCode !== 'en') return '';
  const url   = page === 'index' ? DOMAIN + '/' : DOMAIN + '/' + page + '.html';
  const title = trans.pages[page].title;
  const desc  = trans.pages[page].description;
  return [
    '<link rel="canonical" href="' + url + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:url" content="' + url + '">',
    '<meta property="og:title" content="' + title + '">',
    '<meta property="og:description" content="' + desc + '">',
  ].join('\n');
}

// Resolve {{base}} inside a translation string value before template substitution
function resolveBase(val, base) {
  if (typeof val !== 'string') return val;
  return val.replace(/\{\{base\}\}/g, base);
}

// SHA-256 of a file as a base64 SRI token ("sha256-<base64>").
function sriHash(filePath) {
  return 'sha256-' + crypto.createHash('sha256')
    .update(fs.readFileSync(filePath)).digest('base64');
}

// Build flat substitution context for (trans, langCode, page)
// sriCtx must be pre-computed (assets must already be copied to dist/).
function buildContext(trans, langCode, page, sriCtx) {
  const base    = langCode === 'en' ? './' : '../';
  const pageData = trans.pages[page];
  if (!pageData) {
    throw new Error('No page data for "' + page + '" in lang "' + langCode + '"');
  }

  const ctx = Object.assign({
    lang:               trans.lang,
    base,
    party_name:         trans.party_name,
    nav_manifesto:      trans.nav.manifesto,
    nav_join:           trans.nav.join,
    nav_demand:         trans.nav.demand,
    nav_mirror:         trans.nav.mirror,
    lang_switcher:      buildLangSwitcher(langCode, page),
    canonical_og_block: buildCanonicalOgBlock(langCode, page, trans),
  }, sriCtx);

  // Expose all page-level keys directly, resolving {{base}} within values
  for (const k of Object.keys(pageData)) {
    ctx[k] = resolveBase(pageData[k], base);
  }

  return ctx;
}

// Replace every {{key}} in template. Hard error on missing key.
function render(template, context) {
  return template.replace(/\{\{([^}]+)\}\}/g, function (match, key) {
    if (!(key in context)) {
      throw new Error('Missing template key: {{' + key + '}}');
    }
    return context[key];
  });
}

// Recursively copy a directory tree, skipping .gitkeep
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Copy non-HTML assets from packages/site/ to dist/:
//   - skip templates/, hi/, ta/, te/, bn/ (generated or replaced)
//   - skip root-level *.html (generated from templates)
const SKIP_DIRS = new Set(['templates', 'hi', 'ta', 'te', 'bn']);
function copyAssets(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    if (!entry.isDirectory() && /\.html$/.test(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Strip-script regex — must stay identical to the one in verify.js so that
// CDN-injected scripts don't break the integrity check (G4 / strip-before-hash).
const STRIP_SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;

// Walk dist/, SHA-256 hash every .html/.js/.css file.
// Sorts entries alphabetically so integrity.json is deterministic across runs.
function buildIntegrity(dir, base) {
  base = base || dir;
  const out = {};
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(out, buildIntegrity(full, base));
    } else if (/\.(html|js|css)$/.test(entry.name)) {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      let content = fs.readFileSync(full);
      if (entry.name.endsWith('.html')) {
        content = Buffer.from(
          content.toString('utf8').replace(STRIP_SCRIPT_RE, ''),
          'utf8'
        );
      }
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      out[rel] = hash;
    }
  }
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────

// Clear dist/ without removing the directory itself (preserves Docker bind mounts)
if (fs.existsSync(DIST)) {
  for (const entry of fs.readdirSync(DIST, { withFileTypes: true })) {
    const full = path.join(DIST, entry.name);
    if (entry.isDirectory()) fs.rmSync(full, { recursive: true });
    else fs.unlinkSync(full);
  }
} else {
  fs.mkdirSync(DIST, { recursive: true });
}

// Copy CSS, JS, and other non-HTML assets first so SRI hashes can be computed.
copyAssets(SRC, DIST);

// Inject party age keys from party-keys.txt into dist/js/relays.js.
// party-keys.txt is the single canonical source; relays.js in source has a
// placeholder array that is overwritten here so there is exactly one place
// to edit when adding or revoking a party member.
(function injectPartyKeys() {
  const keysPath = path.join(ROOT, 'party-keys.txt');
  const raw = fs.readFileSync(keysPath, 'utf8');
  const keys = raw.split('\n')
    .map(function(l) { return l.trim(); })
    .filter(function(l) { return l.length > 0 && !l.startsWith('#'); });
  if (keys.length === 0) {
    throw new Error('party-keys.txt contains no keys — add at least one age1… public key');
  }
  const relaysPath = path.join(DIST, 'js/relays.js');
  const src = fs.readFileSync(relaysPath, 'utf8');
  const keysLiteral = keys.map(function(k) { return "  '" + k + "'"; }).join(',\n');
  const patched = src.replace(
    /export const PARTY_AGE_KEYS = \[[^\]]*\];/,
    'export const PARTY_AGE_KEYS = [\n' + keysLiteral + ',\n];'
  );
  if (patched === src) {
    throw new Error('party-keys injection failed: PARTY_AGE_KEYS pattern not found in dist/js/relays.js');
  }
  fs.writeFileSync(relaysPath, patched);
})();

// Pre-compute SRI hashes for assets referenced directly in <script src> / <link>.
// These are injected into every page via template placeholders so the browser
// can verify first-party assets before executing them.
const sriCtx = {
  sri_css:       sriHash(path.join(DIST, 'css/style.css')),
  sri_verify_js: sriHash(path.join(DIST, 'js/verify.js')),
};

// Render template × language matrix
let pagesRendered = 0;
for (const lang of LANGS) {
  const transPath = path.join(TRANS_DIR, lang.code + '.json');
  const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));
  const outDir = lang.code === 'en' ? DIST : path.join(DIST, lang.code);
  fs.mkdirSync(outDir, { recursive: true });

  for (const page of lang.pages) {
    const tmpl = fs.readFileSync(path.join(TEMPLATES, page + '.html'), 'utf8');
    const ctx  = buildContext(trans, lang.code, page, sriCtx);
    const html = render(tmpl, ctx);
    fs.writeFileSync(path.join(outDir, page + '.html'), html);
    pagesRendered++;
  }
}

const summary = LANGS.map(function (l) { return l.code + ':' + l.pages.length; }).join(' ');
console.log('Rendered ' + pagesRendered + ' pages (' + summary + ')');

// Generate integrity.json — no timestamp so the output is deterministic
// across builds (two consecutive builds from the same source must be identical).
// Entries are sorted alphabetically by buildIntegrity() for the same reason.
const files = buildIntegrity(DIST);
fs.writeFileSync(
  path.join(DIST, 'integrity.json'),
  JSON.stringify({ files }, null, 2)
);
console.log('integrity.json: ' + Object.keys(files).length + ' files hashed');
console.log('Built → ' + DIST);
