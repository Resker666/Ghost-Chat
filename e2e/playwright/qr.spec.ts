import { test, expect, type Locator, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { baseURL, creator, receiver } from "./support";

function qr(page: Page) {
  return page.getByRole("img", { name: "一次性邀请二维码", exact: true });
}

async function verifyPixels(canvas: Locator, invitation: string) {
  await expect
    .poll(async () => {
      const image = await canvas.evaluate((element: HTMLCanvasElement) => {
        if (!element.width || !element.height) return null;
        const context = element.getContext("2d");
        if (!context) return null;
        return {
          width: element.width,
          height: element.height,
          data: Array.from(
            context.getImageData(0, 0, element.width, element.height).data,
          ),
        };
      });
      if (!image) return false;
      return (
        jsQR(new Uint8ClampedArray(image.data), image.width, image.height, {
          inversionAttempts: "dontInvert",
        })?.data === invitation
      );
    })
    .toBe(true);
}

test("local invitation QR decodes to the full invitation with same-origin requests only", async ({
  browser,
}) => {
  const a = await creator(browser);
  try {
    await expect(qr(a.page)).toHaveCount(0);
    await a.page
      .getByRole("button", { name: "显示邀请二维码", exact: true })
      .click();
    await verifyPixels(qr(a.page), a.invite);
    const secret = new URLSearchParams(new URL(a.invite).hash.slice(1)).get(
      "s",
    )!;
    expect(
      a.requests.every(
        (raw) =>
          !raw.includes(secret) &&
          !raw.includes("#") &&
          new URL(raw.split(" ")[0]).origin === baseURL,
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        a.page.evaluate(() => {
          const input = document.querySelector("#invite");
          return input instanceof HTMLInputElement && input.type === "password";
        }),
      )
      .toBe(true);
  } finally {
    await a.context.close();
  }
});

test("hiding and destroying an invitation QR clears its canvas buffer", async ({
  browser,
}) => {
  const a = await creator(browser);
  try {
    await a.page
      .getByRole("button", { name: "显示邀请二维码", exact: true })
      .click();
    await verifyPixels(qr(a.page), a.invite);
    const hidden = await qr(a.page).elementHandle();
    if (!hidden) throw new Error("QR canvas missing");
    await a.page
      .getByRole("button", { name: "隐藏邀请二维码", exact: true })
      .click();
    await expect(qr(a.page)).toHaveCount(0);
    await expect
      .poll(() =>
        hidden.evaluate(
          (element) =>
            element instanceof HTMLCanvasElement &&
            element.width === 0 &&
            element.height === 0,
        ),
      )
      .toBe(true);
    await hidden.dispose();
    await a.page
      .getByRole("button", { name: "显示邀请二维码", exact: true })
      .click();
    await verifyPixels(qr(a.page), a.invite);
    const destroyed = await qr(a.page).elementHandle();
    if (!destroyed) throw new Error("QR canvas missing");
    await a.page.getByRole("button", { name: "销毁会话" }).click();
    await expect(
      a.page.getByRole("heading", { name: "会话已销毁" }),
    ).toBeVisible();
    await expect(qr(a.page)).toHaveCount(0);
    await expect
      .poll(() =>
        destroyed.evaluate(
          (element) =>
            element instanceof HTMLCanvasElement &&
            element.width === 0 &&
            element.height === 0,
        ),
      )
      .toBe(true);
    await destroyed.dispose();
  } finally {
    await a.context.close();
  }
});

test("peer admission removes and clears the displayed invitation QR", async ({
  browser,
}) => {
  const a = await creator(browser);
  const b = await receiver(browser, a.invite);
  try {
    await a.page
      .getByRole("button", { name: "显示邀请二维码", exact: true })
      .click();
    await verifyPixels(qr(a.page), a.invite);
    const retired = await qr(a.page).elementHandle();
    if (!retired) throw new Error("QR canvas missing");
    await b.page.getByRole("button", { name: "加入会话", exact: true }).click();
    await expect(a.page.getByRole("log")).toBeVisible();
    await expect(qr(a.page)).toHaveCount(0);
    await expect
      .poll(() =>
        retired.evaluate(
          (element) =>
            element instanceof HTMLCanvasElement &&
            element.width === 0 &&
            element.height === 0,
        ),
      )
      .toBe(true);
    await retired.dispose();
    await expect(
      a.page.getByRole("button", { name: "显示邀请二维码", exact: true }),
    ).toHaveCount(0);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("a late QR module load cannot redraw a destroyed invitation", async ({
  browser,
}) => {
  const a = await creator(browser);
  let release!: () => void;
  let intercepted!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  try {
    await a.page.route("**/assets/*.js", async (route) => {
      intercepted();
      await held;
      await route.continue();
    });
    await a.page
      .getByRole("button", { name: "显示邀请二维码", exact: true })
      .click();
    await requested;
    const retired = await qr(a.page).elementHandle();
    if (!retired) throw new Error("QR canvas missing");
    await a.page.getByRole("button", { name: "销毁会话" }).click();
    const loaded = a.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/assets/") &&
        response.url().endsWith(".js"),
    );
    release();
    const response = await loaded;
    await response.finished();
    await a.page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(
      a.page.getByRole("heading", { name: "会话已销毁" }),
    ).toBeVisible();
    await expect(qr(a.page)).toHaveCount(0);
    await expect
      .poll(() =>
        retired.evaluate(
          (element) =>
            element instanceof HTMLCanvasElement &&
            element.width === 0 &&
            element.height === 0,
        ),
      )
      .toBe(true);
    await retired.dispose();
  } finally {
    release?.();
    await a.context.close();
  }
});
