export const MAX_PLAINTEXT_BYTES = 2_048;
export const MAX_FRAME_BYTES = 8_192;
export const MAX_MESSAGES_PER_DIRECTION = 10_000;

export type Role = "A" | "B";
export type Direction = "A_TO_B" | "B_TO_A";
export type RoomDestroyedReason =
  "destroyed" | "disconnected" | "expired" | "protocol_error" | "slow_client";

export const ERROR_CODES = [
  "ROOM_NOT_FOUND_OR_EXPIRED",
  "ROOM_FULL",
  "AUTH_FAILED",
  "RATE_LIMITED",
  "PROTOCOL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface CiphertextEnvelope {
  v: 1;
  kind: "ciphertext";
  roomId: string;
  direction: Direction;
  seq: number;
  iv: string;
  ciphertext: string;
}

export interface RoomCreatedResponse {
  roomId: string;
  creatorToken: string;
  inviteToken: string;
  expiresAt: string;
  idleTimeoutSeconds: number;
}

export type ClientMessage =
  | { v: 1; kind: "auth"; token: string }
  | { v: 1; kind: "destroy" }
  | CiphertextEnvelope;

export type ServerMessage =
  | { v: 1; kind: "joined"; role: Role; roomId: string; expiresAt: string }
  | { v: 1; kind: "peer_ready" }
  | { v: 1; kind: "room_destroyed"; reason: RoomDestroyedReason }
  | { v: 1; kind: "error"; code: ErrorCode }
  | CiphertextEnvelope;

export interface InviteMaterial {
  roomSecret: Uint8Array;
  inviteToken: string;
}

export class ProtocolError extends Error {
  readonly code: string;

  constructor(code = "PROTOCOL_ERROR") {
    super(code);
    this.name = "ProtocolError";
    this.code = code;
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeBase64Url(
  value: string,
  expectedLength?: number,
): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_FRAME_BYTES ||
    (expectedLength !== undefined &&
      value.length !== Math.ceil((expectedLength * 4) / 3)) ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new ProtocolError();
  }
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (
      (expectedLength !== undefined && bytes.length !== expectedLength) ||
      encodeBase64Url(bytes) !== value
    ) {
      throw new ProtocolError();
    }
    return bytes;
  } catch {
    throw new ProtocolError();
  }
}

export function parseInviteFragment(hash: string): InviteMaterial {
  let roomSecret: Uint8Array | undefined;
  try {
    if (typeof hash !== "string" || hash.length > 128)
      throw new ProtocolError();
    const fields = new URLSearchParams(
      hash.startsWith("#") ? hash.slice(1) : hash,
    );
    if (
      [...fields].length !== 2 ||
      fields.getAll("s").length !== 1 ||
      fields.getAll("t").length !== 1
    ) {
      throw new ProtocolError();
    }
    roomSecret = decodeBase64Url(fields.get("s")!, 32);
    const inviteToken = fields.get("t")!;
    decodeBase64Url(inviteToken, 32).fill(0);
    return { roomSecret, inviteToken };
  } catch {
    roomSecret?.fill(0);
    throw new ProtocolError("INVALID_INVITE");
  }
}

export function buildInviteUrl(
  origin: string,
  roomId: string,
  roomSecret: Uint8Array,
  inviteToken: string,
): string {
  decodeBase64Url(roomId, 16);
  decodeBase64Url(inviteToken, 32).fill(0);
  if (!(roomSecret instanceof Uint8Array) || roomSecret.byteLength !== 32) {
    throw new ProtocolError("INVALID_INVITE");
  }
  const url = new URL(origin);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProtocolError("INVALID_INVITE");
  }
  const invite = new URL(`/r/${roomId}`, url.origin);
  invite.hash = new URLSearchParams({
    s: encodeBase64Url(roomSecret),
    t: inviteToken,
  }).toString();
  return invite.href;
}

function objectWithFields(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProtocolError();
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  ) {
    throw new ProtocolError();
  }
  return object;
}

function validExpiry(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function parseFlatJSON(raw: string): Record<string, unknown> {
  if (
    typeof raw !== "string" ||
    raw.length > MAX_FRAME_BYTES ||
    new TextEncoder().encode(raw).length > MAX_FRAME_BYTES
  ) {
    throw new ProtocolError();
  }
  try {
    const keys = new Set<string>();
    let objectSeen = false;
    // Validate before JSON.parse can erase duplicate fields, including escaped names.
    visit(
      raw,
      {
        onObjectBegin() {
          if (objectSeen) throw new ProtocolError();
          objectSeen = true;
        },
        onObjectProperty(key) {
          if (keys.has(key)) throw new ProtocolError();
          keys.add(key);
        },
        onArrayBegin() {
          throw new ProtocolError();
        },
        onError() {
          throw new ProtocolError();
        },
      },
      {
        disallowComments: true,
        allowTrailingComma: false,
        allowEmptyContent: false,
      },
    );
    const value: unknown = JSON.parse(raw);
    if (
      !objectSeen ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw new ProtocolError();
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ProtocolError();
  }
}

export function parseCiphertextEnvelope(value: unknown): CiphertextEnvelope {
  const object = objectWithFields(value, [
    "v",
    "kind",
    "roomId",
    "direction",
    "seq",
    "iv",
    "ciphertext",
  ]);
  if (
    object.v !== 1 ||
    object.kind !== "ciphertext" ||
    typeof object.roomId !== "string" ||
    (object.direction !== "A_TO_B" && object.direction !== "B_TO_A") ||
    typeof object.seq !== "number" ||
    !Number.isInteger(object.seq) ||
    object.seq < 1 ||
    object.seq > MAX_MESSAGES_PER_DIRECTION ||
    typeof object.iv !== "string" ||
    typeof object.ciphertext !== "string" ||
    object.ciphertext.length < 23 ||
    object.ciphertext.length > Math.ceil(((MAX_PLAINTEXT_BYTES + 16) * 4) / 3)
  ) {
    throw new ProtocolError();
  }
  decodeBase64Url(object.roomId, 16);
  decodeBase64Url(object.iv, 12);
  const ciphertext = decodeBase64Url(object.ciphertext);
  if (ciphertext.length < 17 || ciphertext.length > MAX_PLAINTEXT_BYTES + 16) {
    throw new ProtocolError();
  }
  return {
    v: 1,
    kind: "ciphertext",
    roomId: object.roomId,
    direction: object.direction,
    seq: object.seq,
    iv: object.iv,
    ciphertext: object.ciphertext,
  };
}

export function parseRoomCreatedResponse(value: unknown): RoomCreatedResponse {
  const object = objectWithFields(
    typeof value === "string" ? parseFlatJSON(value) : value,
    [
      "roomId",
      "creatorToken",
      "inviteToken",
      "expiresAt",
      "idleTimeoutSeconds",
    ],
  );
  if (
    typeof object.roomId !== "string" ||
    typeof object.creatorToken !== "string" ||
    typeof object.inviteToken !== "string" ||
    !validExpiry(object.expiresAt) ||
    typeof object.idleTimeoutSeconds !== "number" ||
    !Number.isInteger(object.idleTimeoutSeconds) ||
    object.idleTimeoutSeconds < 1
  ) {
    throw new ProtocolError();
  }
  decodeBase64Url(object.roomId, 16);
  decodeBase64Url(object.creatorToken, 32).fill(0);
  decodeBase64Url(object.inviteToken, 32).fill(0);
  return {
    roomId: object.roomId,
    creatorToken: object.creatorToken,
    inviteToken: object.inviteToken,
    expiresAt: object.expiresAt,
    idleTimeoutSeconds: object.idleTimeoutSeconds,
  };
}

export function parseServerMessage(raw: string): ServerMessage {
  const object = parseFlatJSON(raw);
  if (object.v !== 1) throw new ProtocolError();
  switch (object.kind) {
    case "ciphertext":
      return parseCiphertextEnvelope(object);
    case "joined": {
      objectWithFields(object, ["v", "kind", "role", "roomId", "expiresAt"]);
      if (
        (object.role !== "A" && object.role !== "B") ||
        typeof object.roomId !== "string" ||
        !validExpiry(object.expiresAt)
      ) {
        throw new ProtocolError();
      }
      decodeBase64Url(object.roomId, 16);
      return {
        v: 1,
        kind: "joined",
        role: object.role,
        roomId: object.roomId,
        expiresAt: object.expiresAt,
      };
    }
    case "peer_ready":
      objectWithFields(object, ["v", "kind"]);
      return { v: 1, kind: "peer_ready" };
    case "room_destroyed": {
      objectWithFields(object, ["v", "kind", "reason"]);
      const reasons: readonly unknown[] = [
        "destroyed",
        "disconnected",
        "expired",
        "protocol_error",
        "slow_client",
      ];
      if (!reasons.includes(object.reason)) throw new ProtocolError();
      return {
        v: 1,
        kind: "room_destroyed",
        reason: object.reason as RoomDestroyedReason,
      };
    }
    case "error":
      objectWithFields(object, ["v", "kind", "code"]);
      if (!ERROR_CODES.includes(object.code as ErrorCode))
        throw new ProtocolError();
      return { v: 1, kind: "error", code: object.code as ErrorCode };
    default:
      throw new ProtocolError();
  }
}
import { visit } from "jsonc-parser";
