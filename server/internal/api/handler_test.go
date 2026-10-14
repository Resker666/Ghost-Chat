package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ghost-chat/server/internal/protocol"
	"ghost-chat/server/internal/rooms"
	"github.com/coder/websocket"
)

func TestHealth(t *testing.T) {
	response := httptest.NewRecorder()
	NewHandler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if response.Body.String() != "{\"status\":\"ok\"}\n" {
		t.Fatal("unexpected health response")
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("health response must not be cached")
	}
}

func setup(t *testing.T, change func(*Config)) (*Server, *httptest.Server) {
	t.Helper()
	config := DefaultConfig()
	config.HeartbeatInterval = time.Minute
	config.CreateRatePerMinute = 10000
	config.UpgradeRatePerMinute = 10000
	if change != nil {
		change(&config)
	}
	server := New(config)
	httpServer := httptest.NewServer(server)
	t.Cleanup(func() { server.Close(); httpServer.Close() })
	return server, httpServer
}

func createRoom(t *testing.T, server *httptest.Server) rooms.Created {
	t.Helper()
	response, err := http.Post(server.URL+"/api/v1/rooms", "application/json", nil)
	if err != nil {
		t.Fatal("create request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("create status = %d", response.StatusCode)
	}
	var created rooms.Created
	if json.NewDecoder(response.Body).Decode(&created) != nil {
		t.Fatal("invalid create response")
	}
	return created
}

func dial(t *testing.T, server *httptest.Server, roomID string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/rooms/"+roomID+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": {"http://localhost:5173"}},
	})
	if err != nil {
		t.Fatal("websocket connection failed")
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn
}

func send(t *testing.T, conn *websocket.Conn, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal("test message encoding failed")
	}
	writeRaw(t, conn, websocket.MessageText, raw)
}

func writeRaw(t *testing.T, conn *websocket.Conn, messageType websocket.MessageType, raw []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if conn.Write(ctx, messageType, raw) != nil {
		t.Fatal("websocket write failed")
	}
}

func read(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	typeID, raw, err := conn.Read(ctx)
	if err != nil || typeID != websocket.MessageText {
		t.Fatal("expected websocket text event")
	}
	var result map[string]any
	if json.Unmarshal(raw, &result) != nil {
		t.Fatal("invalid event JSON")
	}
	return result
}

func expect(t *testing.T, conn *websocket.Conn, kind, field, value string) {
	t.Helper()
	frame := read(t, conn)
	if frame["v"] != float64(1) || frame["kind"] != kind || (field != "" && frame[field] != value) {
		t.Fatalf("unexpected event kind = %v", frame["kind"])
	}
}

func auth(t *testing.T, conn *websocket.Conn, token string) {
	t.Helper()
	send(t, conn, protocol.Message{Version: 1, Kind: "auth", Token: token})
}

func pair(t *testing.T, server *httptest.Server) (rooms.Created, *websocket.Conn, *websocket.Conn) {
	t.Helper()
	created := createRoom(t, server)
	a, b := dial(t, server, created.RoomID), dial(t, server, created.RoomID)
	auth(t, a, created.CreatorToken)
	expect(t, a, "joined", "role", "A")
	auth(t, b, created.InviteToken)
	expect(t, b, "joined", "role", "B")
	expect(t, a, "peer_ready", "", "")
	expect(t, b, "peer_ready", "", "")
	return created, a, b
}

func ciphertext(roomID, direction string, sequence uint64) protocol.Message {
	return protocol.Message{Version: 1, Kind: "ciphertext", RoomID: roomID, Direction: direction, Sequence: sequence,
		IV: base64.RawURLEncoding.EncodeToString(make([]byte, 12)), Ciphertext: base64.RawURLEncoding.EncodeToString(make([]byte, 17))}
}

func TestWebSocketBidirectionalRelayAndDestroy(t *testing.T) {
	server, httpServer := setup(t, nil)
	created, a, b := pair(t, httpServer)
	for _, direction := range []string{"A_TO_B", "B_TO_A"} {
		source, destination := a, b
		if direction == "B_TO_A" {
			source, destination = b, a
		}
		send(t, source, ciphertext(created.RoomID, direction, 1))
		expect(t, destination, "ciphertext", "direction", direction)
	}
	send(t, b, protocol.Message{Version: 1, Kind: "destroy"})
	expect(t, a, "room_destroyed", "reason", "destroyed")
	expect(t, b, "room_destroyed", "reason", "destroyed")
	if server.manager.Count() != 0 {
		t.Fatal("destroy did not release room")
	}
	third := dial(t, httpServer, created.RoomID)
	auth(t, third, created.InviteToken)
	expect(t, third, "error", "code", "ROOM_NOT_FOUND_OR_EXPIRED")
}

func TestUnauthenticatedAndThirdClientCannotDisruptRoom(t *testing.T) {
	server, httpServer := setup(t, nil)
	created, a, b := pair(t, httpServer)
	attacker := dial(t, httpServer, created.RoomID)
	send(t, attacker, protocol.Message{Version: 1, Kind: "destroy"})
	expect(t, attacker, "error", "code", "PROTOCOL_ERROR")
	for _, token := range []string{base64.RawURLEncoding.EncodeToString(make([]byte, 32)), created.CreatorToken, created.InviteToken} {
		third := dial(t, httpServer, created.RoomID)
		auth(t, third, token)
		expect(t, third, "error", "code", "AUTH_FAILED")
	}
	if server.manager.Count() != 1 {
		t.Fatal("invalid clients ended room")
	}
	send(t, a, ciphertext(created.RoomID, "A_TO_B", 1))
	expect(t, b, "ciphertext", "direction", "A_TO_B")
}

func TestConcurrentWebSocketInviteConsumption(t *testing.T) {
	_, httpServer := setup(t, nil)
	created := createRoom(t, httpServer)
	a := dial(t, httpServer, created.RoomID)
	auth(t, a, created.CreatorToken)
	expect(t, a, "joined", "role", "A")
	connections := make([]*websocket.Conn, 8)
	for i := range connections {
		connections[i] = dial(t, httpServer, created.RoomID)
	}
	var joined atomic.Int32
	var group sync.WaitGroup
	for _, conn := range connections {
		group.Go(func() {
			auth(t, conn, created.InviteToken)
			frame := read(t, conn)
			if frame["kind"] == "joined" {
				joined.Add(1)
			} else if frame["code"] != "AUTH_FAILED" {
				t.Error("unexpected invitation result")
			}
		})
	}
	group.Wait()
	if joined.Load() != 1 {
		t.Fatal("invitation had multiple winners")
	}
}

func TestDisconnectEndsEntireRoom(t *testing.T) {
	server, httpServer := setup(t, nil)
	_, a, b := pair(t, httpServer)
	_ = a.CloseNow()
	expect(t, b, "room_destroyed", "reason", "disconnected")
	if server.manager.Count() != 0 {
		t.Fatal("disconnect did not release room")
	}
}

func TestProtocolViolationsEndAuthenticatedRoom(t *testing.T) {
	for _, mode := range []string{"replay", "wrong direction", "wrong room", "duplicate", "unknown", "binary", "auth again", "oversize", "not ready"} {
		t.Run(mode, func(t *testing.T) {
			server, httpServer := setup(t, nil)
			var created rooms.Created
			var a, b *websocket.Conn
			if mode == "not ready" {
				created = createRoom(t, httpServer)
				a = dial(t, httpServer, created.RoomID)
				auth(t, a, created.CreatorToken)
				expect(t, a, "joined", "role", "A")
				b = a
			} else {
				created, a, b = pair(t, httpServer)
			}
			message := ciphertext(created.RoomID, "A_TO_B", 1)
			switch mode {
			case "replay":
				send(t, a, message)
				expect(t, b, "ciphertext", "", "")
				send(t, a, message)
			case "wrong direction":
				message.Direction = "B_TO_A"
				send(t, a, message)
			case "wrong room":
				message.RoomID = base64.RawURLEncoding.EncodeToString(make([]byte, 16))
				send(t, a, message)
			case "duplicate":
				writeRaw(t, a, websocket.MessageText, []byte(`{"v":1,"kind":"destroy","kind":"destroy"}`))
			case "unknown":
				writeRaw(t, a, websocket.MessageText, []byte(`{"v":1,"kind":"destroy","extra":true}`))
			case "binary":
				writeRaw(t, a, websocket.MessageBinary, []byte(`{"v":1,"kind":"destroy"}`))
			case "auth again":
				auth(t, a, created.CreatorToken)
			case "oversize":
				writeRaw(t, a, websocket.MessageText, []byte(strings.Repeat("x", protocol.MaxFrameBytes+1)))
			case "not ready":
				send(t, a, message)
			}
			reason := "protocol_error"
			if mode == "oversize" {
				reason = "disconnected"
			}
			expect(t, b, "room_destroyed", "reason", reason)
			if server.manager.Count() != 0 {
				t.Fatal("invalid frame did not release room")
			}
		})
	}
}

func TestRoomExpiryEvents(t *testing.T) {
	for _, bothJoined := range []bool{false, true} {
		server, httpServer := setup(t, func(config *Config) {
			config.WaitingTTL = 40 * time.Millisecond
			config.RoomTTL = 150 * time.Millisecond
		})
		var a *websocket.Conn
		if bothJoined {
			_, a, _ = pair(t, httpServer)
		} else {
			created := createRoom(t, httpServer)
			a = dial(t, httpServer, created.RoomID)
			auth(t, a, created.CreatorToken)
			expect(t, a, "joined", "role", "A")
		}
		expect(t, a, "room_destroyed", "reason", "expired")
		if server.manager.Count() != 0 {
			t.Fatal("expired room retained")
		}
	}
}

func TestAuthTimeoutDoesNotConsumeInvite(t *testing.T) {
	_, httpServer := setup(t, func(config *Config) { config.AuthTimeout = 25 * time.Millisecond })
	created := createRoom(t, httpServer)
	unauthenticated := dial(t, httpServer, created.RoomID)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, _, err := unauthenticated.Read(ctx); err == nil {
		t.Fatal("authentication did not timeout")
	}
	b := dial(t, httpServer, created.RoomID)
	auth(t, b, created.InviteToken)
	expect(t, b, "joined", "role", "B")
}

func TestOriginQueryAndRateControls(t *testing.T) {
	_, httpServer := setup(t, func(config *Config) { config.CreateRatePerMinute = 1 })
	created := createRoom(t, httpServer)
	response, err := http.Post(httpServer.URL+"/api/v1/rooms", "application/json", nil)
	if err != nil {
		t.Fatal("request failed")
	}
	response.Body.Close()
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatal("creation rate not limited")
	}
	for _, origin := range []string{"https://localhost:5173", "http://localhost:5174", "http://localhost:5173.attacker.example", "null", ""} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		conn, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/v1/rooms/"+created.RoomID+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {origin}}})
		cancel()
		if conn != nil {
			conn.CloseNow()
		}
		if err == nil || response == nil || response.StatusCode != http.StatusForbidden {
			t.Fatal("invalid origin accepted")
		}
	}
}

func TestStaticFallback(t *testing.T) {
	directory := t.TempDir()
	if os.WriteFile(filepath.Join(directory, "index.html"), []byte("<!doctype html><title>Test</title>"), 0600) != nil {
		t.Fatal("fixture write failed")
	}
	_, httpServer := setup(t, func(config *Config) { config.WebDistDir = directory })
	for _, route := range []string{"/", "/r/" + base64.RawURLEncoding.EncodeToString(make([]byte, 16))} {
		response, err := http.Get(httpServer.URL + route)
		if err != nil {
			t.Fatal("static request failed")
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "<title>Test</title>") {
			t.Fatal("SPA fallback failed")
		}
	}
}

func TestHealthRejectsMutation(t *testing.T) {
	response := httptest.NewRecorder()
	NewHandler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/healthz", nil))
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", response.Code)
	}
}
