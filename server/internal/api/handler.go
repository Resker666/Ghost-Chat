package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"ghost-chat/server/internal/protocol"
	"ghost-chat/server/internal/rooms"
	"ghost-chat/server/internal/security"
)

type Server struct {
	config      Config
	manager     *rooms.Manager
	createLimit *security.Limiter
	wsLimit     *security.Limiter
	connections atomic.Int64
	handler     http.Handler
	ctx         context.Context
	cancel      context.CancelFunc
}

func NewHandler() http.Handler { return New(DefaultConfig()) }

func New(config Config) *Server {
	ctx, cancel := context.WithCancel(context.Background())
	server := &Server{
		ctx: ctx, cancel: cancel,
		config:      config,
		manager:     rooms.New(rooms.Config{RoomTTL: config.RoomTTL, WaitingTTL: config.WaitingTTL, MaxRooms: config.MaxRooms}),
		createLimit: security.NewLimiter(config.CreateRatePerMinute, time.Minute),
		wsLimit:     security.NewLimiter(config.UpgradeRatePerMinute, time.Minute),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, struct {
			Status string `json:"status"`
		}{"ok"})
	})
	mux.HandleFunc("POST /api/v1/rooms", server.createRoom)
	mux.HandleFunc("GET /api/v1/rooms/{roomID}/ws", server.connect)
	mux.HandleFunc("GET /api/", func(w http.ResponseWriter, _ *http.Request) { writeError(w, http.StatusNotFound, "PROTOCOL_ERROR") })
	mux.HandleFunc("GET /", server.static)
	server.handler = mux
	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), display-capture=()")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	if r.TLS != nil {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	}
	s.handler.ServeHTTP(w, r)
}

func (s *Server) Close() {
	s.manager.Close()
	s.cancel()
	s.createLimit.Close()
	s.wsLimit.Close()
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(protocol.Error(code))
}

func (s *Server) allowedOrigin(r *http.Request) bool {
	origins := r.Header.Values("Origin")
	if len(origins) != 1 {
		return false
	}
	for _, allowed := range s.config.AllowedOrigins {
		if origins[0] == allowed {
			return true
		}
	}
	return false
}

func (s *Server) createRoom(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || (r.Header.Get("Origin") != "" && !s.allowedOrigin(r)) {
		writeError(w, http.StatusForbidden, "PROTOCOL_ERROR")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1))
	if err != nil || len(body) != 0 {
		writeError(w, http.StatusBadRequest, "PROTOCOL_ERROR")
		return
	}
	if !s.createLimit.Allow(r.RemoteAddr) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED")
		return
	}
	created, err := s.manager.Create()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "RATE_LIMITED")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) connect(w http.ResponseWriter, r *http.Request) {
	if !s.allowedOrigin(r) || r.URL.RawQuery != "" || !protocol.CanonicalBase64(r.PathValue("roomID"), 16, 16) {
		writeError(w, http.StatusForbidden, "PROTOCOL_ERROR")
		return
	}
	if !s.wsLimit.Allow(r.RemoteAddr) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED")
		return
	}
	if s.connections.Add(1) > int64(s.config.MaxConnections) {
		s.connections.Add(-1)
		writeError(w, http.StatusServiceUnavailable, "RATE_LIMITED")
		return
	}
	defer s.connections.Add(-1)
	// Origin has already been compared exactly, including its scheme and port.
	handshake := &handshakeResponse{ResponseWriter: w}
	conn, err := websocket.Accept(handshake, r, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		if handshake.rejectedStatus != 0 {
			w.Header().Del("Connection")
			w.Header().Del("Upgrade")
			w.Header().Del("Sec-WebSocket-Accept")
			writeError(w, handshake.rejectedStatus, "PROTOCOL_ERROR")
		}
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(protocol.MaxFrameBytes)
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	authCtx, authCancel := context.WithTimeout(ctx, s.config.AuthTimeout)
	typeID, raw, err := conn.Read(authCtx)
	authCancel()
	if err != nil {
		return
	}
	message, parseErr := protocol.Decode(raw)
	if typeID != websocket.MessageText || parseErr != nil || message.Kind != "auth" {
		s.writeFrame(ctx, conn, protocol.Error("PROTOCOL_ERROR"))
		return
	}
	peer, code := s.manager.Join(r.PathValue("roomID"), message.Token)
	message.Token = ""
	clear(raw)
	if code != "" {
		s.writeFrame(ctx, conn, protocol.Error(code))
		return
	}
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		s.writePeer(ctx, conn, r.PathValue("roomID"), peer)
	}()
	defer func() {
		s.manager.End(r.PathValue("roomID"), peer, "disconnected")
		cancel()
		_ = conn.CloseNow()
		<-writerDone
	}()
	window, count := time.Now(), 0
	for {
		readCtx, readCancel := context.WithTimeout(ctx, s.config.RoomTTL+s.config.AuthTimeout)
		typeID, raw, err := conn.Read(readCtx)
		readCancel()
		if err != nil {
			s.manager.End(r.PathValue("roomID"), peer, "disconnected")
			return
		}
		if time.Since(window) >= time.Second {
			window, count = time.Now(), 0
		}
		count++
		message, err := protocol.Decode(raw)
		if count > s.config.MessageRatePerSecond || typeID != websocket.MessageText || err != nil || message.Kind == "auth" {
			s.manager.End(r.PathValue("roomID"), peer, "protocol_error")
			<-writerDone
			return
		}
		if message.Kind == "destroy" {
			s.manager.End(r.PathValue("roomID"), peer, "destroyed")
			<-writerDone
			return
		}
		if !s.manager.Relay(r.PathValue("roomID"), peer, message, raw) {
			<-writerDone
			return
		}
	}
}

// Suppress the library's diagnostic error body while retaining its handshake checks.
type handshakeResponse struct {
	http.ResponseWriter
	rejectedStatus int
}

func (w *handshakeResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *handshakeResponse) WriteHeader(status int) {
	if status >= 400 {
		w.rejectedStatus = status
		return
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *handshakeResponse) Write(data []byte) (int, error) {
	if w.rejectedStatus != 0 {
		return len(data), nil
	}
	return w.ResponseWriter.Write(data)
}

func (s *Server) writeFrame(ctx context.Context, conn *websocket.Conn, frame []byte) error {
	writeCtx, cancel := context.WithTimeout(ctx, s.config.WriteTimeout)
	defer cancel()
	return conn.Write(writeCtx, websocket.MessageText, frame)
}

func (s *Server) writePeer(ctx context.Context, conn *websocket.Conn, roomID string, peer *rooms.Peer) {
	defer conn.CloseNow()
	ticker := time.NewTicker(s.config.HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-peer.Done:
			s.writeFrame(ctx, conn, protocol.Destroyed(peer.Reason))
			return
		default:
		}
		select {
		case <-ctx.Done():
			return
		case <-peer.Done:
			s.writeFrame(ctx, conn, protocol.Destroyed(peer.Reason))
			return
		case data := <-peer.Events:
			if err := s.writeFrame(ctx, conn, data); err != nil {
				s.manager.End(roomID, peer, "disconnected")
				return
			}
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, s.config.HeartbeatTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				s.manager.End(roomID, peer, "disconnected")
				return
			}
		}
	}
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	root, err := os.OpenRoot(s.config.WebDistDir)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if r.URL.Path == "/" || (strings.HasPrefix(r.URL.Path, "/r/") && protocol.CanonicalBase64(strings.TrimPrefix(r.URL.Path, "/r/"), 16, 16)) {
		name = "index.html"
	}
	file, err := root.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	if strings.HasSuffix(name, ".html") {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	}
	http.ServeContent(w, r, name, info.ModTime(), file)
}
