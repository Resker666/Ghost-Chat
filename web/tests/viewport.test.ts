import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisualViewport } from "../src/hooks/useVisualViewport";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));

class TestViewport extends EventTarget {
  height = 640;
  offsetTop = 0;
  scale = 1;
}

let cleanup: void | (() => void);

function mount(viewport: TestViewport | null = new TestViewport()) {
  const styles = new Map<string, string>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("window", {
    visualViewport: viewport,
    requestAnimationFrame(callback: FrameRequestCallback) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame(frame: number) {
      frames.delete(frame);
    },
  });
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        setProperty(name: string, value: string) {
          styles.set(name, value);
        },
        removeProperty(name: string) {
          styles.delete(name);
        },
      },
    },
  });
  useVisualViewport();
  cleanup = effects[0]();
  return {
    styles,
    frames,
    flush() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(0);
    },
  };
}

beforeEach(() => {
  effects.length = 0;
});
afterEach(() => {
  if (cleanup) cleanup();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

describe("visual viewport lifecycle", () => {
  it("adapts to a reduced visible area and coalesces resize and scroll events", () => {
    const viewport = new TestViewport();
    const { styles, frames, flush } = mount(viewport);
    expect(styles.get("--visual-viewport-height")).toBe("640px");
    viewport.height = 280;
    viewport.offsetTop = 48;
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    expect(frames.size).toBe(1);
    flush();
    expect(styles.get("--visual-viewport-height")).toBe("280px");
    expect(styles.get("--visual-viewport-top")).toBe("48px");
  });

  it("preserves pinch zoom without reflowing and resumes after zoom resets", () => {
    const viewport = new TestViewport();
    const { styles, flush } = mount(viewport);
    viewport.scale = 2;
    viewport.height = 320;
    viewport.dispatchEvent(new Event("resize"));
    flush();
    expect(styles.get("--visual-viewport-height")).toBe("640px");
    viewport.scale = 1;
    viewport.height = 480;
    viewport.dispatchEvent(new Event("resize"));
    flush();
    expect(styles.get("--visual-viewport-height")).toBe("480px");
  });

  it("cancels pending updates and removes observers and styles when unmounted", () => {
    const viewport = new TestViewport();
    const { styles, frames } = mount(viewport);
    viewport.dispatchEvent(new Event("resize"));
    expect(frames.size).toBe(1);
    if (cleanup) cleanup();
    cleanup = undefined;
    expect(frames.size).toBe(0);
    expect(styles.size).toBe(0);
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    expect(frames.size).toBe(0);
  });

  it("leaves CSS dynamic viewport fallback intact when the API is absent", () => {
    const { styles, frames } = mount(null);
    expect(styles.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(cleanup).toBeUndefined();
  });
});
