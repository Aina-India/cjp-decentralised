package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type TrustedSigners struct {
	Threshold int      `json:"threshold"`
	Signers   []string `json:"signers"`
}

// loadSignersConfig reads trusted-signers.json and returns both the raw config
// (for threshold) and the decoded public keys (for fast verification).
func loadSignersConfig(path string) (*TrustedSigners, []ed25519.PublicKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("read signers file: %w", err)
	}
	var ts TrustedSigners
	if err := json.Unmarshal(raw, &ts); err != nil {
		return nil, nil, fmt.Errorf("parse signers file: %w", err)
	}
	if ts.Threshold <= 0 {
		ts.Threshold = 1
	}
	keys := make([]ed25519.PublicKey, 0, len(ts.Signers))
	for _, h := range ts.Signers {
		b, err := hex.DecodeString(h)
		if err != nil || len(b) != 32 {
			return nil, nil, fmt.Errorf("invalid pubkey in trusted-signers.json: %q", h)
		}
		keys = append(keys, ed25519.PublicKey(b))
	}
	return &ts, keys, nil
}

func signingMessage(cid string, version, timestamp int64) []byte {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s\n%d\n%d", cid, version, timestamp)))
	return h[:]
}

// verifyThreshold checks that latest has at least ts.Threshold valid signatures
// from keys listed in trusted-signers.json.  Returns (validCount, error).
func verifyThreshold(ts *TrustedSigners, trustedKeys []ed25519.PublicKey, l *Latest) (int, error) {
	threshold := ts.Threshold
	if threshold <= 0 {
		threshold = 1
	}

	// Build pubkey-hex → decoded-key map for O(1) lookup.
	keyMap := make(map[string]ed25519.PublicKey, len(ts.Signers))
	for i, h := range ts.Signers {
		if i < len(trustedKeys) {
			keyMap[strings.ToLower(h)] = trustedKeys[i]
		}
	}

	msg   := signingMessage(l.CID, l.Version, l.Timestamp)
	seen  := make(map[string]bool)
	valid := 0
	for _, s := range l.allSigs() {
		pk, ok := keyMap[strings.ToLower(s.Signer)]
		if !ok {
			continue
		}
		sigBytes, err := hex.DecodeString(s.Signature)
		if err != nil || len(sigBytes) != 64 {
			continue
		}
		signerKey := strings.ToLower(s.Signer)
		if ed25519.Verify(pk, msg, sigBytes) && !seen[signerKey] {
			seen[signerKey] = true
			valid++
		}
	}

	if valid < threshold {
		return valid, fmt.Errorf("threshold not met: %d/%d trusted signatures (need %d)",
			valid, len(ts.Signers), threshold)
	}
	return valid, nil
}
