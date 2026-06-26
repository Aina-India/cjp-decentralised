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
// contract shared with packages/mirror and packages/site/test. The embedded
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

// TestVerifyThresholdVectors runs the real verifyThreshold against the shared
// cross-language vector file. Go and JS must agree on every accept/reject.
func TestVerifyThresholdVectors(t *testing.T) {
	for _, v := range loadVectors(t) {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			ts := &TrustedSigners{Threshold: v.Threshold, Signers: v.TrustedSigners}
			l := v.Latest

			count, err := verifyThreshold(ts, &l)
			if gotValid := err == nil; gotValid != v.ExpectedValid {
				t.Errorf("expectedValid=%v, got=%v (count=%d, err=%v)", v.ExpectedValid, gotValid, count, err)
			}
			if count != v.ExpectedValidCount {
				t.Errorf("expectedValidCount=%d, got=%d", v.ExpectedValidCount, count)
			}
		})
	}
}

// TestSignVerifyRoundTrip exercises the publisher's own signLatest/verifyLatest
// pair and confirms verifyThreshold accepts the produced signature.
func TestSignVerifyRoundTrip(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	pub := priv.Public().(ed25519.PublicKey)
	pubHex := hex.EncodeToString(pub)
	cid, ver, tsmp := "bafyroundtrip", int64(7), int64(123456)

	sigHex := signLatest(priv, cid, ver, tsmp)
	if !verifyLatest(pub, cid, ver, tsmp, sigHex) {
		t.Fatal("verifyLatest rejected a signature produced by signLatest")
	}

	l := &Latest{CID: cid, Version: ver, Timestamp: tsmp, Signatures: []Sig{{Signer: pubHex, Signature: sigHex}}}
	ts := &TrustedSigners{Threshold: 1, Signers: []string{pubHex}}
	count, err := verifyThreshold(ts, l)
	if err != nil || count != 1 {
		t.Fatalf("round trip: count=%d err=%v (want count=1, err=nil)", count, err)
	}
}

// TestVerifyLatestTamperResistance confirms a single flipped byte breaks verify.
func TestVerifyLatestTamperResistance(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	pub := priv.Public().(ed25519.PublicKey)
	cid, ver, tsmp := "bafytamper", int64(3), int64(999)
	sig := []byte(signLatest(priv, cid, ver, tsmp))
	// Flip the final hex char to a guaranteed-different one.
	if sig[len(sig)-1] == 'f' {
		sig[len(sig)-1] = '0'
	} else {
		sig[len(sig)-1] = 'f'
	}
	if verifyLatest(pub, cid, ver, tsmp, string(sig)) {
		t.Fatal("verifyLatest accepted a tampered signature")
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
	both := &Latest{Signer: "aa", Signature: "bb", Signatures: []Sig{{Signer: "cc", Signature: "dd"}}}
	if got := both.allSigs(); len(got) != 1 || got[0].Signer != "cc" {
		t.Errorf("precedence: got %+v", got)
	}
	if got := (&Latest{}).allSigs(); got != nil {
		t.Errorf("empty: got %+v, want nil", got)
	}
}
