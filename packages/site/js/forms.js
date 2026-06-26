// Nostr form submission handler.
// Sign-up submissions are age-encrypted to all keys listed in PARTY_AGE_KEYS.
// Any single key holder can independently decrypt — no coordination needed.
// TODO: Replace CDN imports with local bundles.
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} from './nostr-tools.bundle.js';

import { Encrypter } from './age-encryption.bundle.js';

import { RELAYS, PARTY_AGE_KEYS, DEMAND_TAG } from './relays.js';

// NIP-13 proof-of-work difficulty (leading zero bits in the event id).
const POW_DIFFICULTY = 20;

// Mine a NIP-13 compliant event: keep incrementing the nonce tag until the
// event id (SHA-256 of the canonical serialization) has POW_DIFFICULTY leading
// zero bits. Returns a Promise that resolves with the mined tags array.
function mineEventPoW(template) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pow-worker.js', import.meta.url));
    worker.onmessage = (e) => {
      if (e.data.solved) { worker.terminate(); resolve(e.data.tags); }
    };
    worker.onerror = (err) => { worker.terminate(); reject(err); };
    worker.postMessage({ eventTemplate: template, difficulty: POW_DIFFICULTY });
  });
}

async function broadcast(event) {
  const results = await Promise.allSettled(
    RELAYS.map(url => publishToRelay(url, event))
  );
  const ok = results.filter(r => r.status === 'fulfilled').length;
  return { ok, total: RELAYS.length };
}

function publishToRelay(url, event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 6000);
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
    ws.onmessage = (msg) => {
      clearTimeout(timer);
      ws.close();
      const data = JSON.parse(msg.data);
      if (data[0] === 'OK' && data[2] === true) resolve();
      else reject(new Error(data[3] || 'relay rejected'));
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
  });
}

function setStatus(form, type, text) {
  let el = form.querySelector('.status');
  if (!el) return;
  el.className = 'status ' + type;
  el.textContent = text;
}

// ── Join form (age-encrypted to all party member keys, posted as Nostr event) ──
// PARTY_AGE_KEYS is a list of age1... public keys from party-keys.txt.
// Any single key holder can independently decrypt the submission.
export async function handleJoin(form) {
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  const origLabel = btn.textContent;

  const name = form.elements.name.value.trim();
  const location = form.elements.location.value.trim();

  if (!name || !location) {
    setStatus(form, 'err', 'Please fill in all fields.');
    btn.disabled = false;
    return;
  }
  const activeKeys = PARTY_AGE_KEYS.filter(k => !k.startsWith('#') && k.trim());
  if (activeKeys.length === 0) {
    setStatus(form, 'err', 'Party keys not configured yet. Try again soon.');
    btn.disabled = false;
    return;
  }

  try {
    // age-encrypt the payload to ALL party member keys simultaneously.
    const plaintext = new TextEncoder().encode(JSON.stringify({ name, location, ts: Date.now() }));
    const enc = new Encrypter();
    for (const key of activeKeys) await enc.addRecipient(key);
    const ciphertext = await enc.encrypt(plaintext);
    const content = btoa(String.fromCharCode(...ciphertext));

    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const created_at = Math.floor(Date.now() / 1000);

    btn.textContent = 'Mining proof of work…';
    const minedTags = await mineEventPoW({
      pubkey: pk, kind: 1337, created_at,
      tags: [['t', 'cjp-signup']], content,
    });

    btn.textContent = 'Submitting…';
    const event = finalizeEvent({ kind: 1337, created_at, tags: minedTags, content }, sk);

    const { ok, total } = await broadcast(event);
    if (ok > 0) {
      setStatus(form, 'ok', `Submitted to ${ok}/${total} relays. Welcome to the Cockroach Army!`);
      form.reset();
    } else {
      setStatus(form, 'err', 'Could not reach any relays. Check your connection and try again.');
    }
  } catch (e) {
    setStatus(form, 'err', 'Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
}

// ── Demand form (public NIP-01 event, tagged #cjp-demand) ──
export async function handleDemand(form) {
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  const origLabel = btn.textContent;

  const name = form.elements.name.value.trim();
  const city = form.elements.city.value.trim();
  const country = form.elements.country.value.trim();

  if (!name || !city || !country) {
    setStatus(form, 'err', 'Please fill in all fields.');
    btn.disabled = false;
    return;
  }

  try {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const created_at = Math.floor(Date.now() / 1000);
    const content = JSON.stringify({ name, city, country });

    btn.textContent = 'Mining proof of work…';
    const minedTags = await mineEventPoW({
      pubkey: pk, kind: 1, created_at,
      tags: [['t', DEMAND_TAG]], content,
    });

    btn.textContent = 'Submitting…';
    const event = finalizeEvent({ kind: 1, created_at, tags: minedTags, content }, sk);

    const { ok, total } = await broadcast(event);
    if (ok > 0) {
      setStatus(form, 'ok', `Signature recorded on ${ok}/${total} relays. Your voice is heard.`);
      form.reset();
    } else {
      setStatus(form, 'err', 'Could not reach any relays. Check your connection and try again.');
    }
  } catch (e) {
    setStatus(form, 'err', 'Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
}
