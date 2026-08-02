// Package httpx — транспортный слой HTTP: адрес клиента за прокси, per-IP
// rate-limit, allowlist Origin'ов для рукопожатия WebSocket, middleware
// заголовков и кэша, пробы жизни и готовности.
//
// Про игру пакет не знает ничего: он одинаково обслуживал бы любой другой
// сервер за тем же nginx. Благодаря этому его правила можно проверять
// httptest-ом, не поднимая ни комнаты, ни ботов.
package httpx

import (
	"log"
	"net"
	"net/http"
	"os"
	"strings"
)

const defaultTrustedProxies = "127.0.0.1/8,::1"

var trustedProxyNets []*net.IPNet

func init() {
	InitTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
}

// InitTrustedProxies parses a comma separated list of CIDRs / bare IPs.
func InitTrustedProxies(spec string) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		spec = defaultTrustedProxies
	}
	nets := make([]*net.IPNet, 0, 4)
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, n, err := net.ParseCIDR(part); err == nil {
			nets = append(nets, n)
			continue
		}
		ip := net.ParseIP(part)
		if ip == nil {
			log.Printf("trusted_proxy_invalid entry=%q", part)
			continue
		}
		bits := 32
		if ip.To4() == nil {
			bits = 128
		}
		nets = append(nets, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
	}
	trustedProxyNets = nets
}

func isTrustedProxy(host string) bool {
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil {
		return false
	}
	for _, n := range trustedProxyNets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// ClientIP resolves the peer address used for rate limiting and logs
// only. X-Forwarded-For is honoured only when the immediate peer is a trusted
// proxy, and then the rightmost untrusted hop wins: everything to its left is
// attacker controlled and must not be believed.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	host = strings.TrimSpace(host)
	if !isTrustedProxy(host) {
		return host
	}
	xff := r.Header.Get("X-Forwarded-For")
	if xff == "" {
		return host
	}
	parts := strings.Split(xff, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		ip := strings.TrimSpace(parts[i])
		if ip == "" {
			continue
		}
		if net.ParseIP(ip) == nil {
			// Malformed chain: stop trusting it entirely.
			return host
		}
		if isTrustedProxy(ip) {
			continue
		}
		return ip
	}
	return host
}

// ResolveListenAddr turns the BIND_ADDR setting and the port into the address
// the HTTP server binds. An empty setting means loopback: in production this is
// a systemd unit behind the host's nginx, and nothing outside the machine has
// any business talking to the Go process directly.
func ResolveListenAddr(bindAddr, port string) string {
	host := strings.TrimSpace(bindAddr)
	if host == "" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}
