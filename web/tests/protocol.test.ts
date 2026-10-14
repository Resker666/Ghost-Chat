import { describe, expect, it } from "vitest";
import {
  buildInviteUrl,
  decodeBase64Url,
  encodeBase64Url,
  MAX_FRAME_BYTES,
  parseCiphertextEnvelope,
  parseInviteFragment,
  parseRoomCreatedResponse,
  parseServerMessage,
  ProtocolError,
} from "../src/protocol";

const roomId = encodeBase64Url(
  Uint8Array.from({ length: 16 }, (_, index) => index),
);
const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
const token = encodeBase64Url(new Uint8Array(32).fill(81));
const envelope = {
  v: 1,
  kind: "ciphertext",
  roomId,
  direction: "A_TO_B",
  seq: 1,
  iv: encodeBase64Url(new Uint8Array(12)),
  ciphertext: encodeBase64Url(new Uint8Array(17)),
};

describe("canonical base64url and invitations", () => {
  it("round trips bytes without padding", () => {
    expect(encodeBase64Url(secret)).not.toContain("=");
    expect(decodeBase64Url(encodeBase64Url(secret), 32)).toEqual(secret);
  });

  it.each(["", "AA==", "A", "+AAA", "/AAA", "AB", "AA\n", "AA%"])(
    "rejects noncanonical encoding %j",
    (value) => {
      expect(() => decodeBase64Url(value)).toThrow(ProtocolError);
    },
  );

  it("checks decoded byte length", () => {
    expect(() => decodeBase64Url(token, 16)).toThrow(ProtocolError);
  });

  it("puts both secrets in the fragment and parses without accessing browser state", () => {
    const url = new URL(
      buildInviteUrl("https://chat.example", roomId, secret, token),
    );
    expect(url.pathname).toBe(`/r/${roomId}`);
    expect(url.search).toBe("");
    expect(parseInviteFragment(url.hash)).toEqual({
      roomSecret: secret,
      inviteToken: token,
    });
    expect(
      parseInviteFragment(`#t=${token}&s=${encodeBase64Url(secret)}`)
        .roomSecret,
    ).toEqual(secret);
  });

  it.each([
    "",
    "#s=AA&t=AA",
    `#s=${encodeBase64Url(secret)}&t=${token}&t=${token}`,
    `#s=${encodeBase64Url(secret)}&t=${token}&extra=1`,
    `#s=${encodeBase64Url(secret)}&t=${token}=`,
  ])("rejects missing, duplicate or unexpected invitation fields", (hash) => {
    expect(() => parseInviteFragment(hash)).toThrow("INVALID_INVITE");
  });

  it("rejects a non-web invitation origin", () => {
    expect(() =>
      buildInviteUrl("javascript:alert(1)", roomId, secret, token),
    ).toThrow(ProtocolError);
  });
});

describe("untrusted wire messages", () => {
  it("accepts the versioned bounded ciphertext envelope", () => {
    expect(parseCiphertextEnvelope(envelope)).toEqual(envelope);
    expect(parseServerMessage(JSON.stringify(envelope))).toEqual(envelope);
  });

  it.each([
    { v: 2 },
    { kind: "plaintext" },
    { roomId: token },
    { direction: "A" },
    { seq: 0 },
    { seq: 1.1 },
    { seq: 10_001 },
    { seq: "1" },
    { iv: encodeBase64Url(new Uint8Array(11)) },
    { ciphertext: encodeBase64Url(new Uint8Array(16)) },
    { ciphertext: encodeBase64Url(new Uint8Array(2_065)) },
    { plaintext: "not allowed" },
  ])("rejects malformed envelope fields %j", (patch) => {
    expect(() => parseCiphertextEnvelope({ ...envelope, ...patch })).toThrow(
      ProtocolError,
    );
  });

  it("accepts only server control messages with exact fields", () => {
    const messages = [
      {
        v: 1,
        kind: "joined",
        role: "B",
        roomId,
        expiresAt: "2026-10-14T09:00:00.123456789Z",
      },
      { v: 1, kind: "peer_ready" },
      { v: 1, kind: "room_destroyed", reason: "disconnected" },
      { v: 1, kind: "error", code: "AUTH_FAILED" },
    ];
    for (const message of messages) {
      expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
    }
  });

  it.each([
    "{",
    "null",
    "[]",
    "true",
    '{"v":1,"kind":"auth","token":"secret"}',
    '{"v":1,"kind":"peer_ready","plaintext":"no"}',
    '{"v":1,"kind":"room_destroyed","reason":"unknown"}',
    '{"v":1,"kind":"error","code":"secret content"}',
  ])(
    "rejects invalid JSON, client controls and unknown fields without echoing input",
    (raw) => {
      expect(() => parseServerMessage(raw)).toThrow("PROTOCOL_ERROR");
    },
  );

  it("checks UTF-8 bytes before JSON parsing", () => {
    const raw = JSON.stringify({
      ...envelope,
      extra: "\u4e2d".repeat(MAX_FRAME_BYTES / 2),
    });
    expect(raw.length).toBeLessThan(MAX_FRAME_BYTES);
    expect(() => parseServerMessage(raw)).toThrow(ProtocolError);
  });

  it.each([
    '{"v":2,"v":1,"kind":"peer_ready"}',
    '{"v":2,"\\u0076":1,"kind":"peer_ready"}',
    '{"v":1,/* comment */"kind":"peer_ready"}',
    '{"v":1,"kind":"peer_ready",}',
    '{"v":1,"kind":"error","code":{"value":"AUTH_FAILED"}}',
    '{"v":1,"kind":"error","code":["AUTH_FAILED"]}',
    '{"v":1,"kind":"peer_ready"} {}',
  ])("rejects ambiguous JSON and JSONC extensions", (raw) => {
    expect(() => parseServerMessage(raw)).toThrow("PROTOCOL_ERROR");
  });

  it("accepts one escaped property name without weakening duplicate checks", () => {
    expect(parseServerMessage('{"\\u0076":1,"kind":"peer_ready"}')).toEqual({
      v: 1,
      kind: "peer_ready",
    });
  });

  it("validates create-room responses and prohibits extra secrets", () => {
    const response = {
      roomId,
      creatorToken: token,
      inviteToken: token,
      expiresAt: "2026-10-14T09:00:00Z",
      idleTimeoutSeconds: 600,
    };
    expect(parseRoomCreatedResponse(response)).toEqual(response);
    expect(parseRoomCreatedResponse(JSON.stringify(response))).toEqual(
      response,
    );
    const duplicate = JSON.stringify(response).replace(
      "{",
      `{"\\u0072oomId":"${roomId}",`,
    );
    expect(() => parseRoomCreatedResponse(duplicate)).toThrow(ProtocolError);
    expect(() =>
      parseRoomCreatedResponse({ ...response, roomSecret: token }),
    ).toThrow(ProtocolError);
    expect(() =>
      parseRoomCreatedResponse({ ...response, expiresAt: "tomorrow" }),
    ).toThrow(ProtocolError);
    expect(() =>
      parseRoomCreatedResponse({ ...response, idleTimeoutSeconds: 0 }),
    ).toThrow(ProtocolError);
  });
});
