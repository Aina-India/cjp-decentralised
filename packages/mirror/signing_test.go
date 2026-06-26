package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// vector mirrors one entry of testdata/latest.vectors.json — the cross-language
// contract shared with packages/publisher and packages/site/test. The embedded
// Latest unmarshals the vector's "latest" object directly via its json tags.
type vector struct {
	Name               string `json:"name"`
	Description        string `json:"description"`
	Latest             Latest `json:"latest"`
	TrustedSigners     []string `json:"trustedSigners"`
	Threshold          int    `json:"threshold"`
	ExpectedValid      bool   `json:"expectedValid"`
	ExpectedValidCount int    `json:"expectedValidCount"`
}

type vectorFile struct {
	Vectors []vector `json:"vectors"`
}

func loadVectors(t *testing.T) []vector {
	t.Helper()
	path := filepath.Join("..", "..", "testdata", "latest.vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read vector file %s: %v", path, err)
	}
	var vf vectorFile
	if err := json.Unmarshal(raw, &vf); err != nil {
		t.Fatalf("parse vector file: %v", err)
	}
	if len(vf.Vectors) == 0 {
		t.Fatal("vector file contains no vectors")
	}
	return vf.Vectors
}

func decodeKeys(t *testing.T, hexKeys []string) []ed25519.PublicKey {
	t.Helper()
	keys := make([]ed25519.PublicKey, 0, len(hexKeys))
	for _, h := range hexKeys {
		b, err := hex.DecodeString(h)
		if err != nil || len(b) != 32 {
			t.Fatalf("invalid trusted signer hex %q", h)
		}
		keys = append(keys, ed25519.PublicKey(b))
	}
	return keys
}

// TestVerifyThresholdVectors runs the real verifyThreshold against the shared
// cross-language vector file. Go and JS must agree on every accept/reject.
func TestVerifyThresholdVectors(t *testing.T) {
	for _, v := range loadVectors(t) {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			ts := &TrustedSigners{Threshold: v.Threshold, Signers: v.TrustedSigners}
			keys := decodeKeys(t, v.TrustedSigners)
			l := v.Latest

			count, err := verifyThreshold(ts, keys, &l)
			if gotValid := err == nil; gotValid != v.ExpectedValid {
				t.Errorf("expectedValid=%v, got=%v (count=%d, err=%v)", v.ExpectedValid, gotValid, count, err)
			}
			if count != v.ExpectedValidCount {
				t.Errorf("expectedValidCount=%d, got=%d", v.ExpectedValidCount, count)
			}
		})
	}
}

// TestVerifyThresholdRoundTrip signs with a fresh key and confirms the verifier
// accepts its own signature — pins the happy path independent of the vectors.
func TestVerifyThresholdRoundTrip(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	pubHex := hex.EncodeToString(pub)
	cid, ver, tsmp := "bafyroundtrip", int64(7), int64(123456)
	sigHex := hex.EncodeToString(ed25519.Sign(priv, signingMessage(cid, ver, tsmp)))

	l := &Latest{CID: cid, Version: ver, Timestamp: tsmp, Signatures: []Sig{{Signer: pubHex, Signature: sigHex}}}
	ts := &TrustedSigners{Threshold: 1, Signers: []string{pubHex}}

	count, err := verifyThreshold(ts, []ed25519.PublicKey{pub}, l)
	if err != nil || count != 1 {
		t.Fatalf("round trip: count=%d err=%v (want count=1, err=nil)", count, err)
	}
}

// TestAllSigsNormalization pins the legacy/multi-sig precedence rule that both
// packages and verify.js rely on.
func TestAllSigsNormalization(t *testing.T) {
	if got := (&Latest{Signer: "aa", Signature: "bb"}).allSigs(); len(got) != 1 || got[0].Signer != "aa" {
		t.Errorf("legacy single-sig: got %+v", got)
	}
	if got := (&Latest{Signatures: []Sig{{Signer: "cc", Signature: "dd"}}}).allSigs(); len(got) != 1 || got[0].Signer != "cc" {
		t.Errorf("multi-sig: got %+v", got)
	}
	// signatures[] takes precedence over legacy fields when both present.
	both := &Latest{Signer: "aa", Signature: "bb", Signatures: []Sig{{Signer: "cc", Signature: "dd"}}}
	if got := both.allSigs(); len(got) != 1 || got[0].Signer != "cc" {
		t.Errorf("precedence: got %+v", got)
	}
	if got := (&Latest{}).allSigs(); got != nil {
		t.Errorf("empty: got %+v, want nil", got)
	}
}
