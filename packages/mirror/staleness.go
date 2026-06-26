package main

import "time"

// isFreshEnough reports whether l.Timestamp falls within maxAge of now.
// A zero timestamp or zero maxAge disables the check (returns true).
// Mirrors refuse to pin a stale latest.json to prevent replay of old content.
func isFreshEnough(l *Latest, maxAge time.Duration) bool {
	if l.Timestamp <= 0 || maxAge <= 0 {
		return true
	}
	return time.Since(time.Unix(l.Timestamp, 0)) <= maxAge
}
