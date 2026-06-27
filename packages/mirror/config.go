package main

import (
	"encoding/json"
	"os"
	"strconv"
	"time"
)

type Config struct {
	IPFSApi      string        // IPFS HTTP API, e.g. http://localhost:5001
	PollInterval time.Duration // How often to check for updates
	IPNSName     string        // IPNS name to resolve for latest.json (optional)
	FallbackURLs []string      // Clearweb URLs to fetch latest.json from
	SignersFile  string        // Path to trusted-signers.json
	StateFile    string        // Path to persisted daemon state
	Country      string        // Reported country in heartbeat (optional)
	MirrorURL    string        // Public URL of this mirror's clearweb endpoint (optional, e.g. https://mymirror.example.com)
	GatewayURL   string        // IPFS HTTP gateway URL, e.g. http://localhost:8080 (used to fetch content after pinning)
	ServeDir     string        // If set, populate this directory with site files after each successful pin

	// LocalRelay is the bundled relay's internal URL (e.g. ws://relay:7777).
	// Prepended to the pool so the daemon always has a guaranteed-success
	// write target — eliminates dependence on public relays for liveness.
	LocalRelay string

	// MirrorRelayURL is the bundled relay's PUBLIC URL (wss://). When set,
	// it is broadcast in heartbeat events so browsers can discover it and
	// merge it into their query pool — federation grows with volunteer count.
	MirrorRelayURL string

	// PropagationFile is the explicit path to write propagation.json (DHT
	// provider snapshot). If empty, defaults to ServeDir/propagation.json
	// when ServeDir is set. Set this explicitly when the mirror doesn't
	// auto-populate a serve dir (e.g. when nginx serves a directly-mounted
	// dist/ instead of the auto-updated one).
	PropagationFile string

	// PeersFile is the explicit path to write peers.json (this mirror's
	// view of every other mirror it has ever observed via heartbeats).
	// Same default fallback rule as PropagationFile.
	PeersFile string

	// MaxAge is the maximum age of latest.json's timestamp before the daemon
	// refuses to pin it. Prevents indefinite replay of a validly-signed but
	// outdated manifest. Set to 0 to disable. Default: 48h.
	MaxAge time.Duration

	// HeartbeatPoWDifficulty is the minimum NIP-13 leading zero bits to mine
	// into each heartbeat Nostr event before publishing. 0 = disabled.
	// The browser counts only mirrors whose heartbeat meets MIRROR_MIN_POW
	// as "authenticated", making Sybil inflation computationally expensive.
	HeartbeatPoWDifficulty int
}

func defaultConfig() Config {
	home, _ := os.UserHomeDir()
	return Config{
		IPFSApi:      envOr("IPFS_API", "http://localhost:5001"),
		PollInterval: parseDuration(envOr("POLL_INTERVAL", "900"), 15*60),
		IPNSName:     envOr("IPNS_NAME", ""),
		FallbackURLs: fallbackURLs(),
		SignersFile: envOr("SIGNERS_FILE", "trusted-signers.json"),
		StateFile:   envOr("STATE_FILE", home+"/.cjp/mirror-state.json"),
		Country:   envOr("COUNTRY", ""),
		MirrorURL: envOr("MIRROR_URL", ""),
		GatewayURL:     envOr("IPFS_GATEWAY", ""),
		ServeDir:       envOr("SERVE_DIR", ""),
		LocalRelay:      envOr("LOCAL_RELAY", ""),
		MirrorRelayURL:  envOr("MIRROR_RELAY_URL", ""),
		PropagationFile: envOr("PROPAGATION_FILE", ""),
		PeersFile:       envOr("PEERS_FILE", ""),
		MaxAge:                 parseDuration(envOr("MAX_AGE", "48h"), 48*3600),
		HeartbeatPoWDifficulty: parseInt(envOr("HEARTBEAT_POW_DIFFICULTY", "0")),
	}
}

// fallbackURLs returns the list of latest.json sources.
// Override with FALLBACK_URL env var (single URL) for custom deployments.
func fallbackURLs() []string {
	if u := os.Getenv("FALLBACK_URL"); u != "" {
		return []string{u}
	}
	return []string{
		"https://raw.githubusercontent.com/grussdorian/cjp-decentralised/main/latest.json",
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func parseInt(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// parseDuration accepts either Go duration form ("15m", "30s") or a bare
// integer treated as seconds ("900" → 900s). Falls back to defaultSec if both
// fail. The bare-integer path matters because docker-compose env vars are
// often written as plain numbers.
func parseDuration(s string, defaultSec int) time.Duration {
	if d, err := time.ParseDuration(s); err == nil {
		return d
	}
	if n, err := strconv.Atoi(s); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return time.Duration(defaultSec) * time.Second
}

// State persists across restarts.
type State struct {
	NostrSK      string `json:"nostr_sk"`
	PinnedCID    string `json:"pinned_cid"`
	PinnedVer    int64  `json:"pinned_version"`
}

func loadState(path string) (*State, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return &State{}, nil
	}
	var s State
	if err := json.Unmarshal(raw, &s); err != nil {
		return &State{}, nil
	}
	return &s, nil
}

func saveState(path string, s *State) error {
	b, _ := json.MarshalIndent(s, "", "  ")
	if err := os.MkdirAll(dirOf(path), 0700); err != nil {
		return err
	}
	return os.WriteFile(path, b, 0600)
}

func dirOf(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			return p[:i]
		}
	}
	return "."
}
