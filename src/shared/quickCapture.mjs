const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif"]);

function trimUrlPunctuation(value) {
  return value.replace(/[),.;!?。、）】]+$/u, "");
}

export function firstCaptureUrl(text) {
  const matched = String(text || "").match(HTTP_URL_PATTERN);
  return matched ? trimUrlPunctuation(matched[0]) : "";
}

export function quickCaptureContentType(text) {
  const value = String(text || "").trim();
  if (!value) return "text";
  const url = firstCaptureUrl(value);
  if (url && value === url) return "url";
  if (/^(#{1,6}\s|[-*+]\s|>\s|```)/m.test(value)) return "markdown";
  return "text";
}

export function quickCaptureTitle(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (quickCaptureContentType(value) === "url") {
    try {
      return new URL(value).hostname.replace(/^www\./i, "") || value;
    } catch {
      return value;
    }
  }
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^(#{1,6}\s+|[-*+]\s+|>\s+)/, "") || value;
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

export function fileCaptureContentType(files) {
  const names = (files || []).map((file) => String(file?.name || file?.path || ""));
  if (!names.length) return "file";
  const everyImage = names.every((name) => {
    const extension = name.split(".").pop()?.toLowerCase() || "";
    return IMAGE_EXTENSIONS.has(extension);
  });
  return everyImage ? "image" : "file";
}

export function captureMatchesQuery(entry, query) {
  const needle = String(query || "").trim().toLocaleLowerCase("ja-JP");
  if (!needle) return true;
  return [
    entry?.title,
    entry?.text,
    entry?.url,
    entry?.content_type,
    entry?.kind,
  ].some((value) => String(value || "").toLocaleLowerCase("ja-JP").includes(needle));
}

// --- Quick Captureの一行入力（#308） ---------------------------------------
// 「本体｜補足」の形で一行に二つの値を書けるようにする。補足の意味はmodeが決める。
// 全角`｜`を第一候補にし、日本語入力から切り替えずに打てる半角`|`も同じ区切りとして扱う。

const QUICK_CAPTURE_SEPARATOR_PATTERN = /[｜|]/;

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function splitQuickCaptureInput(text) {
  const value = String(text ?? "");
  const matched = value.match(QUICK_CAPTURE_SEPARATOR_PATTERN);
  if (!matched) return { main: value.trim(), extra: "" };
  const index = matched.index;
  return {
    main: value.slice(0, index).trim(),
    // 補足側にさらに区切りが現れても分割しない。ひとことの中の`|`をそのまま残す。
    extra: value.slice(index + 1).trim(),
  };
}

function toHalfWidth(value) {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function dateParts(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return { year, month, day };
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeDate(year, month, day) {
  return new Date(year, month - 1, day);
}

function isRealDate(year, month, day) {
  const date = makeDate(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function addDays(iso, amount) {
  const { year, month, day } = dateParts(iso);
  return toIsoDate(makeDate(year, month, day + amount));
}

function weekdayOf(iso) {
  const { year, month, day } = dateParts(iso);
  return makeDate(year, month, day).getDay();
}

export function quickCaptureDueLabel(due) {
  if (!due?.date) return "";
  const weekday = WEEKDAY_LABELS[weekdayOf(due.date)];
  const base = `${due.date}（${weekday}）`;
  return due.time ? `${base} ${due.time}` : base;
}

function parseTimeExpression(text) {
  const trimmed = text.trim();
  if (!trimmed) return { rest: "", time: "" };
  const patterns = [
    /(午前|午後)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/,
    /(午前|午後)?\s*(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分?|半)?/,
  ];
  for (const pattern of patterns) {
    const matched = trimmed.match(pattern);
    if (!matched) continue;
    let hour = Number(matched[2]);
    const half = /半/.test(matched[0]) && matched[3] === undefined;
    const minute = half ? 30 : Number(matched[3] || 0);
    if (matched[1] === "午後" && hour < 12) hour += 12;
    if (matched[1] === "午前" && hour === 12) hour = 0;
    if (!Number.isFinite(hour) || hour > 23 || !Number.isFinite(minute) || minute > 59) continue;
    return {
      rest: (trimmed.slice(0, matched.index) + trimmed.slice(matched.index + matched[0].length)).trim(),
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    };
  }
  return { rest: trimmed, time: "" };
}

function parseDateExpression(text, today) {
  const value = text.trim();
  if (!value) return "";

  const iso = value.match(/^(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?$/);
  if (iso) {
    const [, year, month, day] = iso.map(Number);
    return isRealDate(year, month, day) ? toIsoDate(makeDate(year, month, day)) : "";
  }

  const monthDay = value.match(/^(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?$/);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    const { year } = dateParts(today);
    // 過ぎた月日は翌年として読む（「1/5」を10か月前として保存しない）。
    for (const candidate of [year, year + 1]) {
      if (!isRealDate(candidate, month, day)) continue;
      const result = toIsoDate(makeDate(candidate, month, day));
      if (result >= today) return result;
    }
    return "";
  }

  const dayOnly = value.match(/^(\d{1,2})\s*日$/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    const { year, month } = dateParts(today);
    for (const offset of [0, 1]) {
      const target = makeDate(year, month + offset, 1);
      if (!isRealDate(target.getFullYear(), target.getMonth() + 1, day)) continue;
      const result = toIsoDate(makeDate(target.getFullYear(), target.getMonth() + 1, day));
      if (result >= today) return result;
    }
    return "";
  }

  if (/^(今日|本日|きょう)$/.test(value)) return today;
  if (/^(明日|あした|あす)$/.test(value)) return addDays(today, 1);
  if (/^(明後日|あさって)$/.test(value)) return addDays(today, 2);

  const relativeDays = value.match(/^(\d{1,3})\s*日後$/);
  if (relativeDays) return addDays(today, Number(relativeDays[1]));

  const relativeWeeks = value.match(/^(\d{1,2})\s*週間?後$/);
  if (relativeWeeks) return addDays(today, Number(relativeWeeks[1]) * 7);

  if (/^(今週末|週末)$/.test(value)) {
    const delta = (6 - weekdayOf(today) + 7) % 7;
    return addDays(today, delta === 0 ? 7 : delta);
  }
  if (/^来週$/.test(value)) return addDays(today, 7);
  if (/^今月末$/.test(value)) {
    const { year, month } = dateParts(today);
    return toIsoDate(makeDate(year, month + 1, 0));
  }

  const weekday = value.match(/^(今週|来週)?\s*([日月火水木金土])曜日?$/);
  if (weekday) {
    const target = WEEKDAY_LABELS.indexOf(weekday[2]);
    // 「今日」は含めない。今日を指したいときは「今日」と書く。
    const delta = ((target - weekdayOf(today) + 7) % 7) || 7;
    return addDays(today, delta + (weekday[1] === "来週" ? 7 : 0));
  }

  return "";
}

/**
 * 「金曜まで」「8月15日」「明日17時」等の期限表現を日付へ解釈する。
 * 解釈できないときは ok:false を返し、期限なしで黙って保存させない。
 */
export function parseQuickCaptureDue(expression, today) {
  const raw = toHalfWidth(String(expression ?? "").trim())
    .replace(/[\s　]+/g, " ")
    .replace(/(まで(に)?|迄)$/u, "")
    .trim();
  if (!raw) {
    return { ok: false, message: "期限が空です。「明日」「金曜まで」「8/15」のように書いてください。" };
  }
  const { rest, time } = parseTimeExpression(raw);
  const datePart = rest || (time ? "今日" : "");
  const date = parseDateExpression(datePart, today);
  if (!date) {
    return { ok: false, message: `期限として読み取れませんでした: ${expression}。「明日」「金曜まで」「8/15」「2026-08-15」のように書いてください。` };
  }
  return { ok: true, date, time };
}
