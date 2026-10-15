import { useLayoutEffect, useRef, useState } from "react";

function clearCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export function InvitationQR({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  let loopback = false;
  try {
    loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(value).hostname,
    );
  } catch {
    // Keep URL parser diagnostics out of the invitation UI.
  }

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const staging = document.createElement("canvas");
    let active = true;
    setStatus("loading");
    const render = async () => {
      try {
        const QRCode = await import("qrcode");
        if (!active) return;
        await QRCode.toCanvas(staging, value, {
          width: 256,
          margin: 4,
          errorCorrectionLevel: "M",
          color: { dark: "#000000ff", light: "#ffffffff" },
        });
        if (!active) return;
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("QR_RENDER_FAILED");
        context.drawImage(staging, 0, 0);
        setStatus("ready");
      } catch {
        if (active) {
          clearCanvas(canvas);
          setStatus("error");
        }
      } finally {
        clearCanvas(staging);
      }
    };
    void render();
    return () => {
      active = false;
      clearCanvas(canvas);
      clearCanvas(staging);
    };
  }, [value]);

  return (
    <figure className="invitation-qr">
      <canvas
        ref={canvasRef}
        width={256}
        height={256}
        role="img"
        aria-label="一次性邀请二维码"
        aria-busy={status === "loading"}
        hidden={status === "error"}
      />
      {status === "error" ? (
        <p className="error" role="alert">
          无法生成二维码，请复制邀请链接。
        </p>
      ) : (
        <figcaption>二维码包含会话秘密，仅向对方展示。</figcaption>
      )}
      {loopback && <p className="risk-note">本机地址仅本机可用。</p>}
    </figure>
  );
}
