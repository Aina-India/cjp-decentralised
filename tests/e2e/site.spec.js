// @ts-check
// Playwright smoke tests for the generated dist/ site.
// These run against a local `serve dist/` server and verify that:
//   - all 17 pages in the render matrix load without errors
//   - HTML structure matches what the templates + translations should produce
//   - security invariants hold (type=module, no CDN scripts, no old form fields)
//
// Run locally: npm run build && npx playwright test
// CI: build step runs first, then the e2e job picks up dist/.

const { test, expect } = require('@playwright/test');

// ── Render matrix (must match scripts/build.js LANGS) ───────────────────────

const LANGS = [
  { code: 'en', langAttr: 'en', pages: ['index', 'join', 'demand', 'mirror', 'trust'] },
  { code: 'hi', langAttr: 'hi', pages: ['index', 'join', 'demand'] },
  { code: 'ta', langAttr: 'ta', pages: ['index', 'join', 'demand'] },
  { code: 'te', langAttr: 'te', pages: ['index', 'join', 'demand'] },
  { code: 'bn', langAttr: 'bn', pages: ['index', 'join', 'demand'] },
];

/** URL path for a given (lang, page) pair. */
function pageURL(code, page) {
  if (code === 'en') return page === 'index' ? '/' : `/${page}.html`;
  return `/${code}/${page}.html`;
}

// ── 1. Every page in the render matrix loads ─────────────────────────────────
// Checks: HTTP 200, correct html[lang], verify badge present, verify.js
// loaded as type=module, no uncaught JS errors on initial load.

for (const lang of LANGS) {
  for (const page of lang.pages) {
    test(`${lang.code}/${page} — loads cleanly`, async ({ page: pw }) => {
      const jsErrors = [];
      pw.on('pageerror', e => jsErrors.push(e.message));

      const res = await pw.goto(pageURL(lang.code, page));
      expect(res.status(), 'HTTP 200').toBe(200);

      await expect(pw.locator('html'), 'html[lang]')
        .toHaveAttribute('lang', lang.langAttr);

      await expect(
        pw.locator('#cjp-verify-badge'),
        'verify badge element present'
      ).toBeAttached();

      await expect(
        pw.locator('script[src*="verify.js"][type="module"]'),
        'verify.js loaded as ES module'
      ).toBeAttached();

      expect(jsErrors, 'no uncaught JS errors').toEqual([]);
    });
  }
}

// ── 2. Join form structure (all 5 languages) ─────────────────────────────────
// Checks: name + location fields present; old state <select> absent;
// frc-captcha widget (CDN captcha from #15) absent.

for (const lang of LANGS) {
  if (!lang.pages.includes('join')) continue;
  test(`${lang.code}/join — form fields correct`, async ({ page: pw }) => {
    await pw.goto(pageURL(lang.code, 'join'));

    await expect(pw.locator('input[name="name"]'), 'name field').toBeAttached();
    await expect(pw.locator('input[name="location"]'), 'location field').toBeAttached();
    await expect(
      pw.locator('input[name="state"], select[name="state"], select[id="state"]'),
      'no old state dropdown'
    ).not.toBeAttached();
    await expect(pw.locator('frc-captcha'), 'no CDN captcha').not.toBeAttached();
  });
}

// ── 3. Demand form structure (all 5 languages) ───────────────────────────────

for (const lang of LANGS) {
  if (!lang.pages.includes('demand')) continue;
  test(`${lang.code}/demand — form fields correct`, async ({ page: pw }) => {
    await pw.goto(pageURL(lang.code, 'demand'));

    await expect(pw.locator('input[name="name"]'), 'name field').toBeAttached();
    await expect(pw.locator('input[name="city"]'), 'city field').toBeAttached();
    await expect(pw.locator('input[name="country"]'), 'country field').toBeAttached();
  });
}

// ── 4. EN-only pages return 404 for non-EN languages ─────────────────────────
// mirror.html and trust.html have EN-only body content — no translated versions
// should exist in dist/.

for (const lang of LANGS.filter(l => l.code !== 'en')) {
  for (const enOnlyPage of ['mirror', 'trust']) {
    test(`${lang.code}/${enOnlyPage} — 404 (EN-only page)`, async ({ page: pw }) => {
      const res = await pw.goto(`/${lang.code}/${enOnlyPage}.html`, { waitUntil: 'commit' });
      expect(res.status(), 'should 404').toBe(404);
    });
  }
}

// ── 5. Mirror page lang switcher falls back to /lang/index.html ───────────────
// mirror.html only exists for EN, so the lang switcher on that page must link
// non-EN languages to their index page, not to a non-existent lang/mirror.html.

test('mirror — lang switcher links non-EN to index fallback', async ({ page: pw }) => {
  await pw.goto('/mirror.html');
  const nonEN = LANGS.filter(l => l.code !== 'en');
  for (const lang of nonEN) {
    await expect(
      pw.locator(`.langs a[href="${lang.code}/index.html"]`),
      `${lang.code} link → index`
    ).toBeAttached();
    await expect(
      pw.locator(`.langs a[href="${lang.code}/mirror.html"]`),
      `${lang.code} link must NOT go to mirror`
    ).not.toBeAttached();
  }
});

// ── 6. Lang switcher marks current language with class="cur" ─────────────────
// Spot-check a translated page: hi/join should mark हि as current and link
// EN to ../join.html (not join.html which would be relative to /hi/).

test('hi/join — lang switcher .cur and EN back-link', async ({ page: pw }) => {
  await pw.goto('/hi/join.html');

  // The हि entry should be marked current and href="join.html" (same dir)
  const curLink = pw.locator('.langs a.cur');
  await expect(curLink, '.cur link present').toBeAttached();
  await expect(curLink, '.cur href is same-dir join.html').toHaveAttribute('href', 'join.html');

  // EN link must go up one level
  await expect(
    pw.locator('.langs a[href="../join.html"]'),
    'EN link → ../join.html'
  ).toBeAttached();
});

// ── 7. No CDN script src attributes on any page ───────────────────────────────
// Belt-and-suspenders check alongside the CI grep gate: verify the browser
// sees no <script src="https://cdn.*"> pointing at external CDNs.

const CDN_PATTERN = /https?:\/\/(cdn\.jsdelivr\.net|esm\.sh|unpkg\.com|cdnjs\.cloudflare\.com)/;

for (const lang of LANGS) {
  for (const page of lang.pages) {
    test(`${lang.code}/${page} — no CDN script src`, async ({ page: pw }) => {
      await pw.goto(pageURL(lang.code, page));
      const srcs = await pw.locator('script[src]').evaluateAll(
        els => els.map(el => el.getAttribute('src'))
      );
      for (const src of srcs) {
        expect(src, `CDN ref in script src: ${src}`).not.toMatch(CDN_PATTERN);
      }
    });
  }
}
