package httpx

import (
	"math"
	"sync"
	"time"
)

type tokenBucket struct {
	tokens   float64
	last     time.Time
	rate     float64
	burst    float64
	lastSeen time.Time
}

// IPRateLimiter — токенное ведро на каждую пару (IP, тип сообщения).
type IPRateLimiter struct {
	mu        sync.Mutex
	buckets   map[string]*tokenBucket
	lastSweep time.Time
}

func NewIPRateLimiter() *IPRateLimiter {
	return &IPRateLimiter{buckets: make(map[string]*tokenBucket)}
}

// Reset выбрасывает все вёдра. Лимитер один на процесс, поэтому тесты, которые
// гоняют десятки подключений с одного адреса, обязаны начинать с чистого листа.
func (l *IPRateLimiter) Reset() {
	l.mu.Lock()
	l.buckets = make(map[string]*tokenBucket)
	l.mu.Unlock()
}

const (
	// rateLimiterSweepAt is the bucket count above which idle entries are
	// dropped. One bucket exists per (IP, message type) pair.
	rateLimiterSweepAt = 5000
	// rateLimiterSweepEvery bounds how often the O(n) sweep runs.
	rateLimiterSweepEvery = 30 * time.Second
	// rateLimiterBucketTTL is how long an untouched bucket is kept.
	rateLimiterBucketTTL = 10 * time.Minute
	// rateLimiterBucketTTLTight is the fallback cutoff used when a normal
	// sweep did not bring the map back under the threshold.
	rateLimiterBucketTTLTight = time.Minute
)

// sweepLocked drops idle buckets. It must run on the accepted path too: the
// original code swept only after a rejection, so a server where nobody is
// being limited grew the map without bound. Caller holds l.mu.
func (l *IPRateLimiter) sweepLocked(now time.Time) {
	if len(l.buckets) <= rateLimiterSweepAt {
		return
	}
	if !l.lastSweep.IsZero() && now.Sub(l.lastSweep) < rateLimiterSweepEvery {
		return
	}
	l.lastSweep = now
	l.dropIdleLocked(now.Add(-rateLimiterBucketTTL))
	if len(l.buckets) > rateLimiterSweepAt {
		l.dropIdleLocked(now.Add(-rateLimiterBucketTTLTight))
	}
}

func (l *IPRateLimiter) dropIdleLocked(cut time.Time) {
	for k, v := range l.buckets {
		if v.lastSeen.Before(cut) {
			delete(l.buckets, k)
		}
	}
}

func (l *IPRateLimiter) Allow(key string, rate float64, burst float64) bool {
	if l == nil {
		return true
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.buckets == nil {
		l.buckets = make(map[string]*tokenBucket)
	}
	b := l.buckets[key]
	if b == nil {
		b = &tokenBucket{tokens: burst, last: now, rate: rate, burst: burst, lastSeen: now}
		l.buckets[key] = b
	}
	b.lastSeen = now
	b.rate = rate
	b.burst = burst
	dt := now.Sub(b.last).Seconds()
	if dt > 0 {
		b.tokens = math.Min(b.burst, b.tokens+dt*b.rate)
		b.last = now
	}
	l.sweepLocked(now)
	if b.tokens >= 1 {
		b.tokens -= 1
		return true
	}
	return false
}
