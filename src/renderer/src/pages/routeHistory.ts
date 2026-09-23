export type RouteTravelDirection = "back" | "forward";

/**
 * Normalised route IDs only. Query strings, hashes, drawers and selected
 * entities are outside this history: each destination page is responsible for
 * restoring its own persisted view state.
 */
export interface RouteHistorySnapshot {
  back: readonly string[];
  forward: readonly string[];
}

export const MAX_ROUTE_HISTORY_ENTRIES = 50;

export function emptyRouteHistory(): RouteHistorySnapshot {
  return { back: [], forward: [] };
}

function cleanRoute(route: string): string {
  return route.trim();
}

/**
 * Record a completed move from `previous` to `next`.
 *
 * Consecutive duplicates and empty IDs are ignored. A newly selected
 * destination always clears the forward stack, matching browser behaviour.
 */
export function recordRouteVisit(
  history: RouteHistorySnapshot,
  previous: string,
  next: string,
): RouteHistorySnapshot {
  const from = cleanRoute(previous);
  const to = cleanRoute(next);
  if (!from || !to || from === to) return history;
  return {
    back: [...history.back, from].slice(-MAX_ROUTE_HISTORY_ENTRIES),
    forward: [],
  };
}

export interface RouteTravel {
  target: string | null;
  history: RouteHistorySnapshot;
}

/**
 * Move one step through previously visited routes.
 *
 * A same-route target is treated as "do nothing" so callers never create
 * redundant navigations or alter either stack.
 */
export function travelRouteHistory(
  history: RouteHistorySnapshot,
  current: string,
  direction: RouteTravelDirection,
): RouteTravel {
  const here = cleanRoute(current);
  if (direction === "back") {
    const target = history.back.length > 0 ? history.back[history.back.length - 1] : null;
    if (!target || target === here) return { target: null, history };
    return {
      target,
      history: {
        back: history.back.slice(0, -1),
        forward: [here, ...history.forward].slice(0, MAX_ROUTE_HISTORY_ENTRIES),
      },
    };
  }

  const target = history.forward.length > 0 ? history.forward[0] : null;
  if (!target || target === here) return { target: null, history };
  return {
    target,
    history: {
      back: [...history.back, here].slice(-MAX_ROUTE_HISTORY_ENTRIES),
      forward: history.forward.slice(1),
    },
  };
}
