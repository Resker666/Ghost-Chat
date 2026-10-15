import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationQR } from "../src/components/InvitationQR";

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  canvas: null as unknown,
  status: vi.fn(),
  toCanvas: vi.fn(),
}));
vi.mock("react", () => ({
  useLayoutEffect: (effect: () => void | (() => void)) =>
    mocks.effects.push(effect),
  useRef: () => ({ current: mocks.canvas }),
  useState: (initial: unknown) => [initial, mocks.status],
}));
vi.mock("qrcode", () => ({ toCanvas: mocks.toCanvas }));

const invitation = "https://chat.example/r/test-room#s=test-only&t=test-only";
let cleanup: void | (() => void);

function canvas() {
  const context = { drawImage: vi.fn() };
  return {
    width: 256,
    height: 256,
    context,
    getContext: () => context,
  };
}

function mount() {
  const visible = canvas();
  const staging = canvas();
  mocks.canvas = visible;
  vi.stubGlobal("document", { createElement: () => staging });
  InvitationQR({ value: invitation });
  cleanup = mocks.effects[0]();
  return { visible, staging };
}

beforeEach(() => {
  mocks.effects.length = 0;
  mocks.status.mockReset();
  mocks.toCanvas.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  if (cleanup) cleanup();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

describe("invitation QR rendering lifecycle", () => {
  it("commits a local rendering and erases the staging buffer", async () => {
    const { visible, staging } = mount();
    await vi.dynamicImportSettled();
    expect(mocks.toCanvas).toHaveBeenCalledTimes(1);
    expect(visible.context.drawImage).toHaveBeenCalledWith(staging, 0, 0);
    expect(mocks.status).toHaveBeenLastCalledWith("ready");
    expect(staging.width).toBe(0);
    expect(staging.height).toBe(0);
  });

  it("never starts rendering after dismissal during module loading", async () => {
    const { visible } = mount();
    if (cleanup) cleanup();
    cleanup = undefined;
    mocks.status.mockClear();
    await vi.dynamicImportSettled();
    expect(mocks.toCanvas).not.toHaveBeenCalled();
    expect(visible.context.drawImage).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(visible.width).toBe(0);
    expect(visible.height).toBe(0);
  });

  it("erases buffers and rejects a late render commit after dismissal", async () => {
    let complete!: () => void;
    mocks.toCanvas.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const { visible, staging } = mount();
    await vi.dynamicImportSettled();
    expect(mocks.toCanvas).toHaveBeenCalledTimes(1);
    if (cleanup) cleanup();
    cleanup = undefined;
    mocks.status.mockClear();
    // A renderer completing late may refill its private staging bitmap.
    staging.width = 256;
    staging.height = 256;
    complete();
    await Promise.resolve();
    expect(visible.context.drawImage).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect([
      visible.width,
      visible.height,
      staging.width,
      staging.height,
    ]).toEqual([0, 0, 0, 0]);
  });

  it("clears the visible buffer and exposes only a fixed error state", async () => {
    mocks.toCanvas.mockRejectedValueOnce(new Error(invitation));
    const { visible, staging } = mount();
    await vi.dynamicImportSettled();
    expect(visible.context.drawImage).not.toHaveBeenCalled();
    expect(mocks.status).toHaveBeenLastCalledWith("error");
    expect([
      visible.width,
      visible.height,
      staging.width,
      staging.height,
    ]).toEqual([0, 0, 0, 0]);
  });
});
