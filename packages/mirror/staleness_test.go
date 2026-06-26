package main

import (
	"testing"
	"time"
)

func TestIsFreshEnough(t *testing.T) {
	maxAge := 48 * time.Hour

	t.Run("fresh timestamp accepted", func(t *testing.T) {
		l := &Latest{Timestamp: time.Now().Add(-1 * time.Hour).Unix()}
		if !isFreshEnough(l, maxAge) {
			t.Fatal("expected fresh timestamp to be accepted")
		}
	})

	t.Run("stale timestamp rejected", func(t *testing.T) {
		l := &Latest{Timestamp: time.Now().Add(-49 * time.Hour).Unix()}
		if isFreshEnough(l, maxAge) {
			t.Fatal("expected stale timestamp to be rejected")
		}
	})

	t.Run("timestamp just inside window accepted", func(t *testing.T) {
		l := &Latest{Timestamp: time.Now().Add(-48*time.Hour + time.Minute).Unix()}
		if !isFreshEnough(l, maxAge) {
			t.Fatal("timestamp inside window should be accepted")
		}
	})

	t.Run("zero timestamp skips check", func(t *testing.T) {
		l := &Latest{Timestamp: 0}
		if !isFreshEnough(l, maxAge) {
			t.Fatal("zero timestamp should skip the staleness check")
		}
	})

	t.Run("zero maxAge disables check", func(t *testing.T) {
		l := &Latest{Timestamp: time.Now().Add(-9999 * time.Hour).Unix()}
		if !isFreshEnough(l, 0) {
			t.Fatal("zero maxAge should disable the check")
		}
	})
}
