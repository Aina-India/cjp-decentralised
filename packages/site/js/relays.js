// Public Nostr relays. Spread across jurisdictions for censorship resistance.
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.wine',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr.fmt.wiz.biz',
  'wss://relay.nostr.info',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.current.fyi',
  'wss://nostr.oxtr.dev',
  'wss://nostr.bitcoiner.social',
];

// Party member age public keys for sign-up encryption.
// DO NOT EDIT this array directly — build.js overwrites dist/js/relays.js
// with keys read from party-keys.txt (the canonical single source of truth).
// To add or revoke a key: edit party-keys.txt and rebuild.
export const PARTY_AGE_KEYS = [
  'age1emk4axrheghnuvqyasxjcaxqeap50s4rdfvrpe548a747sjvks3swav2vc',
];

// Tag used for public demand/petition events
export const DEMAND_TAG = 'cjp-demand';

// Tag used for mirror heartbeat events
export const MIRROR_TAG = 'cjp-mirrors';

// Tag used for update notifications
export const UPDATE_TAG = 'cjp-update';

