package security

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestAddressLimitIgnoresSourcePortAndExpiresAutomatically(t *testing.T) {
	limiter := NewLimiter(2, 30*time.Millisecond)
	defer limiter.Close()
	if !limiter.Allow("127.0.0.1:10") || !limiter.Allow("127.0.0.1:11") || limiter.Allow("127.0.0.1:12") {
		t.Fatal("source ports bypassed rate limit")
	}
	deadline := time.Now().Add(time.Second)
	for {
		limiter.mu.Lock()
		count := len(limiter.entries)
		limiter.mu.Unlock()
		if count == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("idle limiter retained expired addresses")
		}
		time.Sleep(time.Millisecond)
	}
	if !limiter.Allow("127.0.0.1:13") {
		t.Fatal("expired window not reset")
	}
}

func TestLimiterCardinalityAndShutdownBounded(t *testing.T) {
	limiter := NewLimiter(10, time.Minute)
	limiter.maxKeys = 2
	if !limiter.Allow("192.0.2.1:1") || !limiter.Allow("192.0.2.2:1") || limiter.Allow("192.0.2.3:1") {
		t.Fatal("limiter cardinality not bounded")
	}
	limiter.Close()
	limiter.Close()
	if len(limiter.entries) != 0 || limiter.timer != nil || limiter.Allow("192.0.2.1:2") {
		t.Fatal("closed limiter retained resources")
	}
}

func TestConcurrentRateLimitHasExactBound(t *testing.T) {
	limiter := NewLimiter(15, time.Minute)
	defer limiter.Close()
	var allowed atomic.Int32
	var group sync.WaitGroup
	for i := range 100 {
		group.Go(func() {
			if limiter.Allow(fmt.Sprintf("127.0.0.1:%d", i+1)) {
				allowed.Add(1)
			}
		})
	}
	group.Wait()
	if allowed.Load() != 15 {
		t.Fatal("concurrent requests exceeded limit")
	}
}
