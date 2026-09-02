import { vi } from "vitest";

/**
 * Shared jsdom shims for component tests. jsdom implements neither `matchMedia`
 * nor the pointer-capture / observer APIs that some libraries reach for.
 */

/**
 * Install a `window.matchMedia` stub. `matches` may be a boolean or a predicate
 * on the query string, so a test can target one breakpoint:
 *
 *   stubMatchMedia((q) => q.includes("920"));   // pretend the viewport is <=920px
 *
 * Call `vi.unstubAllGlobals()` in `afterEach` to remove it.
 */
export function stubMatchMedia(
  matches: boolean | ((query: string) => boolean),
): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: typeof matches === "function" ? matches(query) : matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/**
 * Install the no-op DOM APIs `@radix-ui` primitives call on mount but jsdom
 * lacks. Safe to call more than once.
 */
export function stubRadixEnv(): void {
  if (!("ResizeObserver" in globalThis)) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  }
  const proto = Element.prototype as unknown as Record<string, () => unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
}
