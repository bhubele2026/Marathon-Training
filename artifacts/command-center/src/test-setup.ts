// Vitest/jsdom setup for the command-center package.
//
// jsdom doesn't implement `matchMedia`, which framer-motion's
// `useReducedMotion()` and the responsive hooks rely on. We mock it so that:
//   - prefers-reduced-motion resolves TRUE in tests → all mount animations
//     (count-ups, ring fills) render their FINAL value instantly and
//     deterministically, so assertions see real numbers, not mid-animation 0s;
//   - every other media query resolves false (a stable desktop default).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
