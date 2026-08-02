package main

import (
	"strings"
	"testing"
)

// The default MUST stay loopback.
//
// It used to be ":"+port, i.e. 0.0.0.0, and the game port was reachable from the
// internet: every rate limit, the /ws origin check and all the security headers
// live in the nginx config, so a direct connection to the Go process walked
// straight past them. deploy/nginx.snakes.conf documented the opposite ("listens
// on 127.0.0.1:8090 only"), which is how it went unnoticed.
//
// If this test ever fails, the hole is open again.
func TestDefaultBindIsLoopbackOnly(t *testing.T) {
	for _, unset := range []string{"", "   ", "\t"} {
		got := resolveListenAddr(unset, "8090")
		if got != "127.0.0.1:8090" {
			t.Fatalf("resolveListenAddr(%q) = %q; the process must not listen on every interface by default", unset, got)
		}
		if strings.HasPrefix(got, ":") || strings.HasPrefix(got, "0.0.0.0") {
			t.Fatalf("resolveListenAddr(%q) = %q — that is every interface", unset, got)
		}
	}
}

// Containers opt out explicitly: under docker compose nginx is a separate
// container and reaches the game over the compose network, where loopback is the
// container's own. Both compose files set BIND_ADDR=0.0.0.0 for that reason.
func TestExplicitBindAddressIsHonoured(t *testing.T) {
	for _, tc := range []struct{ bind, port, want string }{
		{"0.0.0.0", "3000", "0.0.0.0:3000"},
		{"127.0.0.1", "8090", "127.0.0.1:8090"},
		{"192.168.1.10", "3000", "192.168.1.10:3000"},
	} {
		if got := resolveListenAddr(tc.bind, tc.port); got != tc.want {
			t.Errorf("resolveListenAddr(%q, %q) = %q, want %q", tc.bind, tc.port, got, tc.want)
		}
	}
}

// An IPv6 literal has to come out bracketed, or ListenAndServe cannot parse the
// address and the service fails to start at all.
func TestIPv6LiteralIsBracketed(t *testing.T) {
	if got := resolveListenAddr("::1", "8090"); got != "[::1]:8090" {
		t.Fatalf("resolveListenAddr(\"::1\") = %q, want [::1]:8090", got)
	}
}

// Surrounding whitespace comes free with .env files and systemd Environment=
// lines; it must not turn into a host name that fails to resolve.
func TestWhitespaceAroundTheAddressIsIgnored(t *testing.T) {
	if got := resolveListenAddr("  0.0.0.0  ", "3000"); got != "0.0.0.0:3000" {
		t.Fatalf("resolveListenAddr = %q, want 0.0.0.0:3000", got)
	}
}
