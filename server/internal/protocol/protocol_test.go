package protocol

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func validCiphertext() Message {
	return Message{Version: 1, Kind: "ciphertext", RoomID: base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		Direction: "A_TO_B", Sequence: 1, IV: base64.RawURLEncoding.EncodeToString(make([]byte, 12)),
		Ciphertext: base64.RawURLEncoding.EncodeToString(make([]byte, 17))}
}

func TestDecodeAcceptedMessages(t *testing.T) {
	for _, message := range []Message{
		{Version: 1, Kind: "auth", Token: base64.RawURLEncoding.EncodeToString(make([]byte, 32))},
		{Version: 1, Kind: "destroy"}, validCiphertext(),
	} {
		raw, _ := json.Marshal(message)
		if _, err := Decode(raw); err != nil {
			t.Fatalf("valid %s rejected", message.Kind)
		}
	}
	message := validCiphertext()
	message.Ciphertext = base64.RawURLEncoding.EncodeToString(make([]byte, 2064))
	raw, _ := json.Marshal(message)
	if _, err := Decode(raw); err != nil {
		t.Fatal("maximum ciphertext rejected")
	}
}

func TestDecodeRejectsMalformedSchemas(t *testing.T) {
	for name, raw := range map[string]string{
		"duplicate":         `{"v":1,"v":1,"kind":"destroy"}`,
		"escaped duplicate": `{"v":1,"\u0076":1,"kind":"destroy"}`,
		"unknown":           `{"v":1,"kind":"destroy","extra":true}`,
		"case":              `{"V":1,"kind":"destroy"}`,
		"null":              `{"v":1,"kind":null}`,
		"wrong version":     `{"v":2,"kind":"destroy"}`,
		"floating version":  `{"v":1.0,"kind":"destroy"}`,
		"array":             `[]`, "empty": `{}`, "trailing": `{"v":1,"kind":"destroy"}{}`,
		"server event": `{"v":1,"kind":"peer_ready"}`,
		"nested":       `{"v":1,"kind":"destroy","data":{"a":1}}`,
		"oversize":     strings.Repeat(" ", MaxFrameBytes+1),
		"invalid utf8": string([]byte{0xff}),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Decode([]byte(raw)); err == nil {
				t.Fatal("invalid frame accepted")
			}
		})
	}
}

func TestDecodeCiphertextBounds(t *testing.T) {
	tests := map[string]func(*Message){
		"zero sequence":        func(m *Message) { m.Sequence = 0 },
		"sequence limit":       func(m *Message) { m.Sequence = MaxMessages + 1 },
		"short iv":             func(m *Message) { m.IV = base64.RawURLEncoding.EncodeToString(make([]byte, 11)) },
		"padded iv":            func(m *Message) { m.IV += "=" },
		"ciphertext tag only":  func(m *Message) { m.Ciphertext = base64.RawURLEncoding.EncodeToString(make([]byte, 16)) },
		"ciphertext oversized": func(m *Message) { m.Ciphertext = base64.RawURLEncoding.EncodeToString(make([]byte, 2065)) },
		"direction":            func(m *Message) { m.Direction = "B_TO_C" },
		"room":                 func(m *Message) { m.RoomID = "invalid" },
		"noncanonical":         func(m *Message) { m.Ciphertext = strings.Repeat("A", 22) + "B" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			message := validCiphertext()
			mutate(&message)
			raw, _ := json.Marshal(message)
			if _, err := Decode(raw); err == nil {
				t.Fatal("invalid ciphertext accepted")
			}
		})
	}
}
