import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localGo = path.resolve(
  root,
  "..",
  ".tools",
  "go",
  "bin",
  process.platform === "win32" ? "go.exe" : "go",
);
const go = process.env.GO_BINARY || (existsSync(localGo) ? localGo : "go");
mkdirSync(path.join(root, ".tools"), { recursive: true });
const binary = path.join(
  root,
  ".tools",
  process.platform === "win32" ? "e2e-server.exe" : "e2e-server",
);
export default async function setup() {
  const build = spawnSync(go, ["build", "-o", binary, "./cmd/ghostchat"], {
    cwd: path.join(root, "server"),
    stdio: "inherit",
  });
  if (build.status !== 0) throw new Error("E2E server build failed");
  try {
    await fetch("http://127.0.0.1:18080/healthz", {
      signal: AbortSignal.timeout(500),
    });
    throw new Error("E2E port already in use");
  } catch (error) {
    if (error.message === "E2E port already in use") throw error;
  }
  const server = spawn(binary, [], {
    cwd: path.join(root, "server"),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ADDR: "127.0.0.1:18080",
      WEB_DIST_DIR: path.join(root, "web", "dist"),
      ALLOWED_ORIGINS: "http://127.0.0.1:18080",
      ROOM_TTL: "30s",
      WAITING_TTL: "10s",
      HEARTBEAT_INTERVAL: "2s",
      HEARTBEAT_TIMEOUT: "2s",
      CREATE_RATE_PER_MINUTE: "1000",
      UPGRADE_RATE_PER_MINUTE: "2000",
    },
  });
  let exited = false;
  const exit = new Promise((resolve) =>
    server.on("exit", () => {
      exited = true;
      resolve();
    }),
  );
  let output = "";
  let excessiveOutput = false;
  const capture = (chunk) => {
    if (output.length + chunk.length > 65536) excessiveOutput = true;
    else output += chunk.toString();
  };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);
  const stop = async () => {
    if (!exited) server.kill();
    await exit;
    if (
      excessiveOutput ||
      output
        .split(/\r?\n/)
        .some(
          (line) =>
            line &&
            !/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} Ghost Chat server started$/.test(
              line,
            ),
        )
    ) {
      throw new Error(
        "Server emitted unexpected logs; sensitive output suppressed",
      );
    }
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100 && !exited; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:18080/healthz");
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("E2E server startup failed");
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}
