import { useEffect } from "react";

export function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const style = document.documentElement.style;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      // Preserve pinch zoom instead of reflowing the app to the zoomed viewport.
      if (Math.abs(viewport.scale - 1) > 0.01 || viewport.height <= 0) return;
      style.setProperty("--visual-viewport-height", `${viewport.height}px`);
      style.setProperty(
        "--visual-viewport-top",
        `${Math.max(0, viewport.offsetTop)}px`,
      );
    };
    const schedule = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      style.removeProperty("--visual-viewport-height");
      style.removeProperty("--visual-viewport-top");
    };
  }, []);
}
