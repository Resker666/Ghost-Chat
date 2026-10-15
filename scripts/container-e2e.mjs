import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { assertCoverageSummary } from "./container-e2e-reporter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(root, "deploy", "compose.e2e.yaml");
const safeReporter = path.join(root, "scripts", "container-e2e-reporter.mjs");
const cli = path.join(
  root,
  "e2e",
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const args = process.argv.slice(2);
let activeChild;
let stopActiveChild;
let interrupted = false;

function run(command, parameters, options = {}) {
  return new Promise((resolve, reject) => {
    if (interrupted && !options.cleanup) {
      reject(new Error("Container verification interrupted"));
      return;
    }
    const child = spawn(command, parameters, {
      cwd: options.cwd || root,
      env: options.env || process.env,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    let stdout = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let excessive = false;
    let timedOut = false;
    let forceStop;
    const terminate = () => {
      child.kill("SIGTERM");
      forceStop ||= setTimeout(() => child.kill("SIGKILL"), 5000);
      forceStop.unref();
    };
    stopActiveChild = terminate;
    child.stdout?.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 65536) {
        excessive = true;
        terminate();
      } else stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65536) {
        excessive = true;
        terminate();
      }
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeout || 120000);
    child.once("error", () => {
      clearTimeout(timeout);
      clearTimeout(forceStop);
      if (activeChild === child) {
        activeChild = undefined;
        stopActiveChild = undefined;
      }
      reject(new Error(`${options.label || command} could not start`));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      clearTimeout(forceStop);
      if (activeChild === child) {
        activeChild = undefined;
        stopActiveChild = undefined;
      }
      if (code !== 0 || excessive || timedOut) {
        reject(
          new Error(
            `${options.label || command} failed; diagnostic output suppressed`,
          ),
        );
      } else resolve(stdout.trim());
    });
  });
}

function checkPort(value) {
  if (!/^[0-9]{1,5}$/.test(value))
    throw new Error("CONTAINER_HTTPS_PORT must be a numeric high port");
  const port = Number(value);
  if (port < 1024 || port > 65535)
    throw new Error("CONTAINER_HTTPS_PORT must be between 1024 and 65535");
  return port;
}

async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(new Error("Container HTTPS loopback port is already in use")),
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      server.close(resolve),
    );
  });
}

function requestHealth(origin, ca) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      `${origin}/healthz`,
      { ca, rejectUnauthorized: true, timeout: 2000 },
      (response) => {
        const authorized = response.socket.authorized;
        const protocol = response.socket.getProtocol();
        let body = "";
        response.on("data", (chunk) => {
          body += chunk.toString();
          if (body.length > 1024) response.destroy();
        });
        response.on("end", () => {
          if (
            response.statusCode !== 200 ||
            !authorized ||
            !["TLSv1.2", "TLSv1.3"].includes(protocol) ||
            body.trim() !== '{"status":"ok"}'
          ) {
            reject(new Error("Verified TLS health response was invalid"));
          } else resolve(protocol);
        });
        response.on("error", reject);
        response.once("aborted", () =>
          reject(new Error("TLS health response aborted")),
        );
      },
    );
    request.once("error", reject);
    request.once("timeout", () =>
      request.destroy(new Error("TLS readiness timeout")),
    );
  });
}

async function requireTLSRejection(origin, ca, wrongName = false) {
  try {
    if (wrongName) {
      await new Promise((resolve, reject) => {
        const socket = tls.connect({
          host: "127.0.0.1",
          port: Number(new URL(origin).port),
          ca,
          servername: "not-ghost-chat.invalid",
          rejectUnauthorized: true,
        });
        socket.setTimeout(2000, () =>
          socket.destroy(new Error("TLS negative check timeout")),
        );
        socket.once("secureConnect", () => {
          socket.end();
          resolve();
        });
        socket.once("error", (error) => {
          socket.destroy();
          reject(error);
        });
      });
    } else await requestHealth(origin, tls.rootCertificates);
  } catch (error) {
    const acceptedCodes = wrongName
      ? ["ERR_TLS_CERT_ALTNAME_INVALID"]
      : [
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
          "SELF_SIGNED_CERT_IN_CHAIN",
          "DEPTH_ZERO_SELF_SIGNED_CERT",
        ];
    if (acceptedCodes.includes(error.code)) return;
    throw new Error(
      "TLS negative check did not fail for the expected certificate reason",
    );
  }
  throw new Error(
    "TLS accepted an untrusted certificate or incorrect hostname",
  );
}

async function createCertificates(runDir) {
  const certDir = path.join(runDir, "tls");
  await mkdir(certDir, { mode: 0o755 });
  const ca = path.join(runDir, "ca.crt");
  const caKey = path.join(runDir, "ca.key");
  const serverKey = path.join(certDir, "server.key");
  const csr = path.join(runDir, "server.csr");
  const certificate = path.join(certDir, "server.crt");
  await run(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=Ghost Chat isolated test CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE,pathlen:0",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
      "-keyout",
      caKey,
      "-out",
      ca,
    ],
    { label: "Temporary test CA generation" },
  );
  await chmod(caKey, 0o600);
  await run(
    "openssl",
    [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-subj",
      "/CN=localhost",
      "-addext",
      "basicConstraints=critical,CA:FALSE",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-addext",
      "extendedKeyUsage=serverAuth",
      "-addext",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "-keyout",
      serverKey,
      "-out",
      csr,
    ],
    { label: "Temporary TLS key generation" },
  );
  await run(
    "openssl",
    [
      "x509",
      "-req",
      "-in",
      csr,
      "-CA",
      ca,
      "-CAkey",
      caKey,
      "-CAcreateserial",
      "-days",
      "2",
      "-sha256",
      "-copy_extensions",
      "copy",
      "-out",
      certificate,
    ],
    { label: "Temporary server certificate signing" },
  );
  await run(
    "openssl",
    ["verify", "-CAfile", ca, "-verify_hostname", "localhost", certificate],
    { label: "Certificate hostname validation" },
  );
  await run(
    "openssl",
    ["verify", "-CAfile", ca, "-verify_ip", "127.0.0.1", certificate],
    { label: "Certificate IP validation" },
  );
  await rm(caKey);
  await rm(csr);
  await chmod(certDir, 0o755);
  await chmod(certificate, 0o644);
  // The 0700 parent protects host files; the unprivileged proxy reads this read-only bind mount.
  await chmod(serverKey, 0o644);
  const home = path.join(runDir, "browser-home");
  for (const relative of [".pki/nssdb", ".local/share/pki/nssdb"]) {
    const database = path.join(home, relative);
    await mkdir(database, { recursive: true, mode: 0o700 });
    await run("certutil", ["-N", "--empty-password", "-d", `sql:${database}`], {
      label: "Isolated Chromium trust database creation",
    });
    await run(
      "certutil",
      [
        "-A",
        "-d",
        `sql:${database}`,
        "-n",
        "Ghost Chat isolated E2E CA",
        "-t",
        "C,,",
        "-i",
        ca,
      ],
      { label: "Isolated Chromium test CA import" },
    );
  }
  return { certDir, ca, home };
}

async function inspectStack(compose, env, port) {
  const ids = (await compose(["ps", "--quiet"], { env }))
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length !== 2)
    throw new Error("Expected exactly two isolated test containers");
  const containers = JSON.parse(
    await run("docker", ["inspect", ...ids], {
      label: "Container isolation inspection",
      env,
    }),
  );
  for (const container of containers) {
    const service = container.Config.Labels["com.docker.compose.service"];
    const host = container.HostConfig;
    if (
      !host.ReadonlyRootfs ||
      host.LogConfig.Type !== "none" ||
      !host.CapDrop?.includes("ALL") ||
      !host.SecurityOpt?.includes("no-new-privileges:true") ||
      container.State.Status !== "running"
    ) {
      throw new Error(
        "Container isolation or log policy did not match the test contract",
      );
    }
    if (service === "ghost-chat") {
      if (
        container.Config.User !== "65532:65532" ||
        container.Mounts.length !== 0 ||
        Object.keys(host.PortBindings || {}).length !== 0
      ) {
        throw new Error(
          "Application container must be non-root, unmounted, and unpublished",
        );
      }
    } else if (service === "nginx") {
      const bindings = host.PortBindings["8443/tcp"];
      if (
        container.Config.User !== "101:101" ||
        Object.keys(host.PortBindings).length !== 1 ||
        bindings?.length !== 1 ||
        bindings[0].HostIp !== "127.0.0.1" ||
        bindings[0].HostPort !== String(port) ||
        container.Mounts.some((mount) => mount.Type === "bind" && mount.RW)
      ) {
        throw new Error(
          "Proxy exposure or read-only mounts did not match the test contract",
        );
      }
    } else throw new Error("Unexpected service in isolated Compose project");
  }
}

async function main() {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: node scripts/container-e2e.mjs [Playwright test arguments]",
    );
    console.log(
      "Requires local Linux Docker/Compose, OpenSSL >=3, NSS certutil, npm ci in e2e, and installed Playwright Chromium.",
    );
    console.log(
      "CONTAINER_HTTPS_PORT defaults to 18443. Default browser project: chromium. No global certificate trust changes.",
    );
    console.log(
      "Acceptance requires both encrypted conversation and isolated container restart to pass; filters that omit either case cannot pass acceptance. Listing, interactive modes, and reporter overrides are rejected.",
    );
    return;
  }
  const nonExecution = new Set([
    "--list",
    "--ui",
    "--ui-host",
    "--ui-port",
    "--debug",
    "--version",
    "-V",
    "--pass-with-no-tests",
  ]);
  if (args.some((argument) => nonExecution.has(argument.split("=")[0]))) {
    throw new Error(
      "Container browser acceptance requires actual non-interactive test execution; listing, debugging, UI, version, and empty-test waiver modes are not allowed",
    );
  }
  if (
    args.some((argument) =>
      ["--reporter", "--add-reporter"].includes(argument.split("=")[0]),
    )
  ) {
    throw new Error(
      "Container browser acceptance uses fixed list and safe-summary reporters; reporter overrides are not allowed",
    );
  }
  if (process.platform !== "linux")
    throw new Error(
      "Container TLS verification requires an isolated Linux Docker host",
    );
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    throw new Error("Certificate verification must remain enabled");
  const port = checkPort(process.env.CONTAINER_HTTPS_PORT || "18443");
  await access(cli);
  await requireFreePort(port);
  // DOCKER_CONTEXT overrides DOCKER_HOST in Docker's actual CLI selection.
  let endpoint;
  if (process.env.DOCKER_CONTEXT) {
    endpoint = JSON.parse(
      await run(
        "docker",
        [
          "context",
          "inspect",
          process.env.DOCKER_CONTEXT,
          "--format",
          "{{json .Endpoints.docker.Host}}",
        ],
        { label: "Selected Docker context inspection" },
      ),
    );
  } else if (process.env.DOCKER_HOST) {
    endpoint = process.env.DOCKER_HOST;
  } else {
    endpoint = JSON.parse(
      await run(
        "docker",
        ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
        { label: "Local Docker context inspection" },
      ),
    );
  }
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///"))
    throw new Error(
      "Only an explicitly local Unix-socket Docker context is allowed",
    );
  const dockerEnv = {
    ...process.env,
    DOCKER_HOST: endpoint,
    DOCKER_CONFIG: path.resolve(
      root,
      process.env.DOCKER_CONFIG || path.join(os.homedir(), ".docker"),
    ),
  };
  delete dockerEnv.DOCKER_CONTEXT;
  if (
    (await run("docker", ["info", "--format", "{{.OSType}}"], {
      label: "Linux Docker daemon inspection",
      env: dockerEnv,
    })) !== "linux"
  )
    throw new Error("Docker must run Linux containers");
  await run("docker", ["compose", "version"], {
    label: "Docker Compose availability",
    env: dockerEnv,
  });
  const version = await run("openssl", ["version"], {
    label: "OpenSSL availability",
  });
  if (!/^OpenSSL\s+[3-9]\./.test(version))
    throw new Error("OpenSSL 3 or newer is required");
  const parent = path.join(root, ".tools", "container-e2e");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const realRoot = await realpath(root);
  const realParent = await realpath(parent);
  if (
    path.relative(realRoot, realParent) !== path.join(".tools", "container-e2e")
  )
    throw new Error(
      "Temporary certificate parent must stay inside this checkout's ignored .tools directory",
    );
  const runDir = await mkdtemp(path.join(parent, "run-"));
  await chmod(runDir, 0o700);
  const project = `ghost-chat-tls-${randomBytes(6).toString("hex")}`;
  const image = `${project}-app:local`;
  let env;
  let stackAttempted = false;
  let cleanupFailed = false;
  const compose = (parameters, options = {}) =>
    run(
      "docker",
      [
        "compose",
        "--project-name",
        project,
        "--file",
        composeFile,
        ...parameters,
      ],
      { label: "Isolated Compose operation", ...options },
    );
  const onSignal = () => {
    interrupted = true;
    stopActiveChild?.();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const certificates = await createCertificates(runDir);
    const origin = `https://127.0.0.1:${port}`;
    env = {
      ...dockerEnv,
      CONTAINER_E2E_APP_IMAGE: image,
      CONTAINER_E2E_CERT_DIR: certificates.certDir,
      CONTAINER_E2E_ORIGIN: origin,
      CONTAINER_HTTPS_PORT: String(port),
    };
    await compose(["config", "--quiet"], { env });
    stackAttempted = true;
    await compose(["up", "--detach", "--build"], {
      env,
      inherit: true,
      timeout: 900000,
    });
    await compose(
      [
        "exec",
        "--no-TTY",
        "nginx",
        "nginx",
        "-t",
        "-c",
        "/etc/nginx/ghost-chat-e2e.conf",
      ],
      { env },
    );
    const ca = await readFile(certificates.ca);
    let protocol;
    for (let attempt = 0; attempt < 120 && !interrupted; attempt++) {
      try {
        protocol = await requestHealth(origin, ca);
        break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!protocol)
      throw new Error("Verified HTTPS application readiness failed");
    await requireTLSRejection(origin, ca);
    await requireTLSRejection(origin, ca, true);
    await inspectStack(compose, env, port);
    if (interrupted) throw new Error("Container verification interrupted");
    console.log(
      `Verified local test-CA HTTPS (${protocol}); untrusted issuer and wrong hostname rejected.`,
    );
    const browserEnv = {
      ...env,
      HOME: certificates.home,
      XDG_CONFIG_HOME: path.join(certificates.home, ".config"),
      XDG_DATA_HOME: path.join(certificates.home, ".local", "share"),
      XDG_CACHE_HOME: path.join(runDir, "cache"),
      TMPDIR: runDir,
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ||
        path.join(
          process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
          "ms-playwright",
        ),
      NODE_EXTRA_CA_CERTS: certificates.ca,
      E2E_BASE_URL: origin,
      E2E_CONTAINER: "1",
      E2E_SHORT_TTLS: "1",
      E2E_COMPOSE_PROJECT: project,
      E2E_COMPOSE_FILE: composeFile,
      E2E_SAFE_SUMMARY_FILE: path.join(runDir, "safe-summary.json"),
    };
    await run(
      process.execPath,
      [
        cli,
        "test",
        ...(!args.some(
          (argument) =>
            argument === "--project" || argument.startsWith("--project="),
        )
          ? ["--project=chromium"]
          : []),
        ...args,
        `--reporter=list,${safeReporter}`,
      ],
      {
        cwd: path.join(root, "e2e"),
        env: browserEnv,
        inherit: true,
        timeout: 900000,
        label: "Container HTTPS/WSS browser tests",
      },
    );
    if (interrupted) throw new Error("Container verification interrupted");
    let summary;
    try {
      if ((await stat(browserEnv.E2E_SAFE_SUMMARY_FILE)).size > 1024)
        throw new Error("Invalid summary size");
      summary = JSON.parse(
        await readFile(browserEnv.E2E_SAFE_SUMMARY_FILE, "utf8"),
      );
    } catch {
      throw new Error(
        "Safe container browser summary is missing or invalid; acceptance coverage was not established",
      );
    }
    assertCoverageSummary(summary);
    console.log(
      `Container HTTPS/WSS acceptance passed: ${summary.passed} selected tests passed, ${summary.skipped} skipped; encrypted conversation and isolated container restart both passed. Public-domain TLS remains a separate deployment check.`,
    );
  } finally {
    if (stackAttempted) {
      try {
        await compose(
          ["down", "--volumes", "--remove-orphans", "--timeout", "5"],
          { env, cleanup: true },
        );
      } catch {
        cleanupFailed = true;
      }
      if (!cleanupFailed) {
        try {
          await run("docker", ["image", "rm", image], {
            label: "Owned test image removal",
            cleanup: true,
            env,
          });
        } catch {}
      }
    }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (!cleanupFailed) await rm(runDir, { recursive: true, force: true });
    else
      throw new Error(
        `Cleanup failed for owned project ${project}; certificate files remain in its ignored temporary directory`,
      );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = interrupted ? 130 : 1;
});
