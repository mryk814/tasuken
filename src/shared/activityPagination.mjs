import { sha256Hex } from "./canonicalMarkdown.mjs";

function digest(value) {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(value)));
}

/** Cursor contains only digests and an offset; never entity IDs or hidden values. */
export function paginateActivity(projected, { criteria, exclusions, limit, cursor, period }) {
  const query = digest(criteria);
  // A changed public projection or exclusion count invalidates all following pages.
  // Re-projecting on every call also applies current policy before returning any row.
  const revision = digest([projected, exclusions]);
  let offset = 0;
  let status = "ok";
  if (cursor != null && cursor !== "") {
    const match =
      typeof cursor === "string" && cursor.length <= 200
        ? /^a1\.([a-f0-9]{64})\.([a-f0-9]{64})\.([1-9][0-9]{0,14})$/.exec(cursor)
        : null;
    if (!match || match[1] !== query) status = "invalid_cursor";
    else if (match[2] !== revision) status = "resync_required";
    else {
      offset = Number(match[3]);
      if (!Number.isSafeInteger(offset) || offset >= projected.length) status = "invalid_cursor";
    }
  }
  const events = status === "ok" ? projected.slice(offset, offset + limit) : [];
  const truncated = status === "ok" && offset + events.length < projected.length;
  return {
    events,
    truncated,
    page: {
      status,
      period,
      limit,
      returned_count: events.length,
      offset: status === "ok" ? offset : null,
      matched_visible_count: status === "ok" ? projected.length : null,
      next_cursor: truncated ? `a1.${query}.${revision}.${offset + events.length}` : null,
      revision,
      generated_at: new Date().toISOString(),
    },
  };
}

/** Dates select whole local calendar days; offset timestamps select instants, inclusive. */
export function activityBoundaryMatches(value, boundary, side, localDate) {
  if (!boundary) return true;
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(boundary);
  const timestampForm =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      boundary,
    );
  const day = dayOnly ? boundary : timestampForm?.[1];
  const dayTimestamp = day ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (!Number.isFinite(dayTimestamp) || new Date(dayTimestamp).toISOString().slice(0, 10) !== day)
    throw new Error("Activity period requires a valid calendar date or offset timestamp");
  if (dayOnly) {
    return side === "from" ? localDate >= boundary : localDate <= boundary;
  }
  if (!Number.isFinite(Date.parse(boundary)))
    throw new Error("Activity period requires an offset timestamp or calendar date");
  const timestamp = Date.parse(value);
  return side === "from" ? timestamp >= Date.parse(boundary) : timestamp <= Date.parse(boundary);
}
