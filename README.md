# CJP Decentralized

[![Build](https://github.com/grussdorian/cjp-decentralised/actions/workflows/publish.yml/badge.svg)](https://github.com/grussdorian/cjp-decentralised/actions/workflows/publish.yml)

Censorship-resistant web presence for the Cockroach Janata Party. No single point of failure across hosting, naming, form backends, or identity.

## Manifesto

This project is **defensive infrastructure for ideas**. It is not a substitute for democracy, it is not a franchise, and it is not a tool of participation for people who can't operate a web browser. It is worth being honest about what it does and what it does not do, because pretending otherwise weakens the work.

**What it defends.** The continued existence of the manifesto's text, the cryptographic identity of the party's signing authority, and a permanent record of who endorsed the project at what time. If every clearweb domain is seized and every Nostr relay we use disappears, the signed content and the signed attestations of participation remain — replicated across every volunteer machine that ever ran the stack and every public relay that ever accepted the events. They can be republished from any one of those copies, and the signatures still verify.

**What it does not do.** It does not enfranchise the un-connected. A peasant in Bihar with no smartphone is not given a voice by IPFS. They are given a voice by literacy, by actual elections, by water and sanitation and electricity. Decentralization tech does not fix material inequality; it sometimes hides inequality behind a veneer of digital sophistication while the people the message is *about* never see it.

**Who builds vs. who reads.** Resistance tech has always been built by the digitally capable and read by everyone else. The Reformation's printing press was operated by a tiny clergy-educated class; the texts reached peasants who couldn't print but could listen. Samizdat in Soviet Russia was maybe a few thousand typists with an audience of millions. The CJP stack works the same way: a small number of urban operators run mirrors so the content reaches anyone with a cheap browser. **The democratic act is not running the daemon, it's reading the manifesto.** Operators bear the cost so consumers can benefit.

**What this is not.** It is not a digital vote in the franchise sense. A vote is universally accessible, equally weighted, secret, and binding on an outcome. Our attestation network is none of those things — it is a chain of signed witness statements ("I saw this manifesto on this date and I endorse these other witnesses"), permanent and federated, but voluntary, pubkey-identifiable, and politically non-binding. It is closer to a notarized petition than to a ballot.

**Honest scope.** This stack defends against catastrophic censorship of *digital* speech. It does not defend against poverty, illiteracy, state violence, or unequal access. Those require organizing, mutual aid, and political work that no amount of Go code can replace. Volunteers who pour energy into Docker should remember that the marginal hour spent here is an hour not spent on material organizing — and decide accordingly.

The project's honesty about its own scope is part of what makes it credible.

## Live mirrors

| Domain | Operator | Status |
|--------|----------|--------|
| [cjp.fheya.de](https://cjp.fheya.de) | official | clearweb |
| [todo.fheya.com](https://todo.fheya.com) | official | clearweb |

More mirrors are listed live at [cjp.fheya.de/mirror.html](https://cjp.fheya.de/mirror.html) — updated every 2 minutes from the Nostr mirror registry.

**Coming soon:** Tor `.onion` hidden service and ENS/Ethereum on-chain trust anchor (see [Trust model](#trust-model) below).

## Verify any mirror

Every mirror shows a badge at the bottom of each page. To verify independently:

1. Open [`latest.json`](latest.json) in this repo. Note the `version` number and `cid`.
2. Open any mirror — the badge must show the **same version number** and **same IPFS CID** (`bafybeigzm47a4hrwfxusmrwrj3dgsq4j6xgcbntvnobkarlsmzgjr4hnmm`).
3. The key fingerprint in the badge (`c1688ff0…b5c3`) must match [trusted-signers.json](trusted-signers.json).

If a mirror shows a different CID, a different version, or a different fingerprint — it is not serving authentic content.

You can also fetch the content directly from IPFS:
```
https://dweb.link/ipfs/bafybeigzm47a4hrwfxusmrwrj3dgsq4j6xgcbntvnobkarlsmzgjr4hnmm
```

## Run a volunteer mirror

Everything you need is bundled. The stack builds itself, provisions a free TLS cert, and federates with the network.

### Preconditions

For a **public mirror**:
- A VPS with a public IPv4/IPv6 address
- Ports `80` and `443` open in the firewall (Caddy needs `:80` for the Let's Encrypt HTTP-01 challenge, `:443` for the served HTTPS)
- A DNS `A` or `AAAA` record for your hostname pointing at the VPS **before** the first `docker compose up` — otherwise Caddy's first cert request fails and Let's Encrypt will rate-limit you for ~1 hour
- Docker + Docker Compose installed

For a **local test stack** (no public exposure):
- Just Docker. None of the above network setup is needed; the stack still federates via public Nostr relays.

### Setup

```bash
git clone https://github.com/grussdorian/cjp-decentralised
cd cjp-decentralised
cp .env.example .env       # edit MIRROR_HOST, ACME_EMAIL, MIRROR_RELAY_URL, COUNTRY
docker compose up -d
```

That's the whole setup. The stack brings up:

| Service | Role |
|---------|------|
| **caddy** | Auto-HTTPS via Let's Encrypt — provisions a cert for `MIRROR_HOST` on first run |
| **nginx** | Serves the static site + reverse-proxies `/ipfs/*` and `/relay` |
| **ipfs** (kubo) | Pins the latest signed CID; serves the self-hosted IPFS gateway |
| **relay** (strfry) | Bundled Nostr relay; daemon writes heartbeats here first |
| **mirror** | Builds from source; polls `latest.json`, verifies signatures, pins, broadcasts |
| **tor** | Optional `.onion` hidden service |

### What happens with no env vars set

If you clone and `docker compose up -d` without editing `.env`, everything still works locally — and you still participate in the federation's trust graph.

- HTTP-only on `:80` (Caddy doesn't try to provision a cert)
- IPFS pinning + Nostr heartbeats + DHT propagation all happen
- Federation via the public Nostr relays the daemon ships with
- Your relay isn't advertised, your gateway isn't reachable via a public hostname

### Participation without a VPS or domain

This is not test-mode. Anyone with `docker` on a laptop, an old desktop, or a Raspberry Pi can be a full participant in the attestation network — without owning a VPS, a domain, or a public IP.

What a no-public-infra volunteer contributes:

| Signal | Visible to the network? |
|---|---|
| Broadcasts heartbeats with their Nostr pubkey every ~60s | Yes — appears in mirror count and others' attestation peers list |
| Publishes their own attestation every 6h | Yes — kind:30078 event federated across public Nostr relays |
| Lists peers they've observed | Yes — those peers gain an endorser |
| References other mirrors' attestation event IDs in `seen_attestations` | Yes — chain endorsements that make back-dating cryptographically expensive |

In the [attestation graph](https://cjp.fheya.de/trust.html#attestation-network), they appear as a node, contribute trust score to peers they've endorsed, receive trust score from peers that endorsed them. They don't need to be reachable from the open internet — only that they can reach a few public Nostr relays for the heartbeat and attestation broadcasts.

VPS + domain only adds *serving* capability — clickable mirror in the list, public IPFS gateway, federation relay endpoint. None of that affects the trust graph itself. **Trust evidence accumulates from anyone willing to leave Docker running.**

### Practical example: a participation record you can't delete

50 volunteers run the stack overnight from their personal machines. 5 of them have a VPS and domain, so they show up as clickable mirrors. The other 45 don't expose anything publicly.

All 50 broadcast heartbeats. All 50 publish daily attestations. Each one references the others' attestation event IDs. After ~24 hours, the attestation graph has 50 nodes, the average peer is endorsed by 49 others, and the cross-attestation graph is dense.

**That graph is the record.** Even if every one of those volunteers shuts their machine down the next morning, their signed attestation events persist on Nostr relays around the world. The signed snapshots are permanent witness statements: "On date X, these 50 pubkeys constituted the network, and here are the signatures from each one attesting to the others' presence."

A state actor who later wants to stand up an impostor mirror has to defeat all 50 dated, cross-referenced signatures. They can't — those events are content-addressed and replicated. The participation already happened. It can't be retracted, edited, or deleted.

This is not a vote. It is a notarized record of dissent, signed by everyone who chose to put their pubkey to it, replicated in a way that makes silencing the record harder than producing it in the first place.

### Proof of participation

Every daemon emits two parallel attestation events:

| Event | Purpose |
|-------|---------|
| `kind:30078, d="v1"` (replaceable) | Always the latest snapshot — efficient "current state" query |
| `kind:30078, d="YYYY-MM-DD"` (one per day) | Permanent daily archive — proof that this pubkey was attested on this date |

The daily archive is the participation log. A volunteer who runs the stack for one night and earns endorsements from established mirrors is on the record permanently — the trust page's "Lifetime participants" counter shows them even after their machine is offline.

Anyone can independently verify: query Nostr for kind:30078 cjp-attestation events with d=YYYY-MM-DD, filter by participating pubkey, count attesting mirrors, check signatures. No central authority, no API, no permission needed.

### What happens with the full env set

| `.env` variable | Effect |
|----------------|--------|
| `MIRROR_HOST=cjp.example.com` | Caddy gets a real cert; kubo configures path-mode gateway for the hostname |
| `ACME_EMAIL=ops@example.com` | Let's Encrypt sends cert-expiry warnings here (optional) |
| `MIRROR_RELAY_URL=wss://cjp.example.com/relay` | Daemon advertises this in heartbeats; visiting browsers add it to their relay query pool |
| `COUNTRY=IN` | Shown next to your mirror in the live list (purely informational) |

Your domain appears automatically in the [live mirror list](https://cjp.fheya.de/mirror.html) within ~2 minutes of the daemon broadcasting its first heartbeat. No PR, no manual registration.

## Repository layout

```
packages/site/        Static HTML/CSS/JS frontend (5 languages)
packages/mirror/      Go daemon — volunteers run this to pin and serve the site
packages/publisher/   Go CLI — sign and publish CID updates (run locally, key never leaves machine)
content/manifesto/    Manifesto source (English Markdown)
content/translations/ i18n JSON for en, hi, ta, te, bn
scripts/build.js      Renders templates × languages → dist/
trusted-signers.json  Ed25519 pubkeys of authorized publishers
latest.json           Signed pointer to current IPFS CID
docker-compose.yml    One-command volunteer mirror stack
```

## Publish an update (developers)

1. Push to `main` — CI builds the site and **computes the CID** (using `ipfs add --only-hash`, no upload). The CID appears in the job summary.
2. Locally: sign the CID with your key and publish `latest.json`:
   ```bash
   publisher sign --key ~/.cjp/signing.key --cid <cid-from-ci> --version <n> --note "your note"
   publisher publish --latest latest.json
   git add latest.json README.md && git commit -m "chore: publish v<n>"
   git push
   ```
3. Pin the CID so it is reachable on IPFS (CI does **not** do this):
   ```bash
   ipfs pin add <cid-from-ci>                 # on your own kubo node, or
   # curl -X POST "https://api.pinata.cloud/pinning/pinByHash" ...  # Pinata
   ```
   Every volunteer mirror will also auto-pin it within `POLL_INTERVAL` seconds once `latest.json` is updated.

> When publishing, update the IPFS CID in the [Verify any mirror](#verify-any-mirror) section of this README so readers always have the current address.

## Trust model

Content authenticity rests on a chain of verifiable anchors:

```
Ed25519 signatures (M-of-N keys)
  └─ sign IPFS CID  →  content-addressed directory
        └─ contains integrity.json  →  SHA-256 of every page
              └─ verify.js compares against the page served by each mirror
```

**Current state:** 1-of-1 signing key. As more trusted party members join, the threshold will increase — a single compromised key will not be sufficient to publish a fraudulent update.

**In progress:**
- **Tor `.onion`** — hidden service so the site remains reachable if all clearweb domains are seized.
- **ENS / Ethereum** — on-chain content hash (`cockroachjanataparty.eth` via Gnosis Safe multisig). Once live, users can resolve the canonical CID without trusting GitHub, this repo, or any DNS provider. This is the highest-trust anchor in the system.

## Become a signer

Signing authority is intentionally restricted. Contact the repository owner directly — do not open a public issue. Signers are vetted individually; the M-of-N threshold and vetting process will become stricter as the mirror network grows.

## Access

| Method | Address |
|--------|---------|
| Clearweb mirrors | listed at [/mirror](https://cjp.fheya.de/mirror.html) on the site |
| IPFS gateway | [`dweb.link/ipfs/bafybeigzm47a4hrwfxusmrwrj3dgsq4j6xgcbntvnobkarlsmzgjr4hnmm`](https://dweb.link/ipfs/bafybeigzm47a4hrwfxusmrwrj3dgsq4j6xgcbntvnobkarlsmzgjr4hnmm) |
| IPNS | pending |
| ENS | `cockroachjanataparty.eth` — pending on-chain registration |
| Tor | pending hidden service setup |

## Peer attestation network

Every mirror keeps a record of every other mirror it has observed broadcasting heartbeats over the last 30 days, and publishes that record as a signed [NIP-33](https://github.com/nostr-protocol/nips/blob/master/33.md) parameterized replaceable Nostr event (`kind:30078`, tag `#cjp-attestation`).

Two artefacts:
- **`/peers.json`** — this mirror's view, served as a static file. Anyone with `curl` can read it.
- **Signed Nostr event** — same data, signed by the mirror's Nostr key, replicated across the federation.

**Why this exists.** If a fake mirror with a forged badge surfaces, the honest network points at its collective attestation graph: the fake's pubkey appears in **zero** attestations from established mirrors. The longer a real mirror has been attested by other mirrors, the more credible it is — Sybil clusters that only attest to each other are visually obvious in the cross-attestation graph.

**Privacy.** Unencrypted by design. Mirror pubkeys, URLs, and country codes are already public in heartbeats. The whole defence works *because* anyone can verify "this fake was never one of us" — encryption would defeat that.

The live attestation table is rendered at the bottom of [trust.html](https://cjp.fheya.de/trust.html#attestation-network), built in-browser from Nostr events. Peers with **attesters ≥ 2** have been independently observed by multiple mirrors and are credible. Peers with **attesters = 1** are either new or only self-observed — verify out-of-band before trusting.

## Federated IPFS gateway (bundled)

Every mirror bundles a [kubo](https://github.com/ipfs/kubo) IPFS node with the current CID always pinned. The bundled `nginx.conf` reverse-proxies `/ipfs/<CID>` and `/ipns/<name>` straight to it. CID links on every page resolve same-origin: no DHT lookup, no third-party gateway flakiness, sub-100ms first-byte every time.

**To enable on your mirror:** set `MIRROR_HOST` in `.env` or `docker-compose.override.yml` to the hostname your reverse proxy serves on. The kubo init script configures the gateway to use path-mode (instead of the default subdomain mode, which would otherwise redirect `/ipfs/<CID>` to `<CID>.ipfs.<host>`).

```yaml
# docker-compose.override.yml
services:
  ipfs:
    environment:
      MIRROR_HOST: "cjp.mirror.example.com"
```

The mirror list on `/mirror.html` automatically links each mirror's advertised CID to that mirror's own gateway — federation works for cross-mirror browsing too.

## Federated relay (bundled)

Every mirror runs its own [strfry](https://github.com/hoytech/strfry) Nostr relay alongside IPFS. The mirror daemon writes heartbeats to its local relay first (guaranteed success), then to a small set of public relays for federation. Set `MIRROR_RELAY_URL` to your public WSS URL to advertise your relay to other mirrors — visiting browsers automatically discover it from your heartbeats and merge it into their query pool.

**Why it matters:**
- **No central point of failure.** As more volunteers join, the relay set grows automatically.
- **Daemon liveness doesn't depend on any public relay.** Local writes always succeed.
- **Resilient to relay policy changes.** When public relays add PoW requirements, disappear, or rate-limit, the federated set keeps working.

**Default config:** the relay is bundled but not exposed publicly. Volunteers opt-in to federation by setting `MIRROR_RELAY_URL` in `docker-compose.override.yml`:

```yaml
services:
  mirror:
    environment:
      MIRROR_RELAY_URL: "wss://mirror.example.com/relay"
```

The bundled `nginx.conf` reverse-proxies `/relay` to the strfry container with proper WebSocket upgrade headers, so no extra config is needed.

## Form data persistence

Sign-up and petition submissions are stored on Nostr relays — a separate network from IPFS. This means:

- **Version changes do not affect submissions.** Publishing a new site version updates the IPFS CID and `latest.json`, but relay data is never touched. A submission made on v1 is still retrievable on v50.
- **No central server holds the data.** Submissions are broadcast to 12 independent relays across jurisdictions simultaneously. No single relay going down loses any data.
- **Sign-ups are end-to-end encrypted.** Each submission is age-encrypted to the party's public key before it leaves the browser. Only the key holder can read it — relays store opaque ciphertext.
- **Petitions are public and verifiable.** Demand form entries are signed Nostr events anyone can count on any relay — no need to trust the party's tally.

**Long-term retention note:** Public relays may expire events after 30–90 days to manage storage. Running a private relay ensures permanent retention. See issue [#7](https://github.com/grussdorian/cjp-decentralised/issues) for context.

## Tech stack

- **Hosting**: IPFS (content-addressed, anyone can pin)
- **Mutability**: IPNS + ENS content hash (Gnosis Safe multisig)
- **Form backend**: Nostr protocol (sign-up age-encrypted to party key; petition public events)
- **Spam protection**: Browser-only SHA-256 proof-of-work (no server, no CDN, works on Tor)
- **Mirror sync**: Ed25519-signed `latest.json` polled every 15 min
- **Mirror registry**: Nostr heartbeat events tagged `#cjp-mirrors`

## Contributing

If you are a developer, you may contribute to this repo — see the [open issues](https://github.com/grussdorian/cjp-decentralised/issues) for pending work. Good first areas: Tor hidden service (#7) and IPNS setup (#9).

## License

[MIT](LICENSE) — copy, modify, redistribute freely. See [CONTRIBUTING.md](CONTRIBUTING.md) for fork guidance.
