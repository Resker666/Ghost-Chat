package protocol

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

const MaxFrameBytes = 8192
const MaxMessages = 10000

var ErrInvalid = errors.New("invalid protocol message")

type Message struct {
	Version    int    `json:"v"`
	Kind       string `json:"kind"`
	Token      string `json:"token,omitempty"`
	RoomID     string `json:"roomId,omitempty"`
	Direction  string `json:"direction,omitempty"`
	Sequence   uint64 `json:"seq,omitempty"`
	IV         string `json:"iv,omitempty"`
	Ciphertext string `json:"ciphertext,omitempty"`
}

// Decode checks exact field names and duplicates before decoding typed values.
func Decode(raw []byte) (Message, error) {
	var message Message
	if len(raw) > MaxFrameBytes || !utf8.Valid(raw) {
		return message, ErrInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return message, ErrInvalid
	}
	fields := make(map[string]json.RawMessage)
	for decoder.More() {
		token, err := decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok {
			return message, ErrInvalid
		}
		if _, duplicate := fields[key]; duplicate {
			return message, ErrInvalid
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return message, ErrInvalid
		}
		fields[key] = value
	}
	if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
		return message, ErrInvalid
	}
	if decoder.Decode(new(any)) != io.EOF {
		return message, ErrInvalid
	}
	if json.Unmarshal(raw, &message) != nil || message.Version != 1 {
		return message, ErrInvalid
	}
	var expected []string
	switch message.Kind {
	case "auth":
		expected = []string{"v", "kind", "token"}
		if !CanonicalBase64(message.Token, 32, 32) {
			return message, ErrInvalid
		}
	case "destroy":
		expected = []string{"v", "kind"}
	case "ciphertext":
		expected = []string{"v", "kind", "roomId", "direction", "seq", "iv", "ciphertext"}
		if !CanonicalBase64(message.RoomID, 16, 16) ||
			(message.Direction != "A_TO_B" && message.Direction != "B_TO_A") ||
			message.Sequence == 0 || message.Sequence > MaxMessages ||
			!CanonicalBase64(message.IV, 12, 12) ||
			!CanonicalBase64(message.Ciphertext, 17, 2064) {
			return message, ErrInvalid
		}
	default:
		return message, ErrInvalid
	}
	if len(fields) != len(expected) {
		return message, ErrInvalid
	}
	for _, key := range expected {
		value, exists := fields[key]
		if !exists || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return message, ErrInvalid
		}
	}
	return message, nil
}

func CanonicalBase64(value string, minBytes, maxBytes int) bool {
	if len(value) > (maxBytes*8+5)/6 {
		return false
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	return err == nil && len(decoded) >= minBytes && len(decoded) <= maxBytes &&
		base64.RawURLEncoding.EncodeToString(decoded) == value
}

func Event(kind string) []byte {
	data, _ := json.Marshal(struct {
		Version int    `json:"v"`
		Kind    string `json:"kind"`
	}{1, kind})
	return data
}

func Error(code string) []byte {
	data, _ := json.Marshal(struct {
		Version int    `json:"v"`
		Kind    string `json:"kind"`
		Code    string `json:"code"`
	}{1, "error", code})
	return data
}

func Destroyed(reason string) []byte {
	data, _ := json.Marshal(struct {
		Version int    `json:"v"`
		Kind    string `json:"kind"`
		Reason  string `json:"reason"`
	}{1, "room_destroyed", reason})
	return data
}
