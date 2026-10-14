package api

import (
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	WebDistDir           string
	AllowedOrigins       []string
	RoomTTL              time.Duration
	WaitingTTL           time.Duration
	AuthTimeout          time.Duration
	WriteTimeout         time.Duration
	HeartbeatInterval    time.Duration
	HeartbeatTimeout     time.Duration
	MaxRooms             int
	MaxConnections       int
	CreateRatePerMinute  int
	UpgradeRatePerMinute int
	MessageRatePerSecond int
}

func DefaultConfig() Config {
	return Config{
		WebDistDir:     "../web/dist",
		AllowedOrigins: []string{"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080", "http://127.0.0.1:8080"},
		RoomTTL:        30 * time.Minute, WaitingTTL: 10 * time.Minute,
		AuthTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second,
		HeartbeatInterval: 15 * time.Second, HeartbeatTimeout: 5 * time.Second,
		MaxRooms: 1000, MaxConnections: 2100,
		CreateRatePerMinute: 30, UpgradeRatePerMinute: 120, MessageRatePerSecond: 20,
	}
}

func ConfigFromEnv() (Config, error) {
	config := DefaultConfig()
	if value := os.Getenv("WEB_DIST_DIR"); value != "" {
		config.WebDistDir = value
	}
	if value := os.Getenv("ALLOWED_ORIGINS"); value != "" {
		config.AllowedOrigins = strings.Split(value, ",")
	}
	for name, target := range map[string]*time.Duration{
		"ROOM_TTL": &config.RoomTTL, "WAITING_TTL": &config.WaitingTTL,
		"AUTH_TIMEOUT": &config.AuthTimeout, "WRITE_TIMEOUT": &config.WriteTimeout,
		"HEARTBEAT_INTERVAL": &config.HeartbeatInterval, "HEARTBEAT_TIMEOUT": &config.HeartbeatTimeout,
	} {
		if value := os.Getenv(name); value != "" {
			parsed, err := time.ParseDuration(value)
			if err != nil || parsed <= 0 || parsed > 24*time.Hour {
				return Config{}, errors.New("invalid duration configuration")
			}
			*target = parsed
		}
	}
	for name, target := range map[string]*int{
		"MAX_ROOMS": &config.MaxRooms, "MAX_CONNECTIONS": &config.MaxConnections,
		"CREATE_RATE_PER_MINUTE":  &config.CreateRatePerMinute,
		"UPGRADE_RATE_PER_MINUTE": &config.UpgradeRatePerMinute,
		"MESSAGE_RATE_PER_SECOND": &config.MessageRatePerSecond,
	} {
		if value := os.Getenv(name); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed <= 0 || parsed > 1_000_000 {
				return Config{}, errors.New("invalid capacity configuration")
			}
			*target = parsed
		}
	}
	for i, origin := range config.AllowedOrigins {
		origin = strings.TrimSpace(origin)
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" ||
			parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(origin, "*") {
			return Config{}, errors.New("invalid origin configuration")
		}
		config.AllowedOrigins[i] = origin
	}
	return config, nil
}
