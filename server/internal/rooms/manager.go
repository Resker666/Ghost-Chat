package rooms

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"ghost-chat/server/internal/protocol"
)

var ErrCapacity = errors.New("room capacity reached")
var ErrClosed = errors.New("manager closed")

type Config struct {
	RoomTTL    time.Duration
	WaitingTTL time.Duration
	MaxRooms   int
}

type Created struct {
	RoomID             string    `json:"roomId"`
	CreatorToken       string    `json:"creatorToken"`
	InviteToken        string    `json:"inviteToken"`
	ExpiresAt          time.Time `json:"expiresAt"`
	IdleTimeoutSeconds float64   `json:"idleTimeoutSeconds"`
}

type Peer struct {
	Events chan []byte
	Done   chan struct{}
	Reason string // Set before Done closes; immutable after that point.
	Role   string
	seq    uint64
}

type room struct {
	id         string
	tokens     [2][32]byte
	consumed   [2]bool
	peers      [2]*Peer
	expiresAt  time.Time
	waitEndsAt time.Time
	ttlTimer   *time.Timer
	waitTimer  *time.Timer
}

type Manager struct {
	mu     sync.Mutex
	rooms  map[string]*room
	config Config
	closed bool
}

func New(config Config) *Manager {
	return &Manager{rooms: make(map[string]*room), config: config}
}

func randomString(length int) (string, error) {
	buffer := make([]byte, length)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func (m *Manager) Create() (Created, error) {
	var result Created
	var err error
	if result.RoomID, err = randomString(16); err != nil {
		return result, err
	}
	if result.CreatorToken, err = randomString(32); err != nil {
		return Created{}, err
	}
	if result.InviteToken, err = randomString(32); err != nil {
		return Created{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return Created{}, ErrClosed
	}
	if len(m.rooms) >= m.config.MaxRooms {
		return Created{}, ErrCapacity
	}
	if _, collision := m.rooms[result.RoomID]; collision {
		return Created{}, ErrCapacity
	}
	now := time.Now()
	result.ExpiresAt = now.Add(m.config.RoomTTL).UTC()
	result.IdleTimeoutSeconds = m.config.WaitingTTL.Seconds()
	r := &room{
		id: result.RoomID, expiresAt: result.ExpiresAt,
		waitEndsAt: now.Add(m.config.WaitingTTL),
		tokens:     [2][32]byte{sha256.Sum256([]byte(result.CreatorToken)), sha256.Sum256([]byte(result.InviteToken))},
	}
	m.rooms[r.id] = r
	r.ttlTimer = time.AfterFunc(m.config.RoomTTL, func() { m.expire(r.id) })
	r.waitTimer = time.AfterFunc(m.config.WaitingTTL, func() { m.expire(r.id) })
	return result, nil
}

func (m *Manager) expiredLocked(r *room) bool {
	now := time.Now()
	return !now.Before(r.expiresAt) || ((r.peers[0] == nil || r.peers[1] == nil) && !now.Before(r.waitEndsAt))
}

func (m *Manager) expire(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r := m.rooms[id]; r != nil && m.expiredLocked(r) {
		m.endLocked(r, "expired")
	}
}

func (m *Manager) Join(id, token string) (*Peer, string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.rooms[id]
	if r == nil {
		return nil, "ROOM_NOT_FOUND_OR_EXPIRED"
	}
	if m.expiredLocked(r) {
		m.endLocked(r, "expired")
		return nil, "ROOM_NOT_FOUND_OR_EXPIRED"
	}
	hash := sha256.Sum256([]byte(token))
	index := -1
	for i := range r.tokens {
		if subtle.ConstantTimeCompare(hash[:], r.tokens[i][:]) == 1 && !r.consumed[i] {
			index = i
		}
	}
	if index == -1 {
		return nil, "AUTH_FAILED"
	}
	peer := &Peer{Events: make(chan []byte, 16), Done: make(chan struct{}), Role: []string{"A", "B"}[index]}
	r.consumed[index] = true
	r.tokens[index] = [32]byte{}
	r.peers[index] = peer
	joined, _ := json.Marshal(struct {
		Version   int       `json:"v"`
		Kind      string    `json:"kind"`
		Role      string    `json:"role"`
		RoomID    string    `json:"roomId"`
		ExpiresAt time.Time `json:"expiresAt"`
	}{1, "joined", peer.Role, r.id, r.expiresAt})
	peer.Events <- joined
	if r.peers[0] != nil && r.peers[1] != nil {
		r.waitTimer.Stop()
		for _, p := range r.peers {
			if !m.enqueueLocked(p, protocol.Event("peer_ready")) {
				m.endLocked(r, "slow_client")
				break
			}
		}
	}
	return peer, ""
}

func (m *Manager) enqueueLocked(peer *Peer, data []byte) bool {
	select {
	case peer.Events <- data:
		return true
	default:
		return false
	}
}

func (m *Manager) Relay(id string, peer *Peer, message protocol.Message, raw []byte) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.rooms[id]
	if r == nil || (r.peers[0] != peer && r.peers[1] != peer) {
		return false
	}
	if m.expiredLocked(r) {
		m.endLocked(r, "expired")
		return false
	}
	index := 0
	direction := "A_TO_B"
	if peer.Role == "B" {
		index, direction = 1, "B_TO_A"
	}
	if r.peers[1-index] == nil || message.RoomID != id || message.Direction != direction || message.Sequence != peer.seq+1 {
		m.endLocked(r, "protocol_error")
		return false
	}
	peer.seq = message.Sequence
	if !m.enqueueLocked(r.peers[1-index], append([]byte(nil), raw...)) {
		m.endLocked(r, "slow_client")
		return false
	}
	return true
}

func (m *Manager) End(id string, peer *Peer, reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r := m.rooms[id]; r != nil && (r.peers[0] == peer || r.peers[1] == peer) {
		m.endLocked(r, reason)
	}
}

func (m *Manager) endLocked(r *room, reason string) {
	delete(m.rooms, r.id)
	r.ttlTimer.Stop()
	r.waitTimer.Stop()
	r.tokens = [2][32]byte{}
	for i, peer := range r.peers {
		if peer != nil {
			peer.Reason = reason
			close(peer.Done)
			for {
				select {
				case <-peer.Events:
				default:
					goto drained
				}
			}
		drained:
			r.peers[i] = nil
		}
	}
}

func (m *Manager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.rooms)
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	for _, r := range m.rooms {
		m.endLocked(r, "disconnected")
	}
}
