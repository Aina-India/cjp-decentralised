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

// Build flat substitution context for (trans, langCode, page)
function buildContext(trans, langCode, page) {
  const base    = langCode === 'en' ? '' : '../';
  const pageData = trans.pages[page];
  if (!pageData) {
    throw new Error('No page data for "' + page + '" in lang "' + langCode + '"');
  }

  const ctx = {
    lang:               trans.lang,
    base,
    party_name:         trans.party_name,
    nav_manifesto:      trans.nav.manifesto,
    nav_join:           trans.nav.join,
    nav_demand:         trans.nav.demand,
    nav_mirror:         trans.nav.mirror,
    lang_switcher:      buildLangSwitcher(langCode, page),
    canonical_og_block: buildCanonicalOgBlock(langCode, page, trans),
  };

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

// Walk dist/, SHA-256 hash every .html/.js/.css file.
// Strip <script> tags from HTML before hashing — mirrors verify.js behaviour so
// that CDN-injected scripts don't break the integrity check.
function buildIntegrity(dir, base) {
  base = base || dir;
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(out, buildIntegrity(full, base));
    } else if (/\.(html|js|css)$/.test(entry.name)) {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      let content = fs.readFileSync(full);
      if (entry.name.endsWith('.html')) {
        content = Buffer.from(
          content.toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''),
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

// Copy CSS, JS, and other non-HTML assets
copyAssets(SRC, DIST);

// Render template × language matrix
let pagesRendered = 0;
for (const lang of LANGS) {
  const transPath = path.join(TRANS_DIR, lang.code + '.json');
  const trans = JSON.parse(fs.readFileSync(transPath, 'utf8'));
  const outDir = lang.code === 'en' ? DIST : path.join(DIST, lang.code);
  fs.mkdirSync(outDir, { recursive: true });

  for (const page of lang.pages) {
    const tmpl = fs.readFileSync(path.join(TEMPLATES, page + '.html'), 'utf8');
    const ctx  = buildContext(trans, lang.code, page);
    const html = render(tmpl, ctx);
    fs.writeFileSync(path.join(outDir, page + '.html'), html);
    pagesRendered++;
  }
}

const summary = LANGS.map(function (l) { return l.code + ':' + l.pages.length; }).join(' ');
console.log('Rendered ' + pagesRendered + ' pages (' + summary + ')');

// Generate integrity.json
const files = buildIntegrity(DIST);
fs.writeFileSync(
  path.join(DIST, 'integrity.json'),
  JSON.stringify({ generated: new Date().toISOString(), files }, null, 2)
);
console.log('integrity.json: ' + Object.keys(files).length + ' files hashed');
console.log('Built → ' + DIST);
