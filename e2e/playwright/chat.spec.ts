import { test, expect } from "@playwright/test";
import {
  baseURL,
  creator,
  pair,
  receiver,
  send,
  shortTTLs,
  storageIsEmpty,
} from "./support";

test("two isolated contexts exchange encrypted Unicode text and destroy irreversibly", async ({
  browser,
}) => {
  const a = await creator(browser);
  const b = await receiver(browser, a.invite);
  // A is already connected; observe its actual browser WebSocket sends without changing payloads.
  await a.page.evaluate(() => {
    const original = WebSocket.prototype.send;
    const state = window as unknown as { capturedFrames: string[] };
    state.capturedFrames = [];
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") state.capturedFrames.push(data);
      return original.call(this, data);
    };
  });
  await b.page.getByRole("button", { name: "加入会话", exact: true }).click();
  await expect(a.page.getByRole("log")).toBeVisible();
  await expect(b.page.getByRole("log")).toBeVisible();
  const text = "你好，Ghost Chat! 🧪  保留空格  ";
  await send(a.page, text);
  await expect(b.page.locator(".message-text")).toHaveText([text]);
  const reply = "<img src=x onerror=alert(1)> Hello";
  await send(b.page, reply);
  await expect(a.page.locator(".message-text")).toHaveText([text, reply]);
  expect(await a.page.locator(".messages img").count()).toBe(0);
  const frames = await a.page.evaluate(
    () => (window as unknown as { capturedFrames: string[] }).capturedFrames,
  );
  expect(frames.length > 0).toBe(true);
  const secret = new URLSearchParams(new URL(a.invite).hash.slice(1)).get("s")!;
  expect(
    frames.every(
      (raw) =>
        !raw.includes(text) &&
        !raw.includes(secret) &&
        JSON.parse(raw).kind === "ciphertext",
    ),
  ).toBe(true);
  expect(
    [...a.requests, ...b.requests].every(
      (raw) =>
        !raw.includes(secret) &&
        !raw.includes(text) &&
        new URL(raw.split(" ")[0]).origin === baseURL,
    ),
  ).toBe(true);
  expect([...a.sockets, ...b.sockets].length >= 2).toBe(true);
  expect(
    [...a.sockets, ...b.sockets].every((raw) => {
      const socket = new URL(raw);
      return (
        socket.protocol === (baseURL.startsWith("https:") ? "wss:" : "ws:") &&
        socket.host === new URL(baseURL).host &&
        !socket.search &&
        !socket.hash
      );
    }),
  ).toBe(true);
  await storageIsEmpty(a.context, a.page);
  await storageIsEmpty(b.context, b.page);
  await b.page.getByRole("button", { name: "销毁会话" }).click();
  await expect(
    a.page.getByRole("heading", { name: "会话已销毁" }),
  ).toBeVisible();
  await expect(
    b.page.getByRole("heading", { name: "会话已销毁" }),
  ).toBeVisible();
  expect(await a.page.locator(".message-text").count()).toBe(0);
  await a.page.reload();
  await expect(
    a.page.getByRole("button", { name: "创建新房间" }),
  ).toBeVisible();
  const c = await receiver(browser, a.invite);
  await c.page.getByRole("button", { name: "加入会话", exact: true }).click();
  await expect(
    c.page.getByRole("button", { name: "创建新房间" }),
  ).toBeVisible();
  await c.context.close();
  await a.context.close();
  await b.context.close();
});

test("wrong token and reused invitation cannot displace either participant", async ({
  browser,
}) => {
  const { a, b } = await pair(browser);
  const invalid = new URL(a.invite);
  const params = new URLSearchParams(invalid.hash.slice(1));
  params.set("t", "A".repeat(43));
  invalid.hash = params.toString();
  for (const invite of [invalid.href, a.invite]) {
    const c = await receiver(browser, invite);
    await c.page.getByRole("button", { name: "加入会话", exact: true }).click();
    await expect(
      c.page.getByRole("button", { name: "创建新房间" }),
    ).toBeVisible();
    await expect(a.page.getByRole("log")).toBeVisible();
    await expect(b.page.getByRole("log")).toBeVisible();
    await c.context.close();
  }
  await send(a.page, "still connected");
  await expect(b.page.locator(".message-text")).toHaveText(["still connected"]);
  await a.context.close();
  await b.context.close();
});

test("wrong E2EE secret never reveals plaintext and ends the room", async ({
  browser,
}) => {
  const a = await creator(browser);
  const invalid = new URL(a.invite);
  const params = new URLSearchParams(invalid.hash.slice(1));
  params.set("s", "A".repeat(43));
  invalid.hash = params.toString();
  const b = await receiver(browser, invalid.href);
  await b.page.getByRole("button", { name: "加入会话", exact: true }).click();
  await expect(a.page.getByRole("log")).toBeVisible();
  await send(a.page, "must never be displayed by peer");
  await expect(
    b.page.getByRole("heading", { name: "会话验证失败" }),
  ).toBeVisible();
  expect(await b.page.locator(".message-text").count()).toBe(0);
  await expect(
    a.page.getByRole("button", { name: "创建新房间" }),
  ).toBeVisible();
  await a.context.close();
  await b.context.close();
});

for (const attack of ["replay", "tamper"])
  test(`${attack} of an actual encrypted browser frame fails closed`, async ({
    browser,
  }) => {
    const { a, b } = await pair(browser);
    await a.page.evaluate((mode) => {
      const original = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (typeof data === "string") {
          const frame = JSON.parse(data);
          if (frame.kind === "ciphertext") {
            if (mode === "tamper") {
              frame.ciphertext =
                (frame.ciphertext[0] === "A" ? "B" : "A") +
                frame.ciphertext.slice(1);
              return original.call(this, JSON.stringify(frame));
            }
            original.call(this, data);
          }
        }
        return original.call(this, data);
      };
    }, attack);
    await send(a.page, "integrity fixture");
    await expect(
      b.page.getByRole("button", { name: "创建新房间" }),
    ).toBeVisible();
    expect(await b.page.locator(".message-text").count()).toBe(0);
    await expect(
      a.page.getByRole("button", { name: "创建新房间" }),
    ).toBeVisible();
    await a.context.close();
    await b.context.close();
  });

test("refresh or network loss ends both contexts without restoring messages", async ({
  browser,
}) => {
  for (const disconnect of ["refresh", "offline"]) {
    const { a, b } = await pair(browser);
    await send(a.page, "ephemeral fixture");
    await expect(b.page.locator(".message-text")).toHaveText([
      "ephemeral fixture",
    ]);
    if (disconnect === "refresh") await b.page.reload();
    else await b.context.setOffline(true);
    await expect(
      a.page.getByRole("button", { name: "创建新房间" }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("button", { name: "创建新房间" }),
    ).toBeVisible();
    expect(await a.page.locator(".message-text").count()).toBe(0);
    expect(await b.page.locator(".message-text").count()).toBe(0);
    await a.context.close();
    await b.context.close();
  }
});

test("UTF-8 byte limit accepts 2048 and blocks 2049", async ({ browser }) => {
  const { a, b } = await pair(browser);
  await a.page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("a".repeat(2049));
  await expect(a.page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await send(a.page, "a".repeat(2048));
  expect((await b.page.locator(".message-text").innerText()).length).toBe(2048);
  await a.context.close();
  await b.context.close();
});

test("waiting room expires and clears the invitation", async ({ browser }) => {
  test.skip(
    !shortTTLs,
    "Requires a dedicated instance configured with short test TTLs",
  );
  const a = await creator(browser);
  await expect(a.page.getByRole("heading", { name: "房间已过期" })).toBeVisible(
    { timeout: 15_000 },
  );
  expect(await a.page.getByLabel("邀请链接", { exact: true }).count()).toBe(0);
  const b = await receiver(browser, a.invite);
  await b.page.getByRole("button", { name: "加入会话", exact: true }).click();
  await expect(
    b.page.getByRole("button", { name: "创建新房间" }),
  ).toBeVisible();
  await a.context.close();
  await b.context.close();
});

test("a create request cancelled by offline can start a fresh room", async ({
  page,
}) => {
  let intercepted!: () => void;
  let release!: () => void;
  const requested = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/rooms", async (route) => {
    intercepted();
    await resume;
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "创建一次性房间" }).click();
  await requested;
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("button", { name: "创建新房间" })).toBeVisible();
  const response = page.waitForResponse("**/api/v1/rooms");
  release();
  await response;
  await page.unroute("**/api/v1/rooms");
  await page.getByRole("button", { name: "创建新房间" }).click();
  await expect(
    page.getByRole("heading", { name: "等待对方加入" }),
  ).toBeVisible();
});

test("active rooms expire at the absolute TTL and clear both views", async ({
  browser,
}) => {
  test.skip(
    !shortTTLs,
    "Requires a dedicated instance configured with short test TTLs",
  );
  const { a, b } = await pair(browser);
  await send(a.page, "absolute expiry fixture");
  await expect(b.page.locator(".message-text")).toHaveText([
    "absolute expiry fixture",
  ]);
  await expect(a.page.getByRole("heading", { name: "房间已过期" })).toBeVisible(
    { timeout: 35_000 },
  );
  await expect(
    b.page.getByRole("heading", { name: "房间已过期" }),
  ).toBeVisible();
  expect(await a.page.locator(".message-text").count()).toBe(0);
  expect(await b.page.locator(".message-text").count()).toBe(0);
  await a.context.close();
  await b.context.close();
});

test("production headers block inline scripts and cross-origin connections", async ({
  page,
}) => {
  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(
    headers["content-security-policy"].includes("default-src 'none'"),
  ).toBe(true);
  expect(
    headers["content-security-policy"].includes("frame-ancestors 'none'"),
  ).toBe(true);
  expect(headers["content-security-policy"].includes("unsafe-")).toBe(false);
  const blocked = await page.evaluate(async () => {
    const script = document.createElement("script");
    script.textContent = "window.inlineScriptExecuted = true";
    document.body.appendChild(script);
    let blockedFetch = false;
    try {
      await fetch("https://example.invalid/");
    } catch {
      blockedFetch = true;
    }
    return (
      !(window as unknown as { inlineScriptExecuted?: boolean })
        .inlineScriptExecuted && blockedFetch
    );
  });
  expect(blocked).toBe(true);
  await expect(
    page.getByRole("button", { name: "创建一次性房间" }),
  ).toBeVisible();
});

test("same-document navigation also removes a sensitive fragment", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "s=discard-this&t=discard-this";
  });
  await expect
    .poll(async () => ({
      runtimeClear: await page.evaluate(() => window.location.hash === ""),
      driverClear: new URL(page.url()).hash === "",
    }))
    .toEqual({ runtimeClear: true, driverClear: true });
  await expect(
    page.getByRole("button", { name: "创建一次性房间" }),
  ).toBeVisible();
});

test("desktop and mobile layouts remain within the viewport", async ({
  browser,
}, testInfo) => {
  const { a, b } = await pair(browser);
  await send(a.page, "这是一条测试消息，Hello Ghost Chat.");
  await send(b.page, "收到，会话结束后内容清空。");
  await a.page.bringToFront();
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["mobile", 390, 844],
    ["narrow", 320, 568],
  ] as const) {
    await a.page.setViewportSize({ width, height });
    await expect
      .poll(
        async () =>
          await a.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
      )
      .toBe(true);
    await expect
      .poll(async () => {
        const input = await a.page
          .getByRole("textbox", { name: "消息", exact: true })
          .boundingBox();
        return !!input && input.y >= 0 && input.y + input.height <= height;
      })
      .toBe(true);
    if (name !== "narrow")
      await a.page.screenshot({
        path: testInfo.outputPath(`${name}.png`),
        fullPage: true,
      });
  }
  await a.context.close();
  await b.context.close();
});
