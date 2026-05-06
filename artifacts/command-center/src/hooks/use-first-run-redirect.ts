import { useEffect } from "react";
import { useLocation } from "wouter";

// Task #308: first-run flow that nudges new runners straight into the
// Phase Planner instead of dropping them on an empty dashboard with
// nothing but a CTA. The plan-driven pages (`/`, `/today`, `/plan`,
// `/plan/:week`) call this hook with whatever signals their data
// queries expose; when no plan has ever been applied AND the runner
// has no in-flight planner drafts, we navigate to `/planner` exactly
// once per browser session so they can build their first plan without
// an extra click.
//
// The `ready` gate exists so callers can defer the decision until both
// the `hasPlan` query AND the `hasDrafts` query have produced an
// authoritative answer. We deliberately AVOID inferring "no plan"
// from a request error (e.g. a 5xx on /api/plan/week/:n) because that
// would yank the runner away from a real-but-broken page.
//
// Behavior:
//   - ready === false → no-op (still loading or in an error state).
//   - hasPlan === true → clear the session flag so a subsequent Full
//     Reset (which flips hasPlan back to false) re-arms the redirect.
//   - hasPlan === false AND hasDrafts === false AND flag unset → set
//     the flag and navigate to `/planner` (one-shot per session).
//   - hasPlan === false AND hasDrafts === true → no redirect (the
//     runner already has saved planner configs and just hasn't
//     applied one yet — they know how to find the planner).
//
// Using sessionStorage (not localStorage) means a fresh tab / new
// browser session re-triggers the redirect as long as no plan has
// been applied, which is what we want for "Works after Full Reset as
// well as on a fresh install".

export const FIRST_RUN_REDIRECT_FLAG = "command-center.firstRunRedirected.v1";

export interface FirstRunRedirectInput {
  // True once any plan has been applied to the campaign (`hasPlan` on
  // /api/dashboard/summary, /api/plan/overview, etc).
  hasPlan: boolean;
  // True if the runner has at least one saved planner config draft on
  // the server. Sourced from the planner-configs list endpoint.
  hasDrafts: boolean;
  // True only when both upstream queries have resolved with
  // authoritative data. While loading, or while the underlying request
  // is in an error state, pass `false` so we don't redirect on
  // transient failures.
  ready: boolean;
}

export function useFirstRunRedirect(input: FirstRunRedirectInput): void {
  const [, navigate] = useLocation();
  const { hasPlan, hasDrafts, ready } = input;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!ready) return;

    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      // sessionStorage may be unavailable (private mode, restrictive
      // policies). Skip the redirect rather than risk an infinite loop
      // with no way to remember we already redirected.
      return;
    }
    if (!storage) return;

    if (hasPlan) {
      try {
        storage.removeItem(FIRST_RUN_REDIRECT_FLAG);
      } catch {
        // Ignore storage write failures.
      }
      return;
    }

    // No plan applied yet. Only redirect if the runner truly has
    // nothing in flight — having saved drafts means they've already
    // discovered the planner and we should let them choose when to
    // re-enter it.
    if (hasDrafts) return;

    let alreadyRedirected = false;
    try {
      alreadyRedirected = storage.getItem(FIRST_RUN_REDIRECT_FLAG) === "1";
    } catch {
      return;
    }
    if (alreadyRedirected) return;

    try {
      storage.setItem(FIRST_RUN_REDIRECT_FLAG, "1");
    } catch {
      // If we can't persist the flag, bail out rather than risk a loop.
      return;
    }
    navigate("/planner");
  }, [hasPlan, hasDrafts, ready, navigate]);
}
