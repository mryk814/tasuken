function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function snapshot(value, id) {
  try {
    const record = typeof value === "string" ? JSON.parse(value) : value;
    return record &&
      typeof record === "object" &&
      !Array.isArray(record) &&
      (!record.id || String(record.id) === String(id))
      ? record
      : null;
  } catch {
    return null;
  }
}

function title(record) {
  return text(record?.title) || text(record?.name);
}

function themeRef(record) {
  if (!record || (!Object.hasOwn(record, "project_id") && !Object.hasOwn(record, "theme_id")))
    return null;
  const id = text(record.project_id || record.theme_id);
  return id ? { kind: "theme", id } : { kind: "none", id: null };
}

/** Resolve only identity/labels from saved evidence; never return snapshot bodies. */
export function createActivityHistoryResolver(events) {
  const themeHistory = new Map();
  for (const event of events) {
    const type = event.entity_ref?.type || event.entity_type;
    const id = event.entity_ref?.id || event.entity_id;
    if (!["theme", "project"].includes(type) || !id) continue;
    const time = Date.parse(event.occurred_at || event.changed_at);
    if (!Number.isFinite(time)) continue;
    const changes = themeHistory.get(id) || [];
    changes.push({
      time,
      id: text(event.id),
      after: snapshot(event.after_json ?? event.after, id),
      before: snapshot(event.before_json ?? event.before, id),
    });
    themeHistory.set(id, changes);
  }
  for (const changes of themeHistory.values())
    changes.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));

  return (event, currentEntity, themesById) => {
    const entityId = event.entity_ref?.id || event.entity_id;
    // A supplemental Capture row describes the current record, not a versioned snapshot.
    const supplemental = event.origin?.kind === "capture_read_model";
    const after = supplemental ? null : snapshot(event.after_json ?? event.after, entityId);
    const before = supplemental ? null : snapshot(event.before_json ?? event.before, entityId);
    const afterTitle = title(after);
    const beforeTitle = title(before);
    const currentTitle = title(currentEntity);
    const eventTheme =
      !supplemental &&
      event.theme_ref &&
      ["theme", "none"].includes(event.theme_ref.kind) &&
      (event.theme_ref.kind === "none" || text(event.theme_ref.id))
        ? {
            kind: event.theme_ref.kind,
            id: event.theme_ref.kind === "theme" ? text(event.theme_ref.id) : null,
          }
        : null;
    const afterTheme = themeRef(after);
    const beforeTheme = themeRef(before);
    const historicalTheme = eventTheme || afterTheme || beforeTheme || { kind: "none", id: null };
    const currentTheme = themeRef(currentEntity) || { kind: "none", id: null };
    const themeChanges = themeHistory.get(historicalTheme.id) || [];
    const time = Date.parse(event.occurred_at || event.changed_at);
    const prior = [...themeChanges]
      .reverse()
      .find((change) => change.time <= time && title(change.after));
    const following = themeChanges.find((change) => change.time > time && title(change.before));
    const currentHistoricalThemeTitle = title(themesById.get(historicalTheme.id));
    return {
      entity_title: afterTitle || beforeTitle || currentTitle || "",
      theme_ref: historicalTheme,
      history: {
        entity_title_source: afterTitle
          ? "after_snapshot"
          : beforeTitle
            ? "before_snapshot"
            : currentTitle
              ? "current_fallback"
              : "unknown",
        theme_ref_source: eventTheme
          ? "event"
          : afterTheme
            ? "after_snapshot"
            : beforeTheme
              ? "before_snapshot"
              : "unknown",
        theme_title:
          title(prior?.after) || title(following?.before) || currentHistoricalThemeTitle || null,
        theme_title_source: prior
          ? "theme_event_after"
          : following
            ? "theme_event_before"
            : currentHistoricalThemeTitle
              ? "current_fallback"
              : "unknown",
        current_entity_title: currentTitle || null,
        current_theme_ref: currentTheme,
        current_theme_title: title(themesById.get(currentTheme.id)) || null,
      },
    };
  };
}
