// Test harness for packages/site/js/verify-logic.mjs — the browser badge's
// verification logic. Runs the SAME testdata/latest.vectors.json that the Go
// tests (packages/{mirror,publisher}) consume, so the cross-language contract
// (Guardrail G3) is checked from both sides.
//
// Zero npm dependencies. Uses node:assert + crypto.webcrypto so it runs on the
// pinned local Node 16.17 (where the `crypto` global is absent) and on CI's
// Node 20. node:test is NOT available on 16.17, hence the tiny inline runner.

import assert from 'node:assert';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

// verify-logic.mjs uses the global `crypto.subtle`; provide it on Node 16.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { collectTrustedSigs, verifyTrustedSigs, hexToBytes, bytesToHex } =
  await import('../js/verify-logic.js');

const vectorsPath = new URL('../../../testdata/latest.vectors.json', import.meta.url);
const { vectors } = JSON.parse(readFileSync(vectorsPath, 'utf8'));

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}\n       ${e.message}`);
  }
}

// ── Sanity: hex helpers round-trip ──
await it('hex round-trip', () => {
  const hex = 'deadbeef00ff';
  assert.strictEqual(bytesToHex(hexToBytes(hex)), hex);
});

// ── Cross-language vectors: the same accept/reject the Go tests assert ──
assert.ok(Array.isArray(vectors) && vectors.length > 0, 'vector file must contain vectors');
for (const v of vectors) {
  await it(`vector: ${v.name}`, async () => {
    const trustedSet = new Set(v.trustedSigners);
    const trustedSigs = collectTrustedSigs(v.latest, trustedSet);
    const validSigners = await verifyTrustedSigs(trustedSigs, v.latest);
    const validCount = validSigners.length;
    const valid = validCount >= v.threshold;

    assert.strictEqual(validCount, v.expectedValidCount,
      `${v.name}: validCount ${validCount} != expected ${v.expectedValidCount}`);
    assert.strictEqual(valid, v.expectedValid,
      `${v.name}: valid ${valid} != expected ${v.expectedValid}`);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
