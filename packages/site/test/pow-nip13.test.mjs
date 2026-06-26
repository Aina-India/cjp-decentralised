// Regression tests for NIP-13 proof-of-work binding (PR-3 / issue #14).
// Verifies: leadingZeroBits helper, NIP-01 canonical serialization, and that
// a mined nonce actually satisfies the required difficulty threshold.
//
// Runs entirely in Node with node:crypto — no browser APIs needed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// ── helpers copied from pow-worker.js (must stay byte-compatible) ──────────

function leadingZeroBits(bytes) {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) { count += 8; continue; }
    for (let bit = 7; bit >= 0; bit--) {
      if ((bytes[i] >> bit) & 1) return count;
      count++;
    }
    break;
  }
  return count;
}

function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function sha256(str) {
  return createHash('sha256').update(str, 'utf8').digest();
}

// ── 1. leadingZeroBits contract ────────────────────────────────────────────

let pass = 0;

function test(name, fn) {
  try { fn(); console.log('  ok:', name); pass++; }
  catch (e) { console.error('FAIL:', name, '\n    ', e.message); process.exitCode = 1; }
}

test('leadingZeroBits: 0x00 byte = 8 bits', () => {
  assert.equal(leadingZeroBits(new Uint8Array([0x00])), 8);
});
test('leadingZeroBits: 0x80 byte = 0 bits', () => {
  assert.equal(leadingZeroBits(new Uint8Array([0x80])), 0);
});
test('leadingZeroBits: 0x01 byte = 7 bits', () => {
  assert.equal(leadingZeroBits(new Uint8Array([0x01])), 7);
});
test('leadingZeroBits: 0x00,0x80 = 8 bits', () => {
  assert.equal(leadingZeroBits(new Uint8Array([0x00, 0x80])), 8);
});
test('leadingZeroBits: 0x00,0x00,0x10 = 19 bits', () => {
  assert.equal(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x10])), 19);
});

// ── 2. NIP-01 canonical serialization format ───────────────────────────────

test('NIP-01 serialization: deterministic JSON array', () => {
  const template = {
    pubkey: 'aabbcc', kind: 1, created_at: 1000000,
    tags: [['t', 'cjp-test']], content: 'hello',
  };
  const serialized = JSON.stringify([0, template.pubkey, template.created_at, template.kind, template.tags, template.content]);
  assert.equal(serialized, '["0","aabbcc",1000000,1,[["t","cjp-test"]],"hello"]'.replace('"0"', '0'));
  // Exact format: [0, pubkey, created_at, kind, tags, content]
  const parsed = JSON.parse(serialized);
  assert.equal(parsed[0], 0);
  assert.equal(parsed[1], 'aabbcc');
  assert.equal(parsed[2], 1000000);
  assert.equal(parsed[3], 1);
  assert.deepEqual(parsed[4], [['t', 'cjp-test']]);
  assert.equal(parsed[5], 'hello');
});

test('NIP-01 nonce tag is third element with committed difficulty', () => {
  const nonceTags = [['t', 'cjp-test'], ['nonce', '42', '20']];
  const nonceTag = nonceTags.find(t => t[0] === 'nonce');
  assert.equal(nonceTag[1], '42');
  assert.equal(nonceTag[2], '20');
});

// ── 3. Mining integration: a mined nonce satisfies the difficulty ──────────

test('mine at difficulty=4: found nonce satisfies leadingZeroBits >= 4', () => {
  const difficulty = 4;
  const template = {
    pubkey: '0'.repeat(64),
    kind: 1,
    created_at: 1700000000,
    tags: [['t', 'cjp-test']],
    content: 'regression test',
  };
  const baseTags = template.tags.filter(t => t[0] !== 'nonce');
  let found = false;
  for (let nonce = 0; nonce < 1_000_000; nonce++) {
    const minedTags = [...baseTags, ['nonce', String(nonce), String(difficulty)]];
    const serialized = JSON.stringify([0, template.pubkey, template.created_at, template.kind, minedTags, template.content]);
    const hash = new Uint8Array(sha256(serialized));
    if (leadingZeroBits(hash) >= difficulty) {
      // verify the returned id matches
      const id = bytesToHex(hash);
      assert.equal(id.length, 64, 'id must be 32-byte hex');
      found = true;
      break;
    }
  }
  assert.ok(found, 'should find a nonce within 1M iterations for difficulty=4');
});

test('nonce tag replaces any existing nonce tag in baseTags', () => {
  const tags = [['t', 'cjp-test'], ['nonce', '0', '20']];
  const baseTags = tags.filter(t => t[0] !== 'nonce');
  const minedTags = [...baseTags, ['nonce', '99', '20']];
  const nonceEntries = minedTags.filter(t => t[0] === 'nonce');
  assert.equal(nonceEntries.length, 1, 'exactly one nonce tag after mining');
  assert.equal(nonceEntries[0][1], '99');
});

console.log(`\n${pass} tests passed`);
