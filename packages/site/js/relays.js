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
// Add one age1... key per line for each trusted party member.
// Any single key holder can independently decrypt submissions.
// Generate a key pair with: age-keygen
// Add only the public key here (from stdout of age-keygen).
export const PARTY_AGE_KEYS = [
  'age1emk4axrheghnuvqyasxjcaxqeap50s4rdfvrpe548a747sjvks3swav2vc',
];

// Tag used for public demand/petition events
export const DEMAND_TAG = 'cjp-demand';

// Tag used for mirror heartbeat events
export const MIRROR_TAG = 'cjp-mirrors';

// Tag used for update notifications
export const UPDATE_TAG = 'cjp-update';

