package rooms

import (
	"crypto/sha256"
	"encoding/base64"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ghost-chat/server/internal/protocol"
)

func newManager(t *testing.T) *Manager {
	t.Helper()
	m := New(Config{RoomTTL: time.Minute, WaitingTTL: 30 * time.Second, MaxRooms: 10})
	t.Cleanup(m.Close)
	return m
}

func create(t *testing.T, manager *Manager) Created {
	t.Helper()
	r, err := manager.Create()
	if err != nil {
		t.Fatal("room creation failed")
	}
	return r
}

func join(t *testing.T, manager *Manager, roomID, token string) *Peer {
	t.Helper()
	peer, code := manager.Join(roomID, token)
	if code != "" {
		t.Fatalf("join failed: %s", code)
	}
	return peer
}

func TestTokensIndependentHashedAndOnce(t *testing.T) {
	m := newManager(t)
	r := create(t, m)
	if !protocol.CanonicalBase64(r.RoomID, 16, 16) || !protocol.CanonicalBase64(r.CreatorToken, 32, 32) || !protocol.CanonicalBase64(r.InviteToken, 32, 32) || r.CreatorToken == r.InviteToken {
		t.Fatal("identifier or token generation invalid")
	}
	if m.rooms[r.RoomID].tokens[0] != sha256.Sum256([]byte(r.CreatorToken)) {
		t.Fatal("token not stored as digest")
	}
	a := join(t, m, r.RoomID, r.CreatorToken)
	if a.Role != "A" {
		t.Fatal("creator role invalid")
	}
	if _, code := m.Join(r.RoomID, r.CreatorToken); code != "AUTH_FAILED" {
		t.Fatal("consumed creator accepted")
	}
	if _, code := m.Join(r.RoomID, base64.RawURLEncoding.EncodeToString(make([]byte, 32))); code != "AUTH_FAILED" || m.Count() != 1 {
		t.Fatal("invalid token affected room")
	}
	b := join(t, m, r.RoomID, r.InviteToken)
	if b.Role != "B" || len(a.Events) != 2 || len(b.Events) != 2 {
		t.Fatal("room readiness events invalid")
	}
}

func TestConcurrentInviteHasSingleWinner(t *testing.T) {
	m := newManager(t)
	r := create(t, m)
	join(t, m, r.RoomID, r.CreatorToken)
	var wins atomic.Int32
	var group sync.WaitGroup
	for range 40 {
		group.Go(func() {
			if _, code := m.Join(r.RoomID, r.InviteToken); code == "" {
				wins.Add(1)
			}
		})
	}
	group.Wait()
	if wins.Load() != 1 || m.Count() != 1 {
		t.Fatal("invite consumption is not atomic")
	}
}

func TestDestroyAndDisconnectCannotBeReplayed(t *testing.T) {
	for _, reason := range []string{"destroyed", "disconnected"} {
		t.Run(reason, func(t *testing.T) {
			m := newManager(t)
			r := create(t, m)
			a := join(t, m, r.RoomID, r.CreatorToken)
			b := join(t, m, r.RoomID, r.InviteToken)
			m.End(r.RoomID, &Peer{}, "destroyed")
			if m.Count() != 1 {
				t.Fatal("unrelated peer destroyed room")
			}
			m.End(r.RoomID, a, reason)
			m.End(r.RoomID, b, reason)
			if m.Count() != 0 || a.Reason != reason || b.Reason != reason || len(a.Events) != 0 || len(b.Events) != 0 {
				t.Fatal("room not fully released")
			}
			if _, code := m.Join(r.RoomID, r.InviteToken); code != "ROOM_NOT_FOUND_OR_EXPIRED" {
				t.Fatal("destroyed room recovered")
			}
		})
	}
}

func TestWaitingAndAbsoluteExpiry(t *testing.T) {
	for _, bothJoined := range []bool{false, true} {
		m := New(Config{RoomTTL: 60 * time.Millisecond, WaitingTTL: 20 * time.Millisecond, MaxRooms: 1})
		t.Cleanup(m.Close)
		r := create(t, m)
		a := join(t, m, r.RoomID, r.CreatorToken)
		if bothJoined {
			join(t, m, r.RoomID, r.InviteToken)
		}
		select {
		case <-a.Done:
		case <-time.After(time.Second):
			t.Fatal("expiry did not close peer")
		}
		if a.Reason != "expired" || m.Count() != 0 {
			t.Fatal("expiry did not release room")
		}
	}
}

func TestRelayReplayAndSlowPeer(t *testing.T) {
	for _, mode := range []string{"replay", "slow", "wrong direction", "wrong room", "not ready"} {
		t.Run(mode, func(t *testing.T) {
			m := newManager(t)
			r := create(t, m)
			a := join(t, m, r.RoomID, r.CreatorToken)
			if mode != "not ready" {
				b := join(t, m, r.RoomID, r.InviteToken)
				if mode == "slow" {
					for len(b.Events) < cap(b.Events) {
						b.Events <- []byte("test")
					}
				}
			}
			message := protocol.Message{Version: 1, Kind: "ciphertext", RoomID: r.RoomID, Direction: "A_TO_B", Sequence: 1}
			if mode == "wrong direction" {
				message.Direction = "B_TO_A"
			}
			if mode == "wrong room" {
				message.RoomID = "wrong"
			}
			if mode == "replay" && !m.Relay(r.RoomID, a, message, []byte("test")) {
				t.Fatal("valid relay rejected")
			}
			if m.Relay(r.RoomID, a, message, []byte("test")) || m.Count() != 0 {
				t.Fatal("invalid relay did not close room")
			}
		})
	}
}

func TestCapacityAndShutdown(t *testing.T) {
	m := New(Config{RoomTTL: time.Minute, WaitingTTL: time.Minute, MaxRooms: 1})
	r := create(t, m)
	if _, err := m.Create(); err != ErrCapacity {
		t.Fatal("room limit not enforced")
	}
	peer := join(t, m, r.RoomID, r.CreatorToken)
	m.Close()
	if _, err := m.Create(); err != ErrClosed || m.Count() != 0 {
		t.Fatal("closed manager accepted room")
	}
	select {
	case <-peer.Done:
	default:
		t.Fatal("shutdown did not close peer")
	}
}
