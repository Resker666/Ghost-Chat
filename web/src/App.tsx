import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Eye,
  Info,
  Link,
  LoaderCircle,
  LockKeyhole,
  MessagesSquare,
  Plus,
  QrCode,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { CryptoSession } from "./crypto";
import { InvitationQR } from "./components/InvitationQR";
import { useVisualViewport } from "./hooks/useVisualViewport";
import {
  buildInviteUrl,
  MAX_PLAINTEXT_BYTES,
  parseInviteFragment,
  parseRoomCreatedResponse,
  type Role,
} from "./protocol";
import { SessionTransport, type EndReason } from "./transport/session";
import "./styles.css";

type Boot =
  | { kind: "home" }
  | { kind: "invalid" }
  | {
      kind: "join";
      roomId: string;
      roomSecret: Uint8Array;
      inviteToken: string;
    };
type Stage = "home" | "join" | "connecting" | "waiting" | "chat" | "ended";
interface Message {
  id: number;
  author: "you" | "peer";
  text: string;
}

export function captureBootstrap(): Boot {
  const hash = window.location.hash;
  window.history.replaceState(null, "", window.location.pathname);
  if (window.location.pathname === "/")
    return hash ? { kind: "invalid" } : { kind: "home" };
  const match = /^\/r\/([A-Za-z0-9_-]{22})$/.exec(window.location.pathname);
  if (!match || !hash) return { kind: "invalid" };
  try {
    return { kind: "join", roomId: match[1], ...parseInviteFragment(hash) };
  } catch {
    return { kind: "invalid" };
  }
}

const endLabels: Record<EndReason, string> = {
  destroyed: "会话已销毁",
  disconnected: "连接已断开",
  expired: "房间已过期",
  protocol_error: "会话验证失败",
  slow_client: "连接无法及时接收消息",
  auth_failed: "邀请已失效或已被使用",
};

export default function App({ boot }: { boot: Boot }) {
  useVisualViewport();
  const [stage, setStage] = useState<Stage>(
    boot.kind === "home" ? "home" : boot.kind === "join" ? "join" : "ended",
  );
  const [pending, setPending] = useState<Extract<
    Boot,
    { kind: "join" }
  > | null>(boot.kind === "join" ? boot : null);
  const [invite, setInvite] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("邀请已失效，或会话材料已从本页移除");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [manualInvite, setManualInvite] = useState(false);
  const [qrVisible, setQRVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [safety, setSafety] = useState(false);
  const [now, setNow] = useState(Date.now());
  const transport = useRef<SessionTransport | null>(null);
  const pendingRef = useRef(pending);
  const busy = useRef(false);
  const generation = useRef(0);
  const activeSecret = useRef<Uint8Array | null>(null);
  const messageId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const inviteInput = useRef<HTMLInputElement>(null);
  const inviteVersion = useRef(0);
  const composing = useRef(false);
  const safetyClose = useRef<HTMLButtonElement>(null);
  const safetyOpener = useRef<HTMLButtonElement>(null);
  const byteCount = new TextEncoder().encode(draft).byteLength;
  const supported = window.isSecureContext && !!window.crypto?.subtle;
  const seconds = expiresAt
    ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))
    : 0;
  const remaining = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const clearPending = () => {
    pendingRef.current?.roomSecret.fill(0);
    if (pendingRef.current) pendingRef.current.inviteToken = "";
    pendingRef.current = null;
    setPending(null);
  };
  const clearInvite = () => {
    inviteVersion.current++;
    setInvite("");
    setCopied(false);
    setCopyFailed(false);
    setManualInvite(false);
    setQRVisible(false);
    setError("");
  };
  const ended = (value: EndReason) => {
    setMessages([]);
    setDraft("");
    composing.current = false;
    clearInvite();
    setExpiresAt(null);
    setSending(false);
    setReason(endLabels[value]);
    setStage("ended");
    busy.current = false;
    clearPending();
  };
  const addMessage = (author: Message["author"], text: string) => {
    const id = ++messageId.current;
    setMessages((previous) => [...previous, { id, author, text }]);
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const terminate = () => {
      generation.current++;
      busy.current = false;
      setSending(false);
      activeSecret.current?.fill(0);
      activeSecret.current = null;
      transport.current?.close("disconnected");
      pendingRef.current?.roomSecret.fill(0);
      if (pendingRef.current) pendingRef.current.inviteToken = "";
      pendingRef.current = null;
      setPending(null);
      clearInvite();
      setMessages([]);
      setDraft("");
      composing.current = false;
      setExpiresAt(null);
      setStage((current) => (current === "home" ? current : "ended"));
    };
    window.addEventListener("pagehide", terminate);
    window.addEventListener("offline", terminate);
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted) terminate();
    };
    window.addEventListener("pageshow", resume);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", terminate);
      window.removeEventListener("offline", terminate);
      window.removeEventListener("pageshow", resume);
      terminate();
    };
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "instant" });
  }, [messages.length]);
  useEffect(() => {
    if (safety) {
      safetyClose.current?.focus({ preventScroll: true });
      return;
    }
    if (!safetyOpener.current) return;
    const opener = safetyOpener.current.getClientRects().length
      ? safetyOpener.current
      : [
          ...document.querySelectorAll<HTMLButtonElement>(
            "[data-safety-opener]",
          ),
        ].find((button) => button.getClientRects().length > 0);
    opener?.focus({ preventScroll: true });
    safetyOpener.current = null;
  }, [safety]);
  useEffect(() => {
    if (manualInvite) {
      inviteInput.current?.focus({ preventScroll: true });
      inviteInput.current?.select();
    }
  }, [manualInvite]);

  async function connect(
    roomId: string,
    role: Role,
    token: string,
    secret: Uint8Array,
    operation: number,
  ) {
    let crypto: CryptoSession;
    try {
      crypto = await CryptoSession.create(secret, roomId, role);
    } finally {
      secret.fill(0);
      if (activeSecret.current === secret) activeSecret.current = null;
    }
    if (generation.current !== operation) {
      crypto.dispose();
      throw new Error("SESSION_ENDED");
    }
    try {
      transport.current = new SessionTransport(roomId, role, token, crypto, {
        joined: (expiry) => {
          setExpiresAt(expiry);
          setNow(Date.now());
          setStage("waiting");
          busy.current = false;
        },
        ready: () => {
          clearInvite();
          setStage("chat");
          busy.current = false;
        },
        text: (text) => addMessage("peer", text),
        ended,
      });
    } catch {
      crypto.dispose();
      throw new Error("CONNECTION_FAILED");
    }
  }

  async function createRoom() {
    if (busy.current || !supported) return;
    busy.current = true;
    setStage("connecting");
    setError("");
    setMessages([]);
    setDraft("");
    clearInvite();
    const operation = ++generation.current;
    transport.current = null;
    let secret: Uint8Array | null = null;
    try {
      const response = await fetch("/api/v1/rooms", {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error("CREATE_FAILED");
      const room = parseRoomCreatedResponse(await response.text());
      if (generation.current !== operation) throw new Error("SESSION_ENDED");
      secret = window.crypto.getRandomValues(new Uint8Array(32));
      activeSecret.current = secret;
      window.history.replaceState(null, "", `/r/${room.roomId}`);
      setExpiresAt(room.expiresAt);
      setNow(Date.now());
      setInvite(
        buildInviteUrl(
          window.location.origin,
          room.roomId,
          secret,
          room.inviteToken,
        ),
      );
      await connect(room.roomId, "A", room.creatorToken, secret, operation);
    } catch {
      secret?.fill(0);
      if (activeSecret.current === secret) activeSecret.current = null;
      if (generation.current !== operation) return;
      clearInvite();
      setExpiresAt(null);
      setStage("home");
      setError("暂时无法创建房间，请稍后重试。");
      busy.current = false;
    }
  }

  async function joinRoom() {
    if (!pending || busy.current || !supported) return;
    busy.current = true;
    setStage("connecting");
    setError("");
    const operation = ++generation.current;
    try {
      await connect(
        pending.roomId,
        "B",
        pending.inviteToken,
        pending.roomSecret,
        operation,
      );
      clearPending();
    } catch {
      if (generation.current === operation) {
        clearPending();
        ended("protocol_error");
      }
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (
      busy.current ||
      composing.current ||
      !draft ||
      byteCount > MAX_PLAINTEXT_BYTES ||
      stage !== "chat"
    )
      return;
    busy.current = true;
    setSending(true);
    const operation = generation.current;
    const current = transport.current;
    const text = draft;
    const sent = await current?.send(text);
    if (generation.current !== operation || transport.current !== current)
      return;
    if (sent) {
      addMessage("you", text);
      setDraft("");
    }
    busy.current = false;
    setSending(false);
  }

  async function copyInvite() {
    if (!invite) return;
    const version = inviteVersion.current;
    try {
      await navigator.clipboard.writeText(invite);
      if (inviteVersion.current === version) {
        setCopied(true);
        setCopyFailed(false);
        setManualInvite(false);
        setError("");
      }
    } catch {
      if (inviteVersion.current === version) {
        setCopied(false);
        setCopyFailed(true);
        setError("无法访问剪贴板，可手动复制邀请链接。");
      }
    }
  }

  function openSafety(event: MouseEvent<HTMLButtonElement>) {
    safetyOpener.current = event.currentTarget;
    setSafety(true);
  }
  function closeSafety() {
    setSafety(false);
  }
  function safetyKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSafety();
    }
    if (event.key === "Tab") {
      const controls = event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  const active = stage === "waiting" || stage === "chat";
  const status =
    stage === "chat"
      ? "双方在线"
      : stage === "waiting"
        ? "等待对方"
        : stage === "connecting"
          ? "正在连接"
          : stage === "ended"
            ? "会话结束"
            : "未连接";

  return (
    <div className="app-shell">
      <aside className="sidebar" inert={safety}>
        <a className="brand" href="/" aria-label="Ghost Chat 首页">
          <MessagesSquare size={25} />
          <span>Ghost Chat</span>
        </a>
        <div className="sidebar-session">
          <span className="eyebrow">当前会话</span>
          <div className="session-name">
            <LockKeyhole size={17} />
            <span>一次性聊天室</span>
          </div>
          <p className="sidebar-status">{status}</p>
        </div>
        <div className="sidebar-bottom">
          <ShieldCheck size={20} />
          <p>实验性端到端加密</p>
          <span>无需账号 · 不提供聊天历史</span>
          <button
            data-safety-opener
            className="text-button"
            onClick={openSafety}
          >
            <Info size={16} />
            安全与隐私
          </button>
        </div>
      </aside>
      <main className="workspace" inert={safety}>
        <header className="topbar">
          <div>
            <div className="mobile-brand">
              <MessagesSquare size={20} />
              <span>Ghost Chat</span>
            </div>
            <h1>一次性聊天室</h1>
            <span
              className={`connection ${stage === "chat" ? "online" : ""}`}
              role="status"
            >
              <i />
              {status}
            </span>
          </div>
          <div className="header-actions">
            {active && expiresAt && (
              <span className="countdown" aria-label="剩余时间">
                {remaining}
              </span>
            )}
            <button
              className="icon-button mobile-info"
              title="安全与隐私"
              aria-label="安全与隐私"
              data-safety-opener
              onClick={openSafety}
            >
              <Info size={19} />
            </button>
            {active && (
              <button
                className="icon-button danger"
                title="销毁会话"
                aria-label="销毁会话"
                onClick={() => transport.current?.destroy()}
              >
                <Trash2 size={19} />
              </button>
            )}
          </div>
        </header>
        {stage !== "chat" && (
          <section className="session-stage">
            <div className="state-content">
              <div
                className={`state-symbol ${stage === "ended" ? "muted-symbol" : ""}`}
              >
                {stage === "connecting" ? (
                  <LoaderCircle size={34} className="spin" />
                ) : stage === "ended" ? (
                  <WifiOff size={34} />
                ) : stage === "waiting" ? (
                  <Link size={34} />
                ) : (
                  <MessagesSquare size={34} />
                )}
              </div>
              {stage === "home" && (
                <>
                  <h2>新建会话</h2>
                  <p className="description">
                    仅供两人在线交流。会话结束后，无法通过系统恢复。
                  </p>
                  <button
                    className="primary-button"
                    onClick={createRoom}
                    disabled={!supported}
                  >
                    <Plus size={18} />
                    创建一次性房间
                  </button>
                  <p className="risk-note">请通过可信渠道确认对方身份。</p>
                </>
              )}
              {stage === "join" && (
                <>
                  <h2>加入会话</h2>
                  <p className="description">
                    邀请只能使用一次。确认加入后，关闭页面或断线都会结束会话。
                  </p>
                  <button
                    className="primary-button"
                    onClick={joinRoom}
                    disabled={!supported}
                  >
                    <ArrowUp size={18} />
                    加入会话
                  </button>
                  <p className="risk-note">请确认邀请来自你信任的人。</p>
                </>
              )}
              {stage === "connecting" && (
                <>
                  <h2>正在连接</h2>
                  <p className="description">
                    {pending ? "正在加入房间" : "正在创建房间"}
                  </p>
                </>
              )}
              {stage === "waiting" && (
                <>
                  <h2>等待对方加入</h2>
                  <p className="description">
                    将邀请发送给对方。持有完整链接的人可以进入该会话。
                  </p>
                  {invite ? (
                    <div className="invite-tool">
                      <label htmlFor="invite">一次性邀请链接</label>
                      <div className="invite-row">
                        <input
                          id="invite"
                          ref={inviteInput}
                          aria-label={
                            manualInvite ? "手动复制邀请链接" : "邀请链接"
                          }
                          type={manualInvite ? "text" : "password"}
                          readOnly
                          value={invite}
                          spellCheck={false}
                          autoComplete="off"
                          inputMode="none"
                          onFocus={
                            manualInvite
                              ? (event) => event.currentTarget.select()
                              : undefined
                          }
                          onClick={
                            manualInvite
                              ? (event) => event.currentTarget.select()
                              : undefined
                          }
                        />
                        <button
                          className="icon-button"
                          title={copied ? "已复制" : "复制邀请链接"}
                          aria-label="复制邀请链接"
                          onClick={copyInvite}
                        >
                          {copied ? <Check size={19} /> : <Copy size={19} />}
                        </button>
                        <button
                          className="icon-button"
                          title={
                            qrVisible ? "隐藏邀请二维码" : "显示邀请二维码"
                          }
                          aria-label={
                            qrVisible ? "隐藏邀请二维码" : "显示邀请二维码"
                          }
                          aria-expanded={qrVisible}
                          onClick={() => setQRVisible((visible) => !visible)}
                        >
                          <QrCode size={19} />
                        </button>
                      </div>
                      <span className="copy-state" aria-live="polite">
                        {copied ? "已复制" : "加入后邀请立即失效"}
                      </span>
                      {copyFailed && !manualInvite && (
                        <button
                          className="text-button"
                          aria-label="显示邀请链接以手动复制"
                          onClick={() => {
                            setManualInvite(true);
                            setError("");
                          }}
                        >
                          <Eye size={16} />
                          手动复制
                        </button>
                      )}
                      {qrVisible && <InvitationQR value={invite} />}
                    </div>
                  ) : (
                    <p className="risk-note">等待房间创建者上线</p>
                  )}
                  <p className="risk-note">
                    创建后 10 分钟内未会合，房间将关闭。
                  </p>
                </>
              )}
              {stage === "ended" && (
                <>
                  <h2>{reason}</h2>
                  <p className="description">
                    本页会话内容已清空，无法恢复。已被对方保存的副本不受控制。
                  </p>
                  <button
                    className="primary-button"
                    onClick={createRoom}
                    disabled={!supported}
                  >
                    <Plus size={18} />
                    创建新房间
                  </button>
                </>
              )}
              {!supported && (
                <p className="error" role="alert">
                  此页面需要支持 Web Crypto 的浏览器和 HTTPS 安全连接，或
                  localhost 本地地址。
                </p>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </section>
        )}
        {stage === "chat" && (
          <>
            <div className="conversation-label">
              <LockKeyhole size={14} />
              <span>实验性端到端加密 · 断线即结束</span>
            </div>
            <section
              className="messages"
              role="log"
              aria-label="聊天消息"
              aria-live="polite"
            >
              {messages.length === 0 && (
                <div className="empty-conversation">
                  <MessagesSquare size={28} />
                  <p>对方已在线</p>
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className={`message ${message.author}`}>
                  <span className="message-author">
                    {message.author === "you" ? "你" : "对方"}
                  </span>
                  <div className="message-text">{message.text}</div>
                </div>
              ))}
              <div ref={bottom} />
            </section>
            <form className="composer" onSubmit={send}>
              <label className="sr-only" htmlFor="message">
                消息
              </label>
              <div
                className={`compose-row ${byteCount > MAX_PLAINTEXT_BYTES ? "over-limit" : ""}`}
              >
                <textarea
                  id="message"
                  placeholder="输入消息…"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  rows={2}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !composing.current &&
                      !event.nativeEvent.isComposing &&
                      event.nativeEvent.keyCode !== 229
                    ) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  type="submit"
                  className="send-button"
                  aria-label="发送消息"
                  title="发送消息"
                  disabled={
                    !draft || sending || byteCount > MAX_PLAINTEXT_BYTES
                  }
                >
                  {sending ? (
                    <LoaderCircle size={20} className="spin" />
                  ) : (
                    <ArrowUp size={20} />
                  )}
                </button>
              </div>
              <div className="compose-footer">
                <span>仅限当前在线会话</span>
                <span
                  className={byteCount > MAX_PLAINTEXT_BYTES ? "error" : ""}
                  aria-live="polite"
                >
                  {byteCount} / {MAX_PLAINTEXT_BYTES} 字节
                </span>
              </div>
            </form>
          </>
        )}
        <footer className="workspace-footer">
          无前向保密 · 无法阻止截图 · 不保证内存物理擦除
        </footer>
      </main>
      {safety && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSafety();
          }}
          onKeyDown={safetyKeys}
        >
          <section
            className="safety-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="safety-title"
          >
            <div className="dialog-heading">
              <h2 id="safety-title">安全与隐私</h2>
              <button
                ref={safetyClose}
                className="icon-button"
                aria-label="关闭安全说明"
                title="关闭"
                onClick={closeSafety}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              消息在双方浏览器加密和解密。正常运行的中继服务器仅转发密文，不保存聊天记录。
            </p>
            <ul>
              <li>
                完整邀请链接包含会话秘密，泄漏后可能被冒充，也可能被用来解密录下的历史密文。首版不具备前向保密。
              </li>
              <li>
                公网服务器仍能看到
                IP、连接时间和消息长度。本工具不提供绝对匿名或 Tor 匿名性。
              </li>
              <li>
                网页发布者可以更换
                JavaScript；恶意代码、浏览器扩展或受侵入的终端可能读取消息。
              </li>
              <li>
                销毁仅指应用清理内存状态，无法保证物理擦除，也无法删除对方截图、复制或录屏保存的内容。
              </li>
              <li>
                任一方刷新、关闭或被检测到断线，整个会话结束。网络故障需要时间才能检测。
              </li>
            </ul>
            <p className="risk-note">
              未经独立安全审计，不用于高风险保密交流。
            </p>
            <button className="text-button" onClick={closeSafety}>
              <ArrowLeft size={16} />
              返回会话
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
