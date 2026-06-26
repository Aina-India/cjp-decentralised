// Pure signature-threshold verification logic — the single source of truth
// shared by the browser badge (verify.js) and the test harness
// (packages/site/test/verify-logic.test.mjs). Named .js (not .mjs) so nginx
// serves it with a browser-accepted JS MIME type like the other bundles;
// packages/site/package.json sets "type":"module" so Node treats it as ESM too.
// No DOM, no network, no globals
// beyond Web Crypto (crypto.subtle), which exists in browsers and in Node via
// crypto.webcrypto.
//
// Signature scheme (must stay byte-compatible with
// packages/{mirror,publisher}/signing.go — Guardrail G3):
//   Ed25519( SHA-256( "{cid}\n{version}\n{timestamp}" ) )

export function hexToBytes(hex) {
  const a = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return a;
}

export function bytesToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Normalise the legacy single-sig and multi-sig array formats into one list,
// then keep only entries whose signer is in the trusted set.
export function collectTrustedSigs(latest, trustedSet) {
  const allSigs = Array.isArray(latest.signatures) && latest.signatures.length > 0
    ? latest.signatures
    : (latest.signer ? [{ signer: latest.signer, signature: latest.signature }] : []);
  return allSigs.filter(s => trustedSet.has(s.signer));
}

// Verify each trusted signature against the signing message and return the list
// of signer hexes whose signature checked out. Throws only if SubtleCrypto's
// SHA-256 digest is unavailable (the caller surfaces the "Ed25519 unsupported"
// UX); per-signature import/verify failures are skipped, matching the original
// verify.js behaviour.
//
export async function verifyTrustedSigs(trustedSigs, latest) {
  const msgBytes = new TextEncoder().encode(`${latest.cid}\n${latest.version}\n${latest.timestamp}`);
  const msgHash = await crypto.subtle.digest('SHA-256', msgBytes);

  const seen = new Set();
  const validSigners = [];
  for (const s of trustedSigs) {
    if (seen.has(s.signer)) continue;
    try {
      const pubKey = await crypto.subtle.importKey(
        'raw', hexToBytes(s.signer),
        { name: 'Ed25519' }, false, ['verify']
      );
      const ok = await crypto.subtle.verify(
        { name: 'Ed25519' }, pubKey,
        hexToBytes(s.signature),
        msgHash
      );
      if (ok) { seen.add(s.signer); validSigners.push(s.signer); }
    } catch (_) { /* malformed entry, skip */ }
  }
  return validSigners;
}
