import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("an actual server process restart clears views and invalidates old invitations", async ({
  browser,
}) => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const base = "http://127.0.0.1:18082";
  try {
    await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(500) });
    throw new Error("Restart test port already in use");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Restart test port already in use"
    )
      throw error;
  }
  async function launch() {
    const child = spawn(
      path.join(
        root,
        ".tools",
        process.platform === "win32" ? "e2e-server.exe" : "e2e-server",
      ),
      [],
      {
        stdio: "ignore",
        env: {
          ...process.env,
          ADDR: "127.0.0.1:18082",
          WEB_DIST_DIR: path.join(root, "web/dist"),
          ALLOWED_ORIGINS: base,
        },
      },
    );
    let exited = false;
    const exit = once(child, "exit").then(() => {
      exited = true;
    });
    const stop = async () => {
      if (!exited) child.kill();
      await exit;
    };
    try {
      await expect
        .poll(async () => {
          try {
            return (await fetch(`${base}/healthz`)).ok;
          } catch {
            return false;
          }
        })
        .toBe(true);
      return stop;
    } catch (error) {
      await stop();
      throw error;
    }
  }
  let stop = await launch();
  const aContext = await browser.newContext();
  const bContext = await browser.newContext();
  try {
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    await a.goto(base);
    await a.getByRole("button", { name: "创建一次性房间" }).click();
    await expect(
      a.getByRole("heading", { name: "等待对方加入" }),
    ).toBeVisible();
    const invite = await a.getByLabel("邀请链接", { exact: true }).inputValue();
    await b.goto(invite);
    await b.getByRole("button", { name: "加入会话", exact: true }).click();
    await expect(a.getByRole("log")).toBeVisible();
    await a
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("restart fixture");
    await a.getByRole("button", { name: "发送消息" }).click();
    await expect(b.locator(".message-text")).toHaveText(["restart fixture"]);
    await stop();
    await expect(a.getByRole("button", { name: "创建新房间" })).toBeVisible();
    await expect(b.getByRole("button", { name: "创建新房间" })).toBeVisible();
    expect(await a.locator(".message-text").count()).toBe(0);
    expect(await b.locator(".message-text").count()).toBe(0);
    stop = await launch();
    const reentry = await bContext.newPage();
    await reentry.goto(invite);
    await reentry
      .getByRole("button", { name: "加入会话", exact: true })
      .click();
    await expect(
      reentry.getByRole("heading", { name: "邀请已失效或已被使用" }),
    ).toBeVisible();
  } finally {
    await stop();
    await aContext.close();
    await bContext.close();
  }
});
