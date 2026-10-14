import {
  decodeBase64Url,
  encodeBase64Url,
  MAX_MESSAGES_PER_DIRECTION,
  MAX_PLAINTEXT_BYTES,
  parseCiphertextEnvelope,
  ProtocolError,
  type CiphertextEnvelope,
  type Direction,
  type Role,
} from "../protocol";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function createSecret(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

function aad(
  roomId: string,
  direction: Direction,
  seq: number,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify([1, "ciphertext", roomId, direction, seq]),
  );
}

export class CryptoSession {
  private sendKey: CryptoKey | null;
  private receiveKey: CryptoKey | null;
  private sendSequence = 0;
  private receiveSequence = 0;
  private readonly sentIVs = new Set<string>();
  private readonly receivedIVs = new Set<string>();
  private sendTail: Promise<void> = Promise.resolve();
  private receiveTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly roomId: string,
    private readonly sendDirection: Direction,
    private readonly receiveDirection: Direction,
    sendKey: CryptoKey,
    receiveKey: CryptoKey,
  ) {
    this.sendKey = sendKey;
    this.receiveKey = receiveKey;
  }

  static async create(
    roomSecret: Uint8Array,
    roomId: string,
    role: Role,
  ): Promise<CryptoSession> {
    decodeBase64Url(roomId, 16);
    if (
      !(roomSecret instanceof Uint8Array) ||
      roomSecret.byteLength !== 32 ||
      (role !== "A" && role !== "B")
    ) {
      throw new ProtocolError("INVALID_CRYPTO_MATERIAL");
    }
    const material = new Uint8Array(roomSecret);
    try {
      const root = await crypto.subtle.importKey(
        "raw",
        material,
        "HKDF",
        false,
        ["deriveKey"],
      );
      material.fill(0);
      const sendDirection = role === "A" ? "A_TO_B" : "B_TO_A";
      const receiveDirection = role === "A" ? "B_TO_A" : "A_TO_B";
      const derive = (direction: Direction, usage: KeyUsage) =>
        crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: encoder.encode(`GhostChat/crypto/v1/room/${roomId}`),
            info: encoder.encode(`GhostChat/crypto/v1/key/${direction}`),
          },
          root,
          { name: "AES-GCM", length: 256 },
          false,
          [usage],
        );
      const [sendKey, receiveKey] = await Promise.all([
        derive(sendDirection, "encrypt"),
        derive(receiveDirection, "decrypt"),
      ]);
      return new CryptoSession(
        roomId,
        sendDirection,
        receiveDirection,
        sendKey,
        receiveKey,
      );
    } catch {
      throw new ProtocolError("CRYPTO_UNAVAILABLE");
    } finally {
      material.fill(0);
    }
  }

  private assertActive(): void {
    if (!this.sendKey || !this.receiveKey)
      throw new ProtocolError("SESSION_DISPOSED");
  }

  encrypt(text: string): Promise<CiphertextEnvelope> {
    if (typeof text !== "string" || text.length === 0) {
      this.dispose();
      return Promise.reject(new ProtocolError("INVALID_MESSAGE"));
    }
    const operation = this.sendTail.then(async () => {
      this.assertActive();
      let plaintext: Uint8Array<ArrayBuffer> | undefined;
      try {
        plaintext = encoder.encode(text);
        if (plaintext.byteLength > MAX_PLAINTEXT_BYTES)
          throw new ProtocolError("MESSAGE_TOO_LARGE");
        if (decoder.decode(plaintext) !== text)
          throw new ProtocolError("INVALID_MESSAGE");
        if (this.sendSequence >= MAX_MESSAGES_PER_DIRECTION)
          throw new ProtocolError("MESSAGE_LIMIT");
        const seq = this.sendSequence + 1;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encodedIV = encodeBase64Url(iv);
        if (this.sentIVs.has(encodedIV))
          throw new ProtocolError("NONCE_COLLISION");
        this.sentIVs.add(encodedIV);
        const ciphertext = await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv,
            additionalData: aad(this.roomId, this.sendDirection, seq),
            tagLength: 128,
          },
          this.sendKey!,
          plaintext,
        );
        this.assertActive();
        this.sendSequence = seq;
        return {
          v: 1 as const,
          kind: "ciphertext" as const,
          roomId: this.roomId,
          direction: this.sendDirection,
          seq,
          iv: encodedIV,
          ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
        };
      } catch (error) {
        this.dispose();
        throw error instanceof ProtocolError
          ? error
          : new ProtocolError("ENCRYPTION_FAILED");
      } finally {
        plaintext?.fill(0);
      }
    });
    this.sendTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  decrypt(envelope: CiphertextEnvelope): Promise<string> {
    const operation = this.receiveTail.then(async () => {
      this.assertActive();
      let plaintext: Uint8Array | undefined;
      try {
        const message = parseCiphertextEnvelope(envelope);
        if (
          message.roomId !== this.roomId ||
          message.direction !== this.receiveDirection
        ) {
          throw new ProtocolError("CONTEXT_MISMATCH");
        }
        if (
          message.seq !== this.receiveSequence + 1 ||
          this.receivedIVs.has(message.iv)
        ) {
          throw new ProtocolError("SEQUENCE_ERROR");
        }
        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decodeBase64Url(message.iv, 12),
            additionalData: aad(
              this.roomId,
              this.receiveDirection,
              message.seq,
            ),
            tagLength: 128,
          },
          this.receiveKey!,
          decodeBase64Url(message.ciphertext),
        );
        plaintext = new Uint8Array(decrypted);
        this.assertActive();
        if (plaintext.byteLength === 0)
          throw new ProtocolError("INVALID_MESSAGE");
        if (plaintext.byteLength > MAX_PLAINTEXT_BYTES)
          throw new ProtocolError("MESSAGE_TOO_LARGE");
        const text = decoder.decode(plaintext);
        this.receiveSequence = message.seq;
        this.receivedIVs.add(message.iv);
        return text;
      } catch (error) {
        this.dispose();
        throw error instanceof ProtocolError
          ? error
          : new ProtocolError("DECRYPTION_FAILED");
      } finally {
        plaintext?.fill(0);
      }
    });
    this.receiveTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  dispose(): void {
    this.sendKey = null;
    this.receiveKey = null;
    this.sentIVs.clear();
    this.receivedIVs.clear();
    this.sendSequence = 0;
    this.receiveSequence = 0;
  }
}
