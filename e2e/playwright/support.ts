import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

export const externalTarget = Boolean(process.env.E2E_BASE_URL);
export const shortTTLs = !externalTarget || process.env.E2E_SHORT_TTLS === "1";
export const containerTarget = process.env.E2E_CONTAINER === "1";

function targetOrigin(): string {
  let url: URL;
  try {
    url = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:18080");
  } catch {
    throw new Error("E2E_BASE_URL must be an HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error(
      "E2E_BASE_URL must be a secure origin without credentials, path, query or fragment",
    );
  if (containerTarget && (!externalTarget || url.protocol !== "https:"))
    throw new Error("Container E2E requires an explicit HTTPS origin");
  return url.origin;
}

export const baseURL = targetOrigin();

type PrivacyCounters = {
  storage: number;
  database: number;
  cache: number;
  worker: number;
};
declare global {
  interface Window {
    __ghostTestPrivacy: PrivacyCounters;
  }
}

async function instrumentStorage(context: BrowserContext) {
  await context.addInitScript(() => {
    const count = { storage: 0, database: 0, cache: 0, worker: 0 };
    Object.defineProperty(window, "__ghostTestPrivacy", { value: count });
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      count.storage++;
      return setItem.call(this, key, value);
    };
    const openDB = indexedDB.open;
    indexedDB.open = function (name, version) {
      count.database++;
      return version === undefined
        ? openDB.call(this, name)
        : openDB.call(this, name, version);
    };
    if ("caches" in window) {
      const openCache = caches.open;
      caches.open = function (name) {
        count.cache++;
        return openCache.call(this, name);
      };
    }
    if ("serviceWorker" in navigator) {
      const register = navigator.serviceWorker.register;
      navigator.serviceWorker.register = function (url, options) {
        count.worker++;
        return register.call(this, url, options);
      };
    }
  });
}

async function client(browser: Browser) {
  const context = await browser.newContext();
  await instrumentStorage(context);
  const page = await context.newPage();
  const requests: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) =>
    requests.push(`${request.url()} ${request.postData() || ""}`),
  );
  page.on("websocket", (socket) => sockets.push(socket.url()));
  return { context, page, requests, sockets };
}

export async function creator(browser: Browser) {
  const current = await client(browser);
  await current.page.goto("/");
  await current.page.getByRole("button", { name: "创建一次性房间" }).click();
  await expect(
    current.page.getByRole("heading", { name: "等待对方加入" }),
  ).toBeVisible();
  const invite = await current.page
    .getByLabel("邀请链接", { exact: true })
    .inputValue();
  return { ...current, invite };
}

export async function openInvite(page: Page, invite: string, origin = baseURL) {
  // Navigate through page code so a failed goto cannot print a complete invitation.
  await page.goto(origin);
  await page.evaluate((url) => {
    window.location.assign(url);
  }, invite);
  await expect(page.getByRole("heading", { name: "加入会话" })).toBeVisible();
  expect(new URL(page.url()).hash === "").toBe(true);
}

export async function receiver(browser: Browser, invite: string) {
  const current = await client(browser);
  await openInvite(current.page, invite);
  return current;
}

export async function pair(browser: Browser) {
  const a = await creator(browser);
  const b = await receiver(browser, a.invite);
  await b.page.getByRole("button", { name: "加入会话", exact: true }).click();
  await expect(a.page.getByRole("log")).toBeVisible();
  await expect(b.page.getByRole("log")).toBeVisible();
  return { a, b };
}

export async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送消息" }).click();
}

export async function storageIsEmpty(context: BrowserContext, page: Page) {
  expect((await context.cookies()).length).toBe(0);
  expect(
    await page.evaluate(async () => {
      const databases =
        typeof indexedDB.databases === "function"
          ? await indexedDB.databases()
          : [];
      const cacheNames = "caches" in window ? await caches.keys() : [];
      const workers =
        "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistrations()
          : [];
      return (
        localStorage.length === 0 &&
        sessionStorage.length === 0 &&
        databases.length === 0 &&
        cacheNames.length === 0 &&
        workers.length === 0 &&
        Object.values(window.__ghostTestPrivacy).every((count) => count === 0)
      );
    }),
  ).toBe(true);
}
