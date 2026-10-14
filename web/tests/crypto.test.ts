import { createCipheriv, hkdfSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecret, CryptoSession } from "../src/crypto";
import {
  decodeBase64Url,
  encodeBase64Url,
  MAX_MESSAGES_PER_DIRECTION,
  MAX_PLAINTEXT_BYTES,
  type CiphertextEnvelope,
} from "../src/protocol";

const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
const roomId = "AAECAwQFBgcICQoLDA0ODw";
const otherRoom = encodeBase64Url(new Uint8Array(16).fill(99));
const iv = Uint8Array.from({ length: 12 }, (_, index) => index);

function fixedIVs() {
  return vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    if (!(array instanceof Uint8Array) || array.byteLength !== 12)
      throw new Error("Unexpected test RNG request");
    array.set(iv);
    return array;
  });
}

function independentEnvelope(
  plaintext: Uint8Array,
  seq = 1,
  additionalData = [1, "ciphertext", roomId, "A_TO_B", seq],
): CiphertextEnvelope {
  const key = hkdfSync(
    "sha256",
    secret,
    Buffer.from(`GhostChat/crypto/v1/room/${roomId}`),
    Buffer.from("GhostChat/crypto/v1/key/A_TO_B"),
    32,
  );
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), iv, {
    authTagLength: 16,
  });
  cipher.setAAD(Buffer.from(JSON.stringify(additionalData)));
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    v: 1,
    kind: "ciphertext",
    roomId,
    direction: "A_TO_B",
    seq,
    iv: encodeBase64Url(iv),
    ciphertext: encrypted.toString("base64url"),
  };
}

async function pair() {
  return Promise.all([
    CryptoSession.create(secret, roomId, "A"),
    CryptoSession.create(secret, roomId, "B"),
  ]);
}

afterEach(() => vi.restoreAllMocks());

describe("Web Crypto version 1", () => {
  it("generates independent 256-bit secrets", () => {
    const first = createSecret();
    const second = createSecret();
    expect(first.byteLength).toBe(32);
    expect(second.byteLength).toBe(32);
    expect(first).not.toEqual(second);
  });

  it("matches an independently calculated HKDF/AES-GCM test vector", async () => {
    const [a, b] = await pair();
    fixedIVs();
    const message = await a.encrypt("Protocol v1 fixture");
    expect(message).toEqual({
      v: 1,
      kind: "ciphertext",
      roomId,
      direction: "A_TO_B",
      seq: 1,
      iv: "AAECAwQFBgcICQoL",
      ciphertext: "a3UpqDvbedHqvEd-gyg2APjn2KqMn8vUe3dXEigSdeLtf_4",
    });
    expect(message).toEqual(
      independentEnvelope(new TextEncoder().encode("Protocol v1 fixture")),
    );
    await expect(b.decrypt(message)).resolves.toBe("Protocol v1 fixture");
  });

  it("round trips Chinese, English, emoji, whitespace and markup in both directions", async () => {
    const [a, b] = await pair();
    const messages = [
      "\u4e2d\u6587 English \ud83d\udc7b",
      "  spaces\n\t ",
      "<img src=x onerror=alert(1)>",
      "\ufeffleading BOM",
    ];
    for (const text of messages) {
      await expect(b.decrypt(await a.encrypt(text))).resolves.toBe(text);
      await expect(a.decrypt(await b.encrypt(text))).resolves.toBe(text);
    }
  });

  it("uses different direction keys even with identical IV and plaintext", async () => {
    const [a, b] = await pair();
    fixedIVs();
    const forward = decodeBase64Url((await a.encrypt("same text")).ciphertext);
    const reverse = decodeBase64Url((await b.encrypt("same text")).ciphertext);
    // AAD only changes the tag; different ciphertext bodies establish key separation.
    expect(forward.slice(0, -16)).not.toEqual(reverse.slice(0, -16));
  });

  it("keeps AES keys nonextractable with only the direction-specific operation", async () => {
    const derive = vi.spyOn(crypto.subtle, "deriveKey");
    await CryptoSession.create(secret, roomId, "A");
    const keys = await Promise.all(
      derive.mock.results.map((result) => result.value as Promise<CryptoKey>),
    );
    expect(keys).toHaveLength(2);
    expect(keys.map((key) => key.extractable)).toEqual([false, false]);
    expect(keys.map((key) => key.usages)).toEqual([["encrypt"], ["decrypt"]]);
  });

  it("does not take ownership of the caller secret", async () => {
    const material = new Uint8Array(secret);
    const session = await CryptoSession.create(material, roomId, "A");
    expect(material).toEqual(secret);
    material.fill(0);
    const b = await CryptoSession.create(secret, roomId, "B");
    await expect(
      b.decrypt(await session.encrypt("caller wiped secret")),
    ).resolves.toBe("caller wiped secret");
  });

  it("rejects invalid key material and room identifiers", async () => {
    await expect(
      CryptoSession.create(new Uint8Array(31), roomId, "A"),
    ).rejects.toThrow();
    await expect(
      CryptoSession.create(secret, "invalid", "A"),
    ).rejects.toThrow();
  });

  it("rejects the wrong room secret and closes the crypto session", async () => {
    const a = await CryptoSession.create(secret, roomId, "A");
    const b = await CryptoSession.create(
      new Uint8Array(32).fill(42),
      roomId,
      "B",
    );
    await expect(b.decrypt(await a.encrypt("never exposed"))).rejects.toThrow(
      "DECRYPTION_FAILED",
    );
    await expect(b.encrypt("after failure")).rejects.toThrow(
      "SESSION_DISPOSED",
    );
  });

  it.each(["ciphertext", "iv", "roomId", "direction", "seq", "v"] as const)(
    "rejects tampered %s and cannot resume",
    async (field) => {
      const [a, b] = await pair();
      const message = await a.encrypt("not displayed");
      const tampered = { ...message };
      switch (field) {
        case "ciphertext": {
          const bytes = decodeBase64Url(message.ciphertext);
          bytes[0] ^= 1;
          tampered.ciphertext = encodeBase64Url(bytes);
          break;
        }
        case "iv": {
          const bytes = decodeBase64Url(message.iv);
          bytes[0] ^= 1;
          tampered.iv = encodeBase64Url(bytes);
          break;
        }
        case "roomId":
          tampered.roomId = otherRoom;
          break;
        case "direction":
          tampered.direction = "B_TO_A";
          break;
        case "seq":
          tampered.seq = 2;
          break;
        case "v":
          Object.assign(tampered, { v: 2 });
          break;
      }
      await expect(b.decrypt(tampered)).rejects.toThrow();
      await expect(b.decrypt(message)).rejects.toThrow("SESSION_DISPOSED");
    },
  );

  it.each([
    [2, "ciphertext", roomId, "A_TO_B", 1],
    [1, "ciphertext", otherRoom, "A_TO_B", 1],
    [1, "ciphertext", roomId, "B_TO_A", 1],
    [1, "ciphertext", roomId, "A_TO_B", 2],
  ])("authenticates the precise AAD bytes %j", async (...additionalData) => {
    const b = await CryptoSession.create(secret, roomId, "B");
    const message = independentEnvelope(
      new TextEncoder().encode("AAD test"),
      1,
      additionalData,
    );
    await expect(b.decrypt(message)).rejects.toThrow("DECRYPTION_FAILED");
  });

  it("rejects replay and out-of-order delivery", async () => {
    const [a, b] = await pair();
    const first = await a.encrypt("first");
    await expect(b.decrypt(first)).resolves.toBe("first");
    await expect(b.decrypt(first)).rejects.toThrow("SEQUENCE_ERROR");
    const receiver = await CryptoSession.create(secret, roomId, "B");
    await expect(receiver.decrypt(await a.encrypt("second"))).rejects.toThrow(
      "SEQUENCE_ERROR",
    );
  });

  it("measures the 2 KiB limit as UTF-8 bytes and preserves the exact boundary", async () => {
    const [a, b] = await pair();
    const boundary = "\u4e2d".repeat(682) + "ab";
    expect(new TextEncoder().encode(boundary).length).toBe(MAX_PLAINTEXT_BYTES);
    await expect(b.decrypt(await a.encrypt(boundary))).resolves.toBe(boundary);
    await expect(a.encrypt(boundary + "c")).rejects.toThrow(
      "MESSAGE_TOO_LARGE",
    );
    await expect(a.encrypt("later")).rejects.toThrow("SESSION_DISPOSED");
  });

  it("rejects authenticated payloads that are not valid UTF-8", async () => {
    const b = await CryptoSession.create(secret, roomId, "B");
    await expect(
      b.decrypt(independentEnvelope(Uint8Array.of(0xc0, 0xaf))),
    ).rejects.toThrow("DECRYPTION_FAILED");
  });

  it("rejects empty plaintext on both boundaries while preserving a single space", async () => {
    const [a, b] = await pair();
    await expect(b.decrypt(await a.encrypt(" "))).resolves.toBe(" ");
    const primitive = vi.spyOn(crypto.subtle, "encrypt");
    const rejected = a.encrypt("");
    await expect(rejected).rejects.toThrow("INVALID_MESSAGE");
    expect(primitive).not.toHaveBeenCalled();
    await expect(a.encrypt("after failure")).rejects.toThrow(
      "SESSION_DISPOSED",
    );
    const receiver = await CryptoSession.create(secret, roomId, "B");
    await expect(
      receiver.decrypt(independentEnvelope(new Uint8Array())),
    ).rejects.toThrow("PROTOCOL_ERROR");
    await expect(receiver.encrypt("after failure")).rejects.toThrow(
      "SESSION_DISPOSED",
    );
  });

  it("rejects malformed UTF-16 input instead of silently replacing characters", async () => {
    const a = await CryptoSession.create(secret, roomId, "A");
    await expect(a.encrypt("\ud800")).rejects.toThrow("INVALID_MESSAGE");
  });

  it("serializes concurrent sends and receives with strict sequences and unique IVs", async () => {
    const [a, b] = await pair();
    const messages = await Promise.all(
      Array.from({ length: 32 }, (_, index) => a.encrypt(`message ${index}`)),
    );
    expect(messages.map((message) => message.seq)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1),
    );
    expect(new Set(messages.map((message) => message.iv)).size).toBe(32);
    await expect(
      Promise.all(messages.map((message) => b.decrypt(message))),
    ).resolves.toEqual(
      Array.from({ length: 32 }, (_, index) => `message ${index}`),
    );
  });

  it("fails closed when the random source repeats an IV", async () => {
    const a = await CryptoSession.create(secret, roomId, "A");
    fixedIVs();
    await a.encrypt("first");
    await expect(a.encrypt("second")).rejects.toThrow("NONCE_COLLISION");
    await expect(a.encrypt("third")).rejects.toThrow("SESSION_DISPOSED");
  });

  it("rejects an authenticated IV reuse with a new sequence", async () => {
    const b = await CryptoSession.create(secret, roomId, "B");
    await b.decrypt(independentEnvelope(new TextEncoder().encode("first"), 1));
    await expect(
      b.decrypt(independentEnvelope(new TextEncoder().encode("second"), 2)),
    ).rejects.toThrow("SEQUENCE_ERROR");
  });

  it("stops at the bounded per-direction message limit", async () => {
    const a = await CryptoSession.create(secret, roomId, "A");
    let counter = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      if (!(array instanceof Uint8Array))
        throw new Error("Unexpected test RNG request");
      new DataView(array.buffer, array.byteOffset, array.byteLength).setUint32(
        0,
        ++counter,
      );
      return array;
    });
    const primitive = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockResolvedValue(new ArrayBuffer(16));
    for (let index = 0; index < MAX_MESSAGES_PER_DIRECTION; index++)
      await a.encrypt("bounded");
    await expect(a.encrypt("over limit")).rejects.toThrow("MESSAGE_LIMIT");
    expect(primitive).toHaveBeenCalledTimes(MAX_MESSAGES_PER_DIRECTION);
  });

  it("makes disposal idempotent and rejects queued operations", async () => {
    const [a, b] = await pair();
    const message = await a.encrypt("fixture");
    const queued = b.decrypt(message);
    b.dispose();
    b.dispose();
    await expect(queued).rejects.toThrow("SESSION_DISPOSED");
    await expect(b.encrypt("after disposal")).rejects.toThrow(
      "SESSION_DISPOSED",
    );
  });

  it("does not release an in-flight plaintext after disposal and wipes decrypted bytes", async () => {
    const [a, b] = await pair();
    const message = await a.encrypt("in-flight plaintext");
    let complete!: (value: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>((resolve) => {
      complete = resolve;
    });
    const primitive = vi
      .spyOn(crypto.subtle, "decrypt")
      .mockReturnValueOnce(pending);
    const operation = b.decrypt(message);
    await vi.waitFor(() => expect(primitive).toHaveBeenCalledTimes(1));
    b.dispose();
    const plaintext = new TextEncoder().encode("in-flight plaintext");
    complete(plaintext.buffer);
    await expect(operation).rejects.toThrow("SESSION_DISPOSED");
    expect(plaintext.every((byte) => byte === 0)).toBe(true);
  });
});
