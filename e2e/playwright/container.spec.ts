import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { baseURL, containerTarget, pair, receiver, send } from "./support";

test("isolated production container restart clears both peers and invalidates its invitation", async ({
  browser,
}) => {
  test.skip(!containerTarget, "Requires the dedicated HTTPS container runner");
  const project = process.env.E2E_COMPOSE_PROJECT || "";
  const file = process.env.E2E_COMPOSE_FILE || "";
  const expectedFile = fileURLToPath(
    new URL("../../deploy/compose.e2e.yaml", import.meta.url),
  );
  if (
    !/^ghost-chat-tls-[a-z0-9-]+$/.test(project) ||
    path.resolve(file) !== path.resolve(expectedFile)
  ) {
    throw new Error(
      "Container restart is restricted to the isolated E2E Compose project",
    );
  }
  const { a, b } = await pair(browser);
  let reentry: Awaited<ReturnType<typeof receiver>> | undefined;
  try {
    await send(a.page, "container restart fixture");
    await expect(b.page.locator(".message-text")).toHaveText([
      "container restart fixture",
    ]);
    const restarted = spawnSync(
      "docker",
      [
        "compose",
        "--project-name",
        project,
        "--file",
        file,
        "restart",
        "ghost-chat",
      ],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    if (restarted.status !== 0)
      throw new Error("Isolated E2E application restart failed");
    await expect(
      a.page.getByRole("button", { name: "创建新房间" }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("button", { name: "创建新房间" }),
    ).toBeVisible();
    expect(await a.page.locator(".message-text").count()).toBe(0);
    expect(await b.page.locator(".message-text").count()).toBe(0);
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${baseURL}/healthz`)).ok;
          } catch {
            return false;
          }
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    reentry = await receiver(browser, a.invite);
    await reentry.page
      .getByRole("button", { name: "加入会话", exact: true })
      .click();
    await expect(
      reentry.page.getByRole("heading", { name: "邀请已失效或已被使用" }),
    ).toBeVisible();
  } finally {
    await reentry?.context.close();
    await a.context.close();
    await b.context.close();
  }
});
