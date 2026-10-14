package security

import (
	"crypto/sha256"
	"net"
	"sync"
	"time"
)

type bucket struct {
	window time.Time
	count  int
}

// Limiter keeps only short-lived address digests and never trusts forwarded headers.
type Limiter struct {
	mu      sync.Mutex
	entries map[[32]byte]bucket
	limit   int
	period  time.Duration
	maxKeys int
	timer   *time.Timer
	closed  bool
}

func NewLimiter(limit int, period time.Duration) *Limiter {
	return &Limiter{entries: make(map[[32]byte]bucket), limit: limit, period: period, maxKeys: 4096}
}

func (l *Limiter) Allow(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	key := sha256.Sum256([]byte(host))
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return false
	}
	for address, entry := range l.entries {
		if now.Sub(entry.window) >= l.period {
			delete(l.entries, address)
		}
	}
	entry, exists := l.entries[key]
	if !exists {
		if len(l.entries) >= l.maxKeys {
			return false
		}
		entry.window = now
	}
	if entry.count >= l.limit {
		return false
	}
	entry.count++
	l.entries[key] = entry
	if l.timer == nil {
		l.timer = time.AfterFunc(l.period, l.expire)
	}
	return true
}

func (l *Limiter) expire() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	now := time.Now()
	var next time.Duration
	for address, entry := range l.entries {
		remaining := l.period - now.Sub(entry.window)
		if remaining <= 0 {
			delete(l.entries, address)
		} else if next == 0 || remaining < next {
			next = remaining
		}
	}
	l.timer = nil
	if next > 0 {
		l.timer = time.AfterFunc(next, l.expire)
	}
}

func (l *Limiter) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closed = true
	if l.timer != nil {
		l.timer.Stop()
		l.timer = nil
	}
	clear(l.entries)
}
