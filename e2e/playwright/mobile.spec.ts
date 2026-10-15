import { test, expect } from "@playwright/test";
import { baseURL, creator, pair, receiver, send } from "./support";

test("safety dialog cycles focus and restores its visible entry", async ({
  page,
}) => {
  await page.goto("/");
  const entry = page.getByRole("button", { name: "安全与隐私", exact: true });
  await entry.click();
  const dialog = page.getByRole("dialog");
  const close = dialog.getByRole("button", { name: "关闭安全说明" });
  const back = dialog.getByRole("button", { name: "返回会话" });
  await expect(close).toBeFocused();
  await close.press("Tab");
  await expect(back).toBeFocused();
  await back.press("Tab");
  await expect(close).toBeFocused();
  await close.press("Shift+Tab");
  await expect(back).toBeFocused();
  await back.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test("short mobile viewport keeps the composer and send button visible", async ({
  browser,
}) => {
  const { a, b } = await pair(browser);
  await send(a.page, "small viewport fixture");
  await a.page.setViewportSize({ width: 390, height: 320 });
  const input = a.page.getByRole("textbox", { name: "消息", exact: true });
  await input.focus();
  for (const control of [
    input,
    a.page.getByRole("button", { name: "发送消息" }),
  ]) {
    const bounds = await control.boundingBox();
    expect(!!bounds && bounds.y >= 0 && bounds.y + bounds.height <= 320).toBe(
      true,
    );
  }
  expect(
    await a.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await a.context.close();
  await b.context.close();
});

test("IME confirmation Enter does not send and Shift Enter preserves a newline", async ({
  browser,
}) => {
  const { a, b } = await pair(browser);
  const input = a.page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("中文候选");
  await input.dispatchEvent("compositionstart", { data: "中文候选" });
  await input.dispatchEvent("compositionend", { data: "中文候选" });
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
    which: 229,
    isComposing: false,
    bubbles: true,
    cancelable: true,
  });
  await expect(input).toHaveValue("中文候选");
  expect(await b.page.locator(".message-text").count()).toBe(0);
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await a.page.keyboard.insertText("第二行");
  await expect(input).toHaveValue("第一行\n第二行");
  await a.page.getByRole("button", { name: "发送消息" }).click();
  await expect(b.page.locator(".message-text")).toHaveText(["第一行\n第二行"]);
  await a.context.close();
  await b.context.close();
});

test("history navigation never restores an ended conversation", async ({
  browser,
}) => {
  const { a, b } = await pair(browser);
  await send(a.page, "history fixture");
  await expect(b.page.locator(".message-text")).toHaveText(["history fixture"]);
  await b.page.goto(baseURL);
  await expect(
    a.page.getByRole("button", { name: "创建新房间" }),
  ).toBeVisible();
  await b.page.goBack();
  await expect(
    b.page.getByRole("button", { name: "创建新房间" }),
  ).toBeVisible();
  expect(await b.page.locator(".message-text").count()).toBe(0);
  expect(new URL(b.page.url()).hash === "").toBe(true);
  await a.context.close();
  await b.context.close();
});

test("clipboard rejection requires explicit reveal before manual copy", async ({
  browser,
}) => {
  const a = await creator(browser);
  const b = await receiver(browser, a.invite);
  await a.page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Denied by test fixture", "NotAllowedError");
        },
      },
    });
  });
  await a.page
    .getByRole("button", { name: "复制邀请链接", exact: true })
    .click();
  const reveal = a.page.getByRole("button", { name: "显示邀请链接以手动复制" });
  await expect(reveal).toBeVisible();
  await expect
    .poll(() =>
      a.page.evaluate(() => {
        const input = document.querySelector("#invite");
        return input instanceof HTMLInputElement && input.type === "password";
      }),
    )
    .toBe(true);
  await reveal.click();
  await expect
    .poll(() =>
      a.page.evaluate(() => {
        const input = document.querySelector("#invite");
        return (
          input instanceof HTMLInputElement &&
          input.getAttribute("aria-label") === "手动复制邀请链接" &&
          input.type === "text" &&
          document.activeElement === input &&
          input.selectionStart === 0 &&
          input.selectionEnd === input.value.length
        );
      }),
    )
    .toBe(true);
  await b.page.getByRole("button", { name: "加入会话", exact: true }).click();
  await expect(a.page.getByRole("log")).toBeVisible();
  await expect
    .poll(() =>
      a.page.evaluate(() => document.querySelector("#invite") === null),
    )
    .toBe(true);
  await expect(reveal).toHaveCount(0);
  await a.context.close();
  await b.context.close();
});

test("clipboard success uses the invitation without touching the system clipboard", async ({
  browser,
}) => {
  const a = await creator(browser);
  await a.page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { __copyMatches: boolean }).__copyMatches =
            value ===
            document.querySelector<HTMLInputElement>("#invite")?.value;
        },
      },
    });
  });
  await a.page
    .getByRole("button", { name: "复制邀请链接", exact: true })
    .click();
  await expect(a.page.getByText("已复制", { exact: true })).toBeVisible();
  expect(
    await a.page.evaluate(
      () => (window as unknown as { __copyMatches: boolean }).__copyMatches,
    ),
  ).toBe(true);
  await a.context.close();
});

test("visual viewport resize keeps controls above a simulated keyboard", async ({
  browser,
}) => {
  const { a, b } = await pair(browser);
  await a.page.setViewportSize({ width: 390, height: 844 });
  await a.page.getByRole("textbox", { name: "消息", exact: true }).focus();
  await a.page.evaluate(() => {
    if (!window.visualViewport) throw new Error("VisualViewport unavailable");
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 340,
    });
    Object.defineProperty(window.visualViewport, "offsetTop", {
      configurable: true,
      value: 0,
    });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(async () => {
      const bounds = await a.page
        .getByRole("button", { name: "发送消息" })
        .boundingBox();
      return !!bounds && bounds.y >= 0 && bounds.y + bounds.height <= 340;
    })
    .toBe(true);
  await a.context.close();
  await b.context.close();
});

test("ending after clipboard rejection clears the obsolete copy error", async ({
  browser,
}) => {
  const a = await creator(browser);
  await a.page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Denied by test fixture", "NotAllowedError");
        },
      },
    });
  });
  await a.page
    .getByRole("button", { name: "复制邀请链接", exact: true })
    .click();
  await expect(a.page.getByRole("alert")).toBeVisible();
  await a.page.getByRole("button", { name: "销毁会话" }).click();
  await expect(
    a.page.getByRole("heading", { name: "会话已销毁" }),
  ).toBeVisible();
  await expect(a.page.getByRole("alert")).toHaveCount(0);
  await a.context.close();
});

test("a short desktop window can still open and close the safety dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 320 });
  await page.goto("/");
  const entry = page.getByRole("button", { name: "安全与隐私", exact: true });
  await entry.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭安全说明" }).click();
  await expect(entry).toBeFocused();
});
