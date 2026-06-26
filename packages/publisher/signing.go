package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

// verifyThreshold checks that latest meets the M-of-N requirement in ts.
// Returns (validCount, error).
func verifyThreshold(ts *TrustedSigners, l *Latest) (int, error) {
	threshold := ts.Threshold
	if threshold <= 0 {
		threshold = 1
	}

	// Build a normalised set of trusted pubkey hex strings.
	trustedSet := make(map[string]bool, len(ts.Signers))
	for _, s := range ts.Signers {
		trustedSet[strings.ToLower(s)] = true
	}

	seen  := make(map[string]bool)
	valid := 0
	for _, s := range l.allSigs() {
		signerKey := strings.ToLower(s.Signer)
		if !trustedSet[signerKey] {
			continue
		}
		pk, err := hex.DecodeString(s.Signer)
		if err != nil || len(pk) != 32 {
			continue
		}
		if verifyLatest(ed25519.PublicKey(pk), l.CID, l.Version, l.Timestamp, s.Signature) && !seen[signerKey] {
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

// loadPrivateKey reads a 32-byte hex-encoded Ed25519 seed from a file.
func loadPrivateKey(path string) (ed25519.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read key file: %w", err)
	}
	seed, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(seed) != 32 {
		return nil, fmt.Errorf("key must be 32-byte hex (64 chars)")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

// loadPublicKey reads a 32-byte hex-encoded Ed25519 public key from a file.
func loadPublicKey(path string) (ed25519.PublicKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read pubkey file: %w", err)
	}
	b, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("pubkey must be 32-byte hex (64 chars)")
	}
	return ed25519.PublicKey(b), nil
}

// signingMessage builds the deterministic bytes to sign for a latest.json entry.
// Format: SHA-256( "{cid}\n{version}\n{timestamp}" )
func signingMessage(cid string, version, timestamp int64) []byte {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s\n%d\n%d", cid, version, timestamp)))
	return h[:]
}

// signLatest signs the message and returns a 64-byte hex signature.
func signLatest(sk ed25519.PrivateKey, cid string, version, timestamp int64) string {
	msg := signingMessage(cid, version, timestamp)
	sig := ed25519.Sign(sk, msg)
	return hex.EncodeToString(sig)
}

// verifyLatest checks a hex-encoded signature against a public key.
func verifyLatest(pk ed25519.PublicKey, cid string, version, timestamp int64, sigHex string) bool {
	sig, err := hex.DecodeString(sigHex)
	if err != nil || len(sig) != 64 {
		return false
	}
	return ed25519.Verify(pk, signingMessage(cid, version, timestamp), sig)
}
