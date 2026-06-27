// Queries Nostr relays for mirror heartbeat events and displays live stats.
//
// Federation model: every volunteer mirror runs its own bundled strfry relay
// and advertises its public WSS URL in the heartbeat's `relay_url` field.
// This module bootstraps from the small RELAYS list, then merges every
// discovered relay_url into the query pool for the next refresh. Result:
// the relay set grows with volunteer count, no central registry needed.
//
// Trust model (PR-9 / #19): heartbeat events are Sybil-floodable because
// creating a Nostr keypair is free. MIRROR_MIN_POW requires the event ID
// (NIP-13) to have ≥ N leading zero bits, making Sybil inflation costly.
// The daemon mines this PoW when HEARTBEAT_POW_DIFFICULTY > 0. The browser
// shows a separate "authenticated" count for mirrors that pass the check.
import { RELAYS, MIRROR_TAG } from './relays.js';

// Heartbeat window: mirrors that haven't sent a heartbeat within this many
// seconds are not counted. Mirror daemons beat every 60s ±10s.
const HEARTBEAT_WINDOW_S = 300;

// Minimum NIP-13 committed difficulty for a mirror to be counted as
// "authenticated". At 12 bits the expected cost per heartbeat is ~4096
// SHA-256 hashes (~0.1 ms on modern hardware, ~1 ms on a Raspberry Pi) —
// negligible for honest mirrors, expensive for Sybil flooding at scale.
const MIRROR_MIN_POW = 12;

// Whitelist of CID character class — base32 + base58. Anything else is dropped.
const CID_PATTERN = /^[A-Za-z0-9]{20,80}$/;
// Whitelist for ISO country codes / short identifiers displayed in the list.
const COUNTRY_PATTERN = /^[A-Za-z0-9 _\-]{0,32}$/;

// Runtime-discovered relay URLs from past heartbeats. Persists across refreshes
// within the page session. Bounded to keep the query fan-out reasonable.
const MAX_DISCOVERED_RELAYS = 30;
const discoveredRelays = new Set();

function safeURL(s) {
  if (typeof s !== 'string') return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u;
  } catch {
    return null;
  }
}

function safeRelayURL(s) {
  if (typeof s !== 'string') return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'wss:' && u.protocol !== 'ws:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function el(tag, attrs, text) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

// Returns the NIP-13 committed difficulty of a Nostr event.
// The event must carry a nonce tag ["nonce", "<n>", "<target>"] AND its
// id must actually satisfy that target (i.e. committed ≤ actual leading bits).
// Returns 0 if no valid nonce tag is present or the commitment is not met.
function committedPoWBits(ev) {
  if (!ev || typeof ev.id !== 'string' || ev.id.length !== 64) return 0;
  const tags = Array.isArray(ev.tags) ? ev.tags : [];
  const nonce = tags.find(t => Array.isArray(t) && t[0] === 'nonce' && t.length >= 3);
  if (!nonce) return 0;
  const target = parseInt(nonce[2], 10);
  if (!Number.isFinite(target) || target <= 0) return 0;
  // Count leading zero bits in the hex event id.
  let bits = 0;
  for (let i = 0; i < ev.id.length; i += 2) {
    const byte = parseInt(ev.id.slice(i, i + 2), 16);
    if (byte === 0) { bits += 8; continue; }
    for (let b = 7; b >= 0; b--) { if ((byte >> b) & 1) break; bits++; }
    break;
  }
  // Committed difficulty = min(target, actual) per NIP-13.
  // We check committed >= MIRROR_MIN_POW so a fake target can't inflate the count.
  return Math.min(target, bits);
}

export async function loadMirrorStats(countEl, listEl) {
  const since = Math.floor(Date.now() / 1000) - HEARTBEAT_WINDOW_S;
  const filter = { kinds: [1], '#t': [MIRROR_TAG], since, limit: 200 };

  const seen = new Map(); // nostr pubkey → latest event

  // Query bootstrap RELAYS plus everything discovered from previous beats.
  const urls = Array.from(new Set([...RELAYS, ...discoveredRelays]));
  await Promise.allSettled(urls.map(url => queryRelay(url, filter, seen)));

  // Harvest relay_url advertisements from this round for the next refresh.
  // Federation grows organically as more mirrors come online.
  for (const [, ev] of seen) {
    try {
      const data = JSON.parse(ev.content);
      const u = safeRelayURL(data.relay_url);
      if (u && !discoveredRelays.has(u) && discoveredRelays.size < MAX_DISCOVERED_RELAYS) {
        discoveredRelays.add(u);
      }
    } catch {}
  }

  // Separate authenticated mirrors (NIP-13 PoW >= MIRROR_MIN_POW) from the total.
  let authenticatedCount = 0;
  for (const [, ev] of seen) {
    if (committedPoWBits(ev) >= MIRROR_MIN_POW) authenticatedCount++;
  }

  if (countEl) {
    countEl.textContent = seen.size;
    // Append authenticated sub-count when at least one mirror proves work.
    if (authenticatedCount > 0) {
      const sub = document.createElement('small');
      sub.style.cssText = 'display:block;font-size:.6em;color:var(--muted);margin-top:.2rem';
      sub.textContent = authenticatedCount + ' authenticated (NIP-13 PoW)';
      countEl.appendChild(sub);
    }
  }

  if (!listEl) return;

  // Reset list
  listEl.replaceChildren();

  if (seen.size === 0) {
    const p = el('p', { style: 'color:var(--muted);font-size:.875rem' });
    p.append('No active mirrors in the last hour. ');
    p.appendChild(el('a', { href: 'mirror.html' }, 'Be the first.'));
    listEl.appendChild(p);
    return;
  }

  // Heartbeat content is attacker-controlled (anyone can publish a Nostr event
  // with the cjp-mirrors tag). Treat every field as untrusted and build the DOM
  // via textContent / strict whitelists — never innerHTML.
  for (const [peer, ev] of seen) {
    let data;
    try { data = JSON.parse(ev.content); } catch { continue; }
    if (!data || typeof data !== 'object') continue;

    const authenticated = committedPoWBits(ev) >= MIRROR_MIN_POW;
    const div = el('div', { class: 'stat-box' });

    const peerCode = el('code', null, peer.slice(0, 16) + '…');
    if (authenticated) {
      const badge = el('span', { title: 'NIP-13 proof-of-work verified ≥ ' + MIRROR_MIN_POW + ' bits',
        style: 'margin-left:.4rem;color:#4caf50;font-size:.75em' }, '✓');
      peerCode.appendChild(badge);
    }
    div.appendChild(peerCode);
    div.appendChild(el('br'));

    const small = el('small', { style: 'color:var(--muted)' });
    const country = (typeof data.country === 'string' && COUNTRY_PATTERN.test(data.country))
      ? data.country : 'Unknown';
    small.append(country, ' · ');

    if (typeof data.cid === 'string' && CID_PATTERN.test(data.cid)) {
      // Federation: prefer the originating mirror's own gateway when it
      // advertises a URL — that mirror has the CID pinned by definition.
      // Fall back to dweb.link if no URL is advertised.
      const advertisedURL = safeURL(data.url);
      const cidHref = advertisedURL
        ? advertisedURL.origin + '/ipfs/' + data.cid
        : 'https://dweb.link/ipfs/' + data.cid;
      small.appendChild(el('a', {
        href: cidHref,
        target: '_blank',
        rel: 'noopener noreferrer',
        style: 'color:var(--muted)',
      }, 'CID ' + data.cid.slice(0, 12) + '…'));
    } else {
      small.append('CID unknown');
    }

    const url = safeURL(data.url);
    if (url) {
      small.append(' · ');
      small.appendChild(el('a', {
        href: url.href,
        target: '_blank',
        rel: 'noopener noreferrer',
        style: 'color:var(--accent)',
      }, url.hostname));
    }

    div.appendChild(small);
    listEl.appendChild(div);
  }
}

function queryRelay(url, filter, seen) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const subId = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { ws.close(); resolve(); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify(['REQ', subId, filter]));
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data[0] === 'EOSE') { clearTimeout(timer); ws.close(); resolve(); return; }
      if (data[0] === 'EVENT') {
        const ev = data[2];
        const peer = ev.pubkey;
        if (!seen.has(peer) || seen.get(peer).created_at < ev.created_at) {
          seen.set(peer, ev);
        }
      }
    };
    ws.onerror = () => { clearTimeout(timer); resolve(); };
  });
}
