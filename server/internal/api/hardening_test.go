package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ghost-chat/server/internal/protocol"
	"github.com/coder/websocket"
)

func waitReleased(t *testing.T, server *Server) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for server.connections.Load() != 0 || server.manager.Count() != 0 {
		if time.Now().After(deadline) {
			t.Fatal("connection handlers or room resources did not stop")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestSecurityHeadersAndNoForwardedTLS(t *testing.T) {
	server := New(DefaultConfig())
	defer server.Close()
	for _, secure := range []bool{false, true} {
		request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		request.Header.Set("X-Forwarded-Proto", "https")
		if secure {
			request.TLS = &tls.ConnectionState{}
		}
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		for header, expected := range map[string]string{
			"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
			"X-Content-Type-Options": "nosniff", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Resource-Policy": "same-origin",
		} {
			if response.Header().Get(header) != expected {
				t.Fatalf("missing header %s", header)
			}
		}
		policy := response.Header().Get("Content-Security-Policy")
		for _, directive := range []string{"default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "form-action 'none'"} {
			if !strings.Contains(policy, directive) {
				t.Fatal("CSP missing restrictive directive")
			}
		}
		if strings.Contains(policy, "unsafe-") || strings.Contains(policy, "*") {
			t.Fatal("CSP allows unsafe execution")
		}
		if response.Header().Get("Permissions-Policy") == "" {
			t.Fatal("permissions policy missing")
		}
		if (response.Header().Get("Strict-Transport-Security") != "") != secure {
			t.Fatal("untrusted forwarded TLS influenced HSTS")
		}
	}
}

func TestRoomRequestLimitsAndProxyHeaders(t *testing.T) {
	server, httpServer := setup(t, func(config *Config) { config.CreateRatePerMinute = 1 })
	for _, body := range []string{"{}", strings.Repeat("a", 8192)} {
		response, err := http.Post(httpServer.URL+"/api/v1/rooms", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal("request failed")
		}
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest || server.manager.Count() != 0 {
			t.Fatal("request body accepted")
		}
	}
	createRoom(t, httpServer)
	request, _ := http.NewRequest(http.MethodPost, httpServer.URL+"/api/v1/rooms", nil)
	request.Header.Set("X-Forwarded-For", "192.0.2.99")
	request.Header.Set("Forwarded", "for=192.0.2.99")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal("request failed")
	}
	response.Body.Close()
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatal("forwarded address bypassed limit")
	}
}

func TestMalformedHandshakeHasFixedErrorWithoutHeaderReflection(t *testing.T) {
	_, httpServer := setup(t, nil)
	created := createRoom(t, httpServer)
	request, _ := http.NewRequest(http.MethodGet, httpServer.URL+"/api/v1/rooms/"+created.RoomID+"/ws", nil)
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Sec-WebSocket-Version", "private-header-fixture")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal("request failed")
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusBadRequest || string(body) != string(protocol.Error("PROTOCOL_ERROR")) || strings.Contains(string(body), "private-header-fixture") {
		t.Fatal("handshake diagnostics were exposed")
	}
}

func TestConnectionCapacityAndUpgradeRate(t *testing.T) {
	for _, mode := range []string{"capacity", "rate"} {
		t.Run(mode, func(t *testing.T) {
			server, httpServer := setup(t, func(config *Config) {
				if mode == "capacity" {
					config.MaxConnections = 1
				} else {
					config.UpgradeRatePerMinute = 1
				}
			})
			created := createRoom(t, httpServer)
			dial(t, httpServer, created.RoomID)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			conn, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/v1/rooms/"+created.RoomID+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"http://localhost:5173"}}})
			if conn != nil {
				conn.CloseNow()
			}
			if err == nil || response == nil || (response.StatusCode != http.StatusServiceUnavailable && response.StatusCode != http.StatusTooManyRequests) {
				t.Fatal("connection guard bypassed")
			}
			server.Close()
			waitReleased(t, server)
		})
	}
}

func TestCloseCancelsPendingAuthenticationAndRestartLosesRooms(t *testing.T) {
	server, httpServer := setup(t, func(config *Config) { config.AuthTimeout = time.Minute })
	created := createRoom(t, httpServer)
	pending := dial(t, httpServer, created.RoomID)
	server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, _, err := pending.Read(ctx); err == nil {
		t.Fatal("pending authentication survived shutdown")
	}
	waitReleased(t, server)
	_, restarted := setup(t, nil)
	conn := dial(t, restarted, created.RoomID)
	auth(t, conn, created.InviteToken)
	expect(t, conn, "error", "code", "ROOM_NOT_FOUND_OR_EXPIRED")
}

func TestHeartbeatDetectsUnresponsiveClient(t *testing.T) {
	server, httpServer := setup(t, func(config *Config) {
		config.HeartbeatInterval = 20 * time.Millisecond
		config.HeartbeatTimeout = 20 * time.Millisecond
	})
	_, a, b := pair(t, httpServer)
	// Only B continues reading, so A never processes the server ping or sends a pong.
	expect(t, b, "room_destroyed", "reason", "disconnected")
	_ = a.CloseNow()
	_ = b.CloseNow()
	waitReleased(t, server)
}

func TestConcurrentRoomsAndRepeatedCloseReleaseResources(t *testing.T) {
	server, httpServer := setup(t, nil)
	var group sync.WaitGroup
	for range 24 {
		group.Go(func() {
			created, a, b := pair(t, httpServer)
			send(t, a, ciphertext(created.RoomID, "A_TO_B", 1))
			expect(t, b, "ciphertext", "direction", "A_TO_B")
			var closers sync.WaitGroup
			for range 3 {
				closers.Go(func() { _ = a.CloseNow() })
				closers.Go(func() { _ = b.CloseNow() })
			}
			closers.Wait()
		})
	}
	group.Wait()
	waitReleased(t, server)
}

func TestMessageRateEndsRoom(t *testing.T) {
	server, httpServer := setup(t, func(config *Config) { config.MessageRatePerSecond = 1 })
	created, a, b := pair(t, httpServer)
	send(t, a, ciphertext(created.RoomID, "A_TO_B", 1))
	expect(t, b, "ciphertext", "direction", "A_TO_B")
	send(t, a, ciphertext(created.RoomID, "A_TO_B", 2))
	expect(t, b, "room_destroyed", "reason", "protocol_error")
	if server.manager.Count() != 0 {
		t.Fatal("message rate did not end room")
	}
}

func TestStaticCannotEscapeRootThroughSymlink(t *testing.T) {
	directory, outside := t.TempDir(), t.TempDir()
	if os.WriteFile(filepath.Join(outside, "private.txt"), []byte("outside-root-fixture"), 0600) != nil {
		t.Fatal("fixture write failed")
	}
	if err := os.Symlink(outside, filepath.Join(directory, "escape")); err != nil {
		t.Skip("symbolic link creation unavailable on host")
	}
	_, httpServer := setup(t, func(config *Config) { config.WebDistDir = directory })
	response, err := http.Get(httpServer.URL + "/escape/private.txt")
	if err != nil {
		t.Fatal("request failed")
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusNotFound || strings.Contains(string(body), "outside-root-fixture") {
		t.Fatal("static file escaped configured root")
	}
}

func TestNoSessionDataWrittenToApplicationLogger(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	_, httpServer := setup(t, nil)
	created, a, b := pair(t, httpServer)
	send(t, a, ciphertext(created.RoomID, "A_TO_B", 1))
	expect(t, b, "ciphertext", "direction", "A_TO_B")
	invalid := dial(t, httpServer, created.RoomID)
	auth(t, invalid, base64.RawURLEncoding.EncodeToString(make([]byte, 32)))
	expect(t, invalid, "error", "code", "AUTH_FAILED")
	send(t, a, protocol.Message{Version: 1, Kind: "destroy"})
	expect(t, b, "room_destroyed", "reason", "destroyed")
	if output.Len() != 0 {
		t.Fatal("application logged session activity")
	}
}
