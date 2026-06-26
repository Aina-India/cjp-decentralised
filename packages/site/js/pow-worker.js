// Browser-only proof-of-work. No server, no external service, works on Tor.
// Finds nonce where SHA-256(challenge + ':' + nonce) has `difficulty` leading zero bits.
// Receives: { challenge: string, difficulty: number }
// Posts:    { progress: number } periodically, then { solved: true, challenge, nonce }

function sha256(msg) {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,
      h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const L = msg.length;
  const padded = new Uint8Array(Math.ceil((L + 9) / 64) * 64);
  padded.set(msg);
  padded[L] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, (L * 8) >>> 0, false);
  const W = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) W[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = (W[j-15]>>>7|W[j-15]<<25)^(W[j-15]>>>18|W[j-15]<<14)^(W[j-15]>>>3);
      const s1 = (W[j-2]>>>17|W[j-2]<<15)^(W[j-2]>>>19|W[j-2]<<13)^(W[j-2]>>>10);
      W[j] = (W[j-16] + s0 + W[j-7] + s1) >>> 0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,hh=h7;
    for (let j = 0; j < 64; j++) {
      const S1 = (e>>>6|e<<26)^(e>>>11|e<<21)^(e>>>25|e<<7);
      const t1 = (hh + S1 + ((e&f)^(~e&g)) + K[j] + W[j]) >>> 0;
      const S0 = (a>>>2|a<<30)^(a>>>13|a<<19)^(a>>>22|a<<10);
      const t2 = (S0 + ((a&b)^(a&c)^(b&c))) >>> 0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
    h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+hh)>>>0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v, i) => ov.setUint32(i * 4, v, false));
  return out;
}

const enc = new TextEncoder();

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

self.onmessage = function(e) {
  if (e.data.eventTemplate) {
    // NIP-13: mine the Nostr event ID until it has `difficulty` leading zero bits.
    // The nonce tag ["nonce", "<n>", "<difficulty>"] varies each attempt.
    // The solved event carries the mined tags and precomputed id for the caller.
    const { eventTemplate, difficulty } = e.data;
    const { pubkey, kind, created_at, tags, content } = eventTemplate;
    const baseTags = tags.filter(t => t[0] !== 'nonce');
    for (let nonce = 0; ; nonce++) {
      const minedTags = [...baseTags, ['nonce', String(nonce), String(difficulty)]];
      const serialized = JSON.stringify([0, pubkey, created_at, kind, minedTags, content]);
      const hash = sha256(enc.encode(serialized));
      if (leadingZeroBits(hash) >= difficulty) {
        self.postMessage({ solved: true, tags: minedTags, id: bytesToHex(hash) });
        return;
      }
      if (nonce % 10000 === 0) self.postMessage({ progress: nonce });
    }
    return;
  }

  // Legacy mode: mine SHA-256(challenge + ':' + nonce) with leading-zero check.
  const { challenge, difficulty } = e.data;
  for (let nonce = 0; ; nonce++) {
    const hash = sha256(enc.encode(challenge + ':' + nonce));
    const view = new DataView(hash.buffer);
    if ((view.getUint32(0) >>> (32 - difficulty)) === 0) {
      self.postMessage({ solved: true, challenge, nonce });
      return;
    }
    if (nonce % 10000 === 0) self.postMessage({ progress: nonce });
  }
};
