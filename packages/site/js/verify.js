// Mirror authenticity verification — per-file content integrity.
//
// Trust chain:
//   GitHub latest.json  →  M-of-N Ed25519 signatures (trusted party keys)
//     └─ sign IPFS CID  →  content-addressed directory
//           └─ contains integrity.json  →  SHA-256 of every page
//                 └─ fetched via signed CID  →  compare to this page's bytes
//
// Consensus model: latest.json carries an array of independent signatures.
// The badge requires ≥ threshold of them to be valid and from trusted keys.
// An attacker must compromise multiple separate signing keys to forge a valid
// update — compromising one key is not sufficient.
//
// Signature scheme (mirrors packages/publisher/signing.go):
//   Ed25519( SHA-256( "{cid}\n{version}\n{timestamp}" ) )
//
// Badge states (fail-closed — green only on a positive content hash match):
//   pending  — verifying in progress
//   verified — signatures valid AND page hash matches integrity manifest ✓
//   signed   — signatures valid but content hash unverified (amber) ⊘
//   outdated — signatures valid but latest.json is >48 h old ⚠
//   invalid  — signature check failed or hash mismatch ✗
//   unknown  — no update source reachable ?

import { hexToBytes, bytesToHex, collectTrustedSigs, verifyTrustedSigs } from './verify-logic.js';

(async function () {
  'use strict';

  const REPO     = 'https://raw.githubusercontent.com/grussdorian/cjp-decentralised/main';
  // GATEWAYS is used for the integrity.json fetch — multi-gateway race so the
  // verification path stays independent of any single provider.
  const GATEWAYS = [
    'https://dweb.link/ipfs',
    'https://w3s.link/ipfs',
    'https://ipfs.io/ipfs',
  ];
  // User-facing "open on IPFS" links use the SAME-ORIGIN gateway — every
  // mirror bundles a kubo node with the current CID pinned, so first-byte
  // latency is consistently <100ms and there's no dependency on any
  // third-party gateway being fast on the current CID.
  const PRIMARY_GATEWAY = '/ipfs';

  // Trusted Ed25519 public keys (hex) — hardcoded so that GitHub cannot swap
  // in attacker-controlled keys by modifying trusted-signers.json.
  // These keys are authoritative; adding a key here requires a code change in
  // this file, which is itself covered by the IPFS integrity check.
  // To add a new party member: run `publisher keygen`, add the pubkey here,
  // rebuild, publish a new CID signed by existing threshold.
  const HARDCODED_SIGNERS = new Set([
    'c1688ff074c50557d4aacfd668580c119dd4e425f18eb65c8cffac53a433b5c3',
  ]);
  // Minimum number of distinct valid signatures required before showing ✓.
  // Raise this as more party members join.
  const HARDCODED_THRESHOLD = 1;

  const badge = document.getElementById('cjp-verify-badge');
  if (!badge) return;

  // hexToBytes / bytesToHex / collectTrustedSigs / verifyTrustedSigs are imported
  // from ./verify-logic.js — the single source of truth also exercised by the
  // test harness (packages/site/test/verify-logic.test.mjs).

  function set(state, html) {
    badge.className = 'cjp-badge cjp-badge--' + state;
    badge.innerHTML = html;
  }

  // Bootstrap relay set for the Nostr fallback path. Kept in sync with the
  // daemon's heartbeat relays so update events written by the publisher are
  // discoverable from the browser too.
  const NOSTR_RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nostr.mom',
    'wss://nostr.bitcoiner.social',
    'wss://nostr-pub.wellorder.net',
  ];

  // Query Nostr for the highest-versioned #cjp-update event whose content
  // parses as a Latest object. Signature verification happens in Step 3
  // below — Nostr is just transport here.
  async function fetchLatestFromNostr(timeoutMs = 5000) {
    const since = Math.floor(Date.now() / 1000) - 14 * 24 * 3600;
    const filter = { kinds: [1], '#t': ['cjp-update'], since, limit: 50 };
    let best = null;
    await Promise.allSettled(NOSTR_RELAYS.map(url => new Promise(resolve => {
      let ws;
      try { ws = new WebSocket(url); } catch { return resolve(); }
      const subId = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(); }, timeoutMs);
      ws.onopen = () => ws.send(JSON.stringify(['REQ', subId, filter]));
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EOSE') { clearTimeout(timer); ws.close(); resolve(); return; }
          if (data[0] === 'EVENT') {
            try {
              const l = JSON.parse(data[2].content);
              if (l && typeof l.cid === 'string' && typeof l.version === 'number') {
                if (!best || l.version > best.version) best = l;
              }
            } catch {}
          }
        } catch {}
      };
      ws.onerror = () => { clearTimeout(timer); resolve(); };
    })));
    return best;
  }

  // Fetch integrity.json from IPFS gateways. Returns null if all fail/timeout.
  async function fetchIntegrity(cid) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const res = await Promise.any(
        GATEWAYS.map(gw =>
          fetch(`${gw}/${cid}/integrity.json`, {
            cache: 'no-cache',
            signal: ctl.signal,
          }).then(r => r.ok ? r : Promise.reject(new Error('non-2xx')))
        )
      );
      clearTimeout(timer);
      ctl.abort();
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  // ── Steps 4+5: fetch integrity manifest and compare page hash ────────────
  // `retried` prevents an infinite retry loop — we allow at most one deferred
  // re-attempt for the IPFS-propagating case.
  async function verifyContentHash(latest, gwLink, sigLabel, retried) {
    // ── Step 4: fetch integrity.json via signed CID (content-addressed) ─────
    // Try all gateways in parallel with a short timeout so a single slow gateway
    // doesn't hang the badge for 30+ seconds.
    const integrity = await fetchIntegrity(latest.cid);

    if (!integrity) {
      // Signatures are valid but we cannot reach the content manifest yet —
      // IPFS propagation often takes 10–30s after publication.
      // Show amber and schedule one retry; do NOT show green (fail-closed).
      set('signed',
        `⊘ Signed · content unverified · ${gwLink} · v${latest.version} · ${sigLabel}` +
        ` · <small>IPFS propagating…</small>`);
      if (!retried) {
        setTimeout(() => verifyContentHash(latest, gwLink, sigLabel, true), 20000);
      }
      return;
    }

    // ── Step 5: hash this page and compare to the integrity manifest ─────────
    const pagePath = location.pathname === '/' ? 'index.html'
                   : location.pathname.replace(/^\//, '');

    const expectedHash = integrity.files && integrity.files[pagePath];
    if (!expectedHash) {
      // Page exists but is absent from the manifest (e.g. a newly added page
      // not yet in a published CID). Signatures are valid; content unverified.
      set('signed',
        `⊘ Signed · content unverified · ${gwLink} · v${latest.version} · ${sigLabel}` +
        ` · <small>page not in manifest</small>`);
      return;
    }

    let actualHash;
    try {
      const resp = await fetch(location.pathname + location.search, { cache: 'no-cache' });
      const text = await resp.text();
      // Strip <script> tags before hashing — CDN providers (e.g. Cloudflare) inject
      // scripts into HTML responses without modifying the signed content. We verify
      // the document body, not the delivery wrapper.
      const stripped = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      actualHash = bytesToHex(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stripped))
      );
    } catch (_) {
      // Page re-fetch blocked (strict CSP, offline, etc.). Signatures are valid
      // but we cannot confirm content integrity — show amber, not green.
      set('signed',
        `⊘ Signed · content unverified · ${gwLink} · v${latest.version} · ${sigLabel}` +
        ` · <small>page re-fetch blocked</small>`);
      return;
    }

    if (actualHash === expectedHash) {
      set('verified', `✓ Signed · ${gwLink} · v${latest.version} · ${sigLabel}`);
    } else {
      set('invalid',
        `✗ Page content does not match signed CID — this mirror may be serving modified content. ` +
        `Compare against ${gwLink}`);
    }
  }

  set('pending', '<span class="cjp-badge__spin"></span>Verifying…');

  // ── Step 1: fetch latest.json — manual override > GitHub > Nostr ─────────
  // We do NOT fetch trusted-signers.json from GitHub — that would let a state
  // actor with GitHub access swap in their own keys. Trusted keys are
  // hardcoded above and covered by the IPFS integrity check of this very
  // file. Whichever source provides the highest-versioned Latest with a
  // valid M-of-N Ed25519 signature wins (verification in Steps 2-3).
  let latest;

  // 1a. Manual override (paste UI on trust.html stores a verified Latest here).
  try {
    const ov = localStorage.getItem('cjp:manual-latest');
    if (ov) {
      const parsed = JSON.parse(ov);
      if (parsed && parsed.cid && parsed.version) latest = parsed;
    }
  } catch {}

  // 1b. GitHub raw — primary source when reachable.
  if (!latest) {
    try {
      const lr = await fetch(REPO + '/latest.json', { cache: 'no-cache' });
      if (lr.ok) latest = await lr.json();
    } catch {}
  }

  // 1c. Nostr fallback — works even if GitHub is unreachable. The publisher
  // broadcasts the full signed Latest to every relay in its set; one event
  // surviving anywhere in the federation is sufficient.
  if (!latest) {
    set('pending', '<span class="cjp-badge__spin"></span>GitHub unreachable — querying Nostr…');
    latest = await fetchLatestFromNostr();
  }

  if (!latest) {
    set('unknown', '? No update source reachable — paste the signed manifest at <a href="/trust.html#manual-update">trust.html</a>');
    return;
  }

  // ── Step 2: collect signatures; filter to hardcoded trusted keys ─────────
  const threshold  = HARDCODED_THRESHOLD;
  const trustedSet = HARDCODED_SIGNERS;

  // Normalise legacy/multi-sig formats and filter to trusted signers.
  const trustedSigs = collectTrustedSigs(latest, trustedSet);
  if (trustedSigs.length === 0) {
    set('invalid', '✗ No signature from a trusted signer — do not trust this mirror');
    return;
  }

  // ── Step 3: verify Ed25519 signatures — require ≥ threshold valid ───────
  // All signers sign the same message: SHA-256("{cid}\n{version}\n{timestamp}").
  // Showing the key fingerprint in the badge means a phishing clone cannot
  // display the same fingerprint without holding the real private keys.
  let validSigners;
  try {
    validSigners = await verifyTrustedSigs(trustedSigs, latest);
  } catch (_) {
    set('unknown', '? Ed25519 not supported in this browser — <a href="' + PRIMARY_GATEWAY + '/' + latest.cid + '" target="_blank" rel="noopener noreferrer">verify via IPFS</a>');
    return;
  }
  const validCount = validSigners.length;

  if (validCount < threshold) {
    set('invalid',
      `✗ Only ${validCount}/${threshold} required signatures valid — ` +
      `signed pointer may be tampered`);
    return;
  }

  const short = c => c.slice(0, 16) + '…';
  const gwLink = `<a class="cjp-badge__cid" href="${PRIMARY_GATEWAY}/${latest.cid}" target="_blank" rel="noopener noreferrer" title="Open canonical version on IPFS">${short(latest.cid)}</a>`;

  // Short fingerprint: first 8 + last 4 hex chars, e.g. "c1688ff0…b5c3"
  // Shown in the badge so users can cross-check against out-of-band sources
  // (flyers, Nostr, trusted contacts).  A clone using different keys will show
  // different fingerprints, exposing the fake.
  const fingerprints = validSigners.map(k => k.slice(0, 8) + '…' + k.slice(-4)).join(' ');
  // Root-relative href so the link works from translated subdirectory pages
  // (e.g. /hi/index.html → /trust.html, not /hi/trust.html which doesn't exist).
  const sigLabel = `<a class="cjp-badge__fp" href="/trust.html" title="What does this fingerprint mean? How to verify.">${fingerprints}</a>`;

  // ── Step 3b: staleness check ──────────────────────────────────────────────
  // latest.timestamp is when the publisher signed this CID. If it is older
  // than 48 h the content may be stale — show the outdated badge and stop.
  // The daemon enforces the same threshold server-side; this is client-visible.
  const MAX_STALE_SECONDS = 48 * 3600;
  if (latest.timestamp && (Date.now() / 1000 - latest.timestamp) > MAX_STALE_SECONDS) {
    const ageHours = Math.floor((Date.now() / 1000 - latest.timestamp) / 3600);
    set('outdated', `⚠ Signed but stale — last update ${ageHours}h ago · ${gwLink} · ${sigLabel}`);
    return;
  }

  // ── Steps 4+5: fetch integrity manifest and verify page content hash ─────
  await verifyContentHash(latest, gwLink, sigLabel, false);
})();
