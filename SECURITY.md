# Security Policy

## Scope

This policy covers:

- The static site (`packages/site/`) — HTML, CSS, JavaScript
- The publisher CLI (`packages/publisher/`) — signing and publishing tool
- The mirror daemon (`packages/mirror/`) — automated CID pinning and heartbeat
- The build pipeline (`scripts/`, `.github/workflows/`)
- The cryptographic protocols used: Ed25519 signing, age encryption, Nostr NIP-04 encrypted DMs, browser proof-of-work

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.** A public issue discloses the vulnerability before it can be fixed, potentially putting contributors, mirror operators, or people who submitted forms at risk.

Instead, send an encrypted report to the party's age public key:

```
age1emk4axrheghnuvqyasxjcaxqeap50s4rdfvrpe548a747sjvks3swav2vc
```

**How to encrypt your report with age:**

```bash
# Install age: https://github.com/FiloSottile/age
echo "Your vulnerability report here" | age -r age1emk4axrheghnuvqyasxjcaxqeap50s4rdfvrpe548a747sjvks3swav2vc > report.age
```

Send the resulting `.age` file to the maintainers via any available channel (GitHub DM, Nostr DM to the party's public key, or email to a maintainer). Include a contact method so we can follow up.

If you cannot use age, send a plain-text report marked **CONFIDENTIAL** and we will respond with a public key for follow-up encrypted communication.

## What to include in your report

- A clear description of the vulnerability and its potential impact
- Steps to reproduce, or a proof-of-concept
- The affected component(s) and version(s)
- Your suggested fix, if you have one (optional but appreciated)

## Response timeline

| Milestone | Target |
|-----------|--------|
| Acknowledgement of receipt | 48 hours |
| Initial assessment (is this a confirmed vulnerability?) | 5 business days |
| Fix developed and reviewed | 14 days for critical; 30 days for moderate |
| Public disclosure (coordinated) | After fix is deployed |

If we cannot meet a deadline, we will communicate that explicitly. We will not silently ignore reports.

## Safe harbor

We support responsible security research. If you:

- Report the vulnerability to us privately before public disclosure
- Give us reasonable time to fix it before disclosing
- Do not access, modify, or delete data belonging to others
- Do not conduct denial-of-service attacks
- Do not use the vulnerability for financial gain or to harm the project or its users

...then we will not take legal action against you, and we will publicly credit you in the fix (unless you prefer anonymity).

## Severity definitions

**Critical:** Vulnerabilities that allow decryption of submitted form data, forging of signed `latest.json` (mirror takeover), deanonymization of form submitters, or persistent cross-site scripting on the served site.

**High:** Vulnerabilities that allow an attacker to cause mirror daemons to pin malicious content, bypass the proof-of-work entirely without solving it, or inject content into the Nostr event stream that mirrors would accept.

**Moderate:** Vulnerabilities that degrade censorship resistance without directly exposing user data — for example, a single-point-of-failure introduced by a dependency.

**Low:** Issues that are unlikely to be exploited in practice but represent a deviation from security best practices.

## Out of scope

The following are **not** in scope for this security policy:

- **GitHub account security** — attacks that require compromising a maintainer's GitHub account are a GitHub security issue, not a project issue. We mitigate this risk through branch protection and requiring PRs for all changes.
- **Relay operator attacks** — Nostr relay operators can censor events but cannot forge or decrypt them. Censorship by individual relays is expected and mitigated by broadcasting to 12+ relays simultaneously.
- **IPFS gateway censorship** — public IPFS gateways (ipfs.io, cloudflare-ipfs.com) can refuse to serve content. This is mitigated by the volunteer mirror network and Tor hidden service.
- **Age key compromise** — if a party member's age private key is stolen, that is a key management incident, not a software vulnerability. Report it to the party directly.
- **Proof-of-work difficulty tuning** — the current difficulty (20 leading zero bits, ~1M hashes) is a design choice, not a vulnerability. Requests to change the difficulty are feature requests, not security reports.
- **Browser fingerprinting by relays** — the site uses standard browser APIs (WebSocket, TextEncoder). If Nostr relays fingerprint users, that is a Nostr protocol issue, not a site issue.
- **Tor exit node attacks** — if you are not using a `.onion` address, exit nodes can observe your connection. Use the Tor hidden service for maximum privacy. This is documented, not a vulnerability.
- **Bugs in dependency projects** (nostr-tools, age-encryption) — report those upstream. If the vulnerability specifically enables an attack on this project's users, report it here as well.

## Known security properties and limitations

**What this system guarantees:**

- Form submission content (name, location) is age-encrypted before leaving the browser. No relay operator, mirror operator, or network observer can read the plaintext.
- `latest.json` is Ed25519-signed. Mirror daemons verify the signature before pinning new content. A compromised relay or GitHub repository cannot push unsigned updates to mirrors.
- The proof-of-work runs entirely in the browser and has no server-side component. It cannot be bypassed by blocking a CDN.
- The site artifact is content-addressed (IPFS CID). Any modification to the content produces a different CID, which mirror daemons will reject as unsigned.

**What this system does NOT guarantee:**

- Anonymity of form submitters against a global network adversary. The encrypted Nostr event contains metadata (timestamp, public key used to encrypt). A determined adversary correlating Nostr relay logs with network traffic metadata may narrow down the submitter.
- Protection against a compromised trusted signer. If a developer's Ed25519 private key is stolen, the attacker can publish signed `latest.json` updates pointing to malicious content. Mitigate by revoking compromised keys immediately.
- Protection against malicious mirror operators. A mirror operator can serve stale content (old pinned version) or no content at all, but cannot inject modified content — content is content-addressed.

## Cryptographic choices

| Primitive | Purpose | Algorithm |
|-----------|---------|-----------|
| Publisher signing | Authenticate `latest.json` | Ed25519 |
| Form encryption | Protect sign-up submissions | age (X25519 + ChaCha20-Poly1305) |
| Form identity | Nostr event signing | secp256k1 (NIP-01) |
| Direct message encryption | Sign-up DMs | NIP-04 (secp256k1 ECDH + AES-256-CBC) |
| Proof-of-work | Anti-spam | SHA-256 partial preimage (20-bit difficulty) |
| Content addressing | Mirror trust | IPFS CID v1 (SHA2-256 / dag-pb) |

If you believe any of these choices are inadequate for the threat model, please open a security report or a public GitHub discussion.

## Dependency pinning

`nostr-tools` and `age-encryption` are bundled locally as `packages/site/js/nostr-tools.bundle.js` and `packages/site/js/age-encryption.bundle.js` — they are **no longer loaded from any CDN at runtime**. Both bundles are content-addressed in the IPFS integrity manifest and verified by the browser badge.

First-party scripts (`verify.js`) and the stylesheet (`style.css`) carry `integrity="sha256-…"` SRI attributes injected by `build.js` at build time, so the browser refuses to execute a tampered file before the badge ever runs.

**Remaining CDN dependency:** the FriendlyCaptcha anti-spam widget on translated (hi/ta/te/bn) sign-up forms is still loaded from `cdn.jsdelivr.net` (tracked as issue #15). This risk is limited to non-English form submission pages. The English form uses a client-side proof-of-work implementation with no CDN dependency. Fixing the translated forms is in progress.
