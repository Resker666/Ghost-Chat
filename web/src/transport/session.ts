import { CryptoSession } from "../crypto";
import { parseServerMessage, type Role } from "../protocol";

export type EndReason =
  | "destroyed"
  | "disconnected"
  | "expired"
  | "protocol_error"
  | "slow_client"
  | "auth_failed";
interface Callbacks {
  joined: (expiresAt: string) => void;
  ready: () => void;
  text: (text: string) => void;
  ended: (reason: EndReason) => void;
}

export class SessionTransport {
  private socket: WebSocket;
  private done = false;
  private authenticated = false;
  private ready = false;
  private incoming: Promise<void> = Promise.resolve();
  private authTimer: ReturnType<typeof setTimeout>;

  constructor(
    private roomId: string,
    private role: Role,
    token: string,
    private crypto: CryptoSession,
    private callbacks: Callbacks,
  ) {
    const url = new URL(`/api/v1/rooms/${roomId}/ws`, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(url);
    let credential: string | undefined = token;
    // Drop this parameter reference after transferring it to the one-use handler.
    // eslint-disable-next-line no-useless-assignment
    token = "";
    this.authTimer = setTimeout(() => this.close("disconnected"), 10_000);
    this.socket.onopen = () => {
      if (!this.done)
        this.socket.send(
          JSON.stringify({ v: 1, kind: "auth", token: credential }),
        );
      credential = undefined;
    };
    this.socket.onmessage = (event: MessageEvent<unknown>) => {
      this.incoming = this.incoming
        .then(async () => {
          if (this.done) return;
          if (typeof event.data !== "string") throw new Error("PROTOCOL_ERROR");
          const message = parseServerMessage(event.data);
          if (message.kind === "error") {
            this.close(
              [
                "AUTH_FAILED",
                "ROOM_FULL",
                "ROOM_NOT_FOUND_OR_EXPIRED",
              ].includes(message.code)
                ? "auth_failed"
                : "protocol_error",
            );
          } else if (message.kind === "room_destroyed") {
            this.close(message.reason);
          } else if (message.kind === "joined") {
            if (
              this.authenticated ||
              message.role !== this.role ||
              message.roomId !== this.roomId
            )
              throw new Error("PROTOCOL_ERROR");
            this.authenticated = true;
            clearTimeout(this.authTimer);
            this.callbacks.joined(message.expiresAt);
          } else if (message.kind === "peer_ready") {
            if (!this.authenticated || this.ready)
              throw new Error("PROTOCOL_ERROR");
            this.ready = true;
            this.callbacks.ready();
          } else {
            if (!this.ready) throw new Error("PROTOCOL_ERROR");
            const text = await this.crypto.decrypt(message);
            if (!this.done) this.callbacks.text(text);
          }
        })
        .catch(() => this.close("protocol_error"));
    };
    this.socket.onerror = () => this.close("disconnected");
    this.socket.onclose = () => this.close("disconnected");
  }

  async send(text: string): Promise<boolean> {
    if (this.done || !this.ready || this.socket.readyState !== WebSocket.OPEN)
      return false;
    try {
      const envelope = await this.crypto.encrypt(text);
      if (this.done || this.socket.readyState !== WebSocket.OPEN) return false;
      this.socket.send(JSON.stringify(envelope));
      return true;
    } catch {
      this.close("protocol_error");
      return false;
    }
  }

  destroy(): void {
    if (
      !this.done &&
      this.authenticated &&
      this.socket.readyState === WebSocket.OPEN
    )
      this.socket.send(JSON.stringify({ v: 1, kind: "destroy" }));
    this.close("destroyed");
  }

  close(reason: EndReason): void {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.authTimer);
    this.crypto.dispose();
    this.socket.onopen =
      this.socket.onmessage =
      this.socket.onerror =
      this.socket.onclose =
        null;
    this.socket.close();
    this.callbacks.ended(reason);
    this.callbacks = { joined() {}, ready() {}, text() {}, ended() {} };
  }
}
