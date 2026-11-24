/**
 * View（現在形の射影）の決まりと生成（#802・#803 設計 3 節・#811 段 3）。
 *
 * 正本は SQLite と同期差分で、View はいつ全部消しても作り直せる決定的な生成物。
 * ここはファイルに触らない純粋な部分だけを持つ：記録の寄せ集め（snapshot）から
 * 「相対パス → 中身」の対応を作る。書き込みと台帳の管理は main の
 * services/taskenView.mjs が担う。NAS の node でも同じコードが使えるよう、
 * node:fs・node:path には依存しない。
 *
 * 決定性の決まり（設計 3.3）:
 * - ファイルの中に生成時刻を書かない。各ファイルの updated は、含めた記録の
 *   updated_at の最大値にする。
 * - 並び順は固定（期日 → 作成日時 → ID）。日付は端末のタイムゾーンではなく
 *   Workspace の既定（+09:00）で書く。改行は LF、末尾の改行は 1 つ。
 * - 「期限切れ」「今日」「今週」「30 日」の区切りは日付で動く。now.md は
 *   1 日に 1 回は変わりうる（試験では時計を固定する）。
 */

import {
  canonicalMarkdownBindingFromProperties,
  canonicalMarkdownBindingRef,
} from "./canonicalMarkdown.mjs";
import { isPersonalDefaultTheme } from "./personalTheme.mjs";
import { safeFolderSegment } from "./storageResolver.mjs";

export const TASKEN_VIEW_FORMAT = 1;
export const TASKEN_VIEW_LEDGER_FILE = ".tasken-view.json";
export const TASKEN_VIEW_LEDGER_SCHEMA = "tasken-view/v1";
export const TASKEN_VIEW_INBOX_CODE = "inbox";
/** Theme ファイルがこの大きさを超えたら、完了の節から先に archive へ畳む（設計 3.2）。 */
export const TASKEN_VIEW_THEME_FILE_LIMIT_BYTES = 200 * 1024;

const GENERATED_BY = "Tasken（生成物。ここを編集しても Tasken には戻りません）";
const STATE_LABELS = {
  todo: "未着手",
  doing: "進行中",
  waiting: "待ち",
  review: "確認待ち",
  done: "完了",
  cancelled: "中止",
};
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * 時刻の値を瞬間（ms）に直す。時差つき ISO はその瞬間、時差なし
 * （YYYY-MM-DDTHH:mm。reminder_at が画面の現地時刻で書かれる形）は
 * Workspace の既定 +09:00 の壁時計として読む。日付だけなら +09:00 の 0 時。
 */
export function taskenViewInstantOf(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/,
  );
  if (!match) {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = "0"] = match;
  return (
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(fraction.padEnd(3, "0")),
    ) - JST_OFFSET_MS
  );
}

/** +09:00 での日付（YYYY-MM-DD）。 */
export function taskenViewDateOf(ms) {
  const shifted = new Date(ms + JST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** +09:00 での ISO 表記（YYYY-MM-DDTHH:mm:ss+09:00）。front matter の updated に使う。 */
export function taskenViewIsoOf(ms) {
  const shifted = new Date(ms + JST_OFFSET_MS);
  return `${taskenViewDateOf(ms)}T${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}+09:00`;
}

/** +09:00 での「YYYY-MM-DD HH:mm」。 */
export function taskenViewDateTimeOf(ms) {
  const shifted = new Date(ms + JST_OFFSET_MS);
  return `${taskenViewDateOf(ms)} ${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
}

function dateToMs(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** 日付どうしの差（a - b、日）。 */
function dayDiff(a, b) {
  return Math.round((dateToMs(a) - dateToMs(b)) / DAY_MS);
}

function addDays(dateString, days) {
  return taskenViewDateOf(dateToMs(dateString) + days * DAY_MS - JST_OFFSET_MS);
}

/** その日を含む週（月曜始まり）の日曜日。 */
function weekEndSunday(dateString) {
  const dow = new Date(dateToMs(dateString)).getUTCDay(); // 0=日〜6=土
  const untilSunday = (7 - dow) % 7;
  return addDays(dateString, untilSunday);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Task の固定の並び：期日 → 作成日時 → ID（設計 3.3）。 */
function taskSortKey(task) {
  return [task.dueDate || "9999-12-31", task.record.created_at || "", String(task.record.id || "")];
}

function compareKeys(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    const order = compareText(String(a[index]), String(b[index]));
    if (order) return order;
  }
  return 0;
}

function frontMatter({ kind, themeId, themeCode, noteId, documentId, year, updatedMs }) {
  const lines = ["---", `tasken_view: ${TASKEN_VIEW_FORMAT}`, `kind: ${kind}`];
  if (themeId) lines.push(`theme_id: ${themeId}`);
  if (themeCode) {
    lines.push(
      `theme_code: ${/^[A-Za-z0-9._-]+$/.test(themeCode) ? themeCode : JSON.stringify(themeCode)}`,
    );
  }
  if (noteId) lines.push(`note_id: ${noteId}`);
  if (documentId) lines.push(`document_id: ${documentId}`);
  if (year) lines.push(`year: ${year}`);
  if (updatedMs !== null && updatedMs !== undefined) {
    lines.push(`updated: ${taskenViewIsoOf(updatedMs)}`);
  }
  lines.push(`generated_by: ${GENERATED_BY}`, "---");
  return lines.join("\n");
}

/** 末尾の改行を 1 つにそろえる。 */
function finishFile(content) {
  return `${content.replace(/\n+$/, "")}\n`;
}

function maxUpdatedMs(records) {
  let max = null;
  for (const record of records) {
    const ms = taskenViewInstantOf(record?.updated_at);
    if (ms !== null && (max === null || ms > max)) max = ms;
  }
  return max;
}

/**
 * Task と、それに結ぶ Schedule を updated の材料として並べる。
 * Schedule だけの変更でもファイルの中身（期日・予定の行）は書き換わるので、
 * 鮮度の最大値には Schedule の updated_at も含める（設計 3.3。本人の判断 2026-11-23）。
 */
function taskRecordsWithSchedule(tasks) {
  const records = [];
  for (const task of tasks) {
    records.push(task.record);
    if (task.schedule) records.push(task.schedule);
  }
  return records;
}

/** ファイル名に使う題名。区切りや制御文字は _ にし、長さは 80 文字まで。 */
export function taskenViewFileTitle(title) {
  const cleaned = String(title || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "無題";
}

function id8(id) {
  return String(id || "").slice(0, 8);
}

/**
 * Document の自己完結 HTML を文章（Markdown 寄りの平文）にする決定的な変換。
 * script・style は捨て、見出しと箇条書きの形だけ残す。画像は alt の文字にする。
 */
export function taskenViewHtmlToText(html) {
  let source = String(html || "");
  source = source.replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, "");
  source = source.replace(/<img[^>]*\balt="([^"]*)"[^>]*>/gi, "$1");
  source = source.replace(/<img[^>]*>/gi, "");
  source = source.replace(/<br\s*\/?>/gi, "\n");
  source = source.replace(/<li[^>]*>/gi, "\n- ");
  source = source.replace(
    /<h([1-6])[^>]*>/gi,
    (_match, level) => `\n\n${"#".repeat(Number(level))} `,
  );
  source = source.replace(
    /<\/(p|div|section|article|tr|h[1-6]|ul|ol|table|blockquote|li)>/gi,
    "\n",
  );
  source = source.replace(/<[^>]+>/g, "");
  source = source
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/gi, "&");
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
  const compact = [];
  for (const line of lines) {
    if (line === "" && compact[compact.length - 1] === "") continue;
    compact.push(line);
  }
  return compact.join("\n").trim();
}

const README_CONTENT = finishFile(
  [
    frontMatter({ kind: "readme" }),
    "",
    "# Tasken View（生成物）",
    "",
    "このフォルダは、Tasken のデータベースの内容を読みやすい Markdown に写した「現在形の射影」です。",
    "",
    "- 正本は Tasken のデータ（SQLite と同期差分）です。ここを編集しても Tasken には戻りません。",
    "- 全部消しても、書き手に指定された端末が作り直します。",
    "- 鮮度は、index.md の「時点」の行と、各ファイルの front matter にある updated（そのファイルに含めた記録の最新の更新時刻）で確かめてください。",
  ].join("\n"),
);

/** Task に Schedule（owner_type: task）を結ぶ。複数あれば更新が新しい方（同点は ID の大きい方）。 */
function assembleTasks(tasks, schedules) {
  const scheduleByOwner = new Map();
  const ordered = [...schedules]
    .filter((schedule) => schedule && schedule.owner_type === "task" && schedule.owner_id)
    .sort(
      (a, b) =>
        compareText(String(a.updated_at || ""), String(b.updated_at || "")) ||
        compareText(String(a.id || ""), String(b.id || "")),
    );
  for (const schedule of ordered) scheduleByOwner.set(schedule.owner_id, schedule);
  return tasks
    .filter((task) => task && task.id)
    .map((record) => {
      const schedule = scheduleByOwner.get(record.id) || null;
      const startDate = text(schedule?.start_date) || null;
      const endDate = text(schedule?.end_date) || null;
      return {
        record,
        schedule,
        startDate,
        endDate,
        dueDate: endDate || startDate,
        state: text(record.state) || "todo",
      };
    });
}

function themeIdOf(record) {
  return text(record?.project_id) || text(record?.theme_id) || "";
}

/**
 * 射影を作る。snapshot は main の側が repository から集めた記録で、documents には
 * 本文 HTML を html に入れて渡す（読めなければ null）。
 *
 * @param {{ themes?: Array, tasks?: Array, schedules?: Array, notes?: Array, documents?: Array }} snapshot
 * @param {{ now?: Date }} options
 * @returns {Map<string, string>} 相対パス（/ 区切り）→ 中身
 */
export function buildTaskenViewFiles(snapshot = {}, { now = new Date() } = {}) {
  const today = taskenViewDateOf(now.getTime());
  const themes = (Array.isArray(snapshot.themes) ? snapshot.themes : []).filter(
    (theme) => theme && theme.id,
  );
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));
  const tasks = assembleTasks(
    Array.isArray(snapshot.tasks) ? snapshot.tasks : [],
    Array.isArray(snapshot.schedules) ? snapshot.schedules : [],
  );
  const notes = (Array.isArray(snapshot.notes) ? snapshot.notes : []).filter(
    (note) => note && note.id,
  );
  const documents = (Array.isArray(snapshot.documents) ? snapshot.documents : []).filter(
    (document) => document && document.id,
  );
  const taskById = new Map(tasks.map((task) => [task.record.id, task]));

  // 置き場（Theme ごとの束と inbox）。Theme なしと個人業務は inbox に置く（設計 3.2）。
  const buckets = new Map();
  function bucketFor(themeId) {
    const theme = themeId ? themeById.get(themeId) : undefined;
    if (theme && !isPersonalDefaultTheme(theme)) {
      const key = `theme:${theme.id}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          theme,
          segment: safeFolderSegment(theme.code || theme.id, "theme"),
          code: text(theme.code) || text(theme.id),
          title: text(theme.name) || text(theme.code) || String(theme.id),
          tasks: [],
          notes: [],
          documents: [],
        });
      }
      return buckets.get(key);
    }
    const key = "inbox";
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        theme: null,
        segment: TASKEN_VIEW_INBOX_CODE,
        code: TASKEN_VIEW_INBOX_CODE,
        title: "個人業務・Theme なし",
        tasks: [],
        notes: [],
        documents: [],
      });
    }
    return buckets.get(key);
  }
  for (const task of tasks) bucketFor(themeIdOf(task.record)).tasks.push(task);
  for (const note of notes) bucketFor(themeIdOf(note)).notes.push(note);
  for (const document of documents) {
    const ownerTask = document.task_id ? taskById.get(document.task_id) : undefined;
    const themeId = text(document.theme_id) || (ownerTask ? themeIdOf(ownerTask.record) : "");
    bucketFor(themeId).documents.push(document);
  }
  const orderedBuckets = [...buckets.values()].sort((a, b) => {
    if (!a.theme && b.theme) return 1;
    if (a.theme && !b.theme) return -1;
    return (
      compareText(a.segment, b.segment) ||
      compareText(a.title, b.title) ||
      compareText(a.key, b.key)
    );
  });

  const isIncomplete = (task) => task.state !== "done" && task.state !== "cancelled";
  const isOverdue = (task) => isIncomplete(task) && task.dueDate && task.dueDate < today;
  function completionDate(task) {
    const ms =
      taskenViewInstantOf(task.record.completed_at) ?? taskenViewInstantOf(task.record.updated_at);
    return ms === null ? null : taskenViewDateOf(ms);
  }

  // 完了の振り分け：最近 30 日は Theme ファイル、31 日より前は archive（設計 3.2）。
  for (const bucket of orderedBuckets) {
    bucket.incomplete = bucket.tasks
      .filter(isIncomplete)
      .sort((a, b) => compareKeys(taskSortKey(a), taskSortKey(b)));
    bucket.recentCompleted = [];
    bucket.archived = [];
    for (const task of bucket.tasks) {
      if (isIncomplete(task)) continue;
      const date = completionDate(task);
      if (date && dayDiff(today, date) > 30) bucket.archived.push(task);
      else bucket.recentCompleted.push(task);
    }
    bucket.recentCompleted.sort((a, b) => compareKeys(taskSortKey(a), taskSortKey(b)));
    bucket.archived.sort((a, b) => compareKeys(taskSortKey(a), taskSortKey(b)));
    bucket.notes.sort(
      (a, b) =>
        compareText(text(a.title), text(b.title)) || compareText(String(a.id), String(b.id)),
    );
    bucket.documents.sort(
      (a, b) =>
        compareText(text(a.title), text(b.title)) || compareText(String(a.id), String(b.id)),
    );
    bucket.noteFiles = new Map();
    for (const note of bucket.notes) {
      // 記録の置き場は properties_json（本体の保存形）。properties は旧い呼び名の互換。
      const binding = canonicalMarkdownBindingFromProperties(
        note.properties || note.properties_json || {},
        { noteId: note.id },
      );
      // ルート相対の結び付け（#814）も正本 Markdown へのリンクにする（本文は写さない）。
      if (binding && (binding.canonical_path || canonicalMarkdownBindingRef(binding))) {
        bucket.noteFiles.set(note.id, { canonical: binding });
      } else {
        bucket.noteFiles.set(note.id, {
          path: `themes/${bucket.segment}/notes/${taskenViewFileTitle(note.title)}--${id8(note.id)}.md`,
        });
      }
    }
    bucket.documentFiles = new Map();
    for (const document of bucket.documents) {
      bucket.documentFiles.set(
        document.id,
        `themes/${bucket.segment}/documents/${taskenViewFileTitle(document.title)}--${id8(document.id)}.md`,
      );
    }
  }

  function metaLine(task) {
    // 並びは設計 3.3 の例どおり：状態 ／ 期日 ／ 予定 ／ 知らせ。
    const segments = [`状態: ${STATE_LABELS[task.state] || task.state}`];
    const { schedule } = task;
    let due = "";
    if (schedule && task.endDate && schedule.date_kind === "deadline") {
      due = task.endDate;
    } else if (
      schedule &&
      task.endDate &&
      task.startDate !== task.endDate &&
      text(task.record.planned_start_time)
    ) {
      // 予定（作業の窓）が別にあるときは、期間の終わりを期日として言う。
      due = task.endDate;
    }
    if (due) segments.push(`期日: ${due}`);
    const plannedDate = text(task.record.today_date) || task.startDate;
    if (text(task.record.planned_start_time) && plannedDate) {
      const start = text(task.record.planned_start_time);
      const duration = Number(task.record.planned_duration_minutes);
      let planned = `${plannedDate} ${start}`;
      if (Number.isFinite(duration) && duration > 0) {
        const [hour, minute] = start.split(":").map(Number);
        const endTotal = hour * 60 + minute + duration;
        planned += `–${pad2(Math.floor(endTotal / 60) % 24)}:${pad2(endTotal % 60)}`;
      }
      segments.push(`予定: ${planned}`);
    } else if (task.startDate && task.endDate && task.startDate !== task.endDate) {
      segments.push(
        `予定: ${task.startDate}–${task.endDate}${text(schedule?.end_time) ? `（${text(schedule.end_time)} まで）` : ""}`,
      );
    } else if (task.startDate && schedule?.date_kind !== "deadline") {
      segments.push(
        `予定: ${task.startDate}${text(schedule?.end_time) ? `（${text(schedule.end_time)} まで）` : ""}`,
      );
    }
    const reminderMs = taskenViewInstantOf(task.record.reminder_at);
    if (reminderMs !== null) segments.push(`知らせ: ${taskenViewDateTimeOf(reminderMs)}`);
    if (
      schedule &&
      schedule.notify_before_minutes !== null &&
      schedule.notify_before_minutes !== undefined &&
      text(schedule.end_time) &&
      task.endDate
    ) {
      const [hour, minute] = text(schedule.end_time).split(":").map(Number);
      const notifyMs =
        dateToMs(task.endDate) -
        JST_OFFSET_MS +
        (hour * 60 + minute - Number(schedule.notify_before_minutes)) * 60 * 1000;
      segments.push(`知らせ: ${taskenViewDateTimeOf(notifyMs)}`);
    }
    if (task.record.place_reminder && text(task.record.place_reminder.name)) {
      segments.push(`場所の知らせ: ${text(task.record.place_reminder.name)}`);
    }
    return `- ${segments.join(" ／ ")}`;
  }

  function renderTask(task, level, visited) {
    const lines = [`${"#".repeat(level)} ${text(task.record.title) || "（無題）"}`, metaLine(task)];
    lines.push(`- Tasken ID: ${task.record.id}`);
    const description = String(task.record.description || "").replace(/\s+$/, "");
    if (description) lines.push("", description);
    const checklist = [
      ...(Array.isArray(task.record.checklist_items) ? task.record.checklist_items : []),
    ].sort(
      (a, b) =>
        Number(a?.sort_order || 0) - Number(b?.sort_order || 0) ||
        compareText(String(a?.id || ""), String(b?.id || "")),
    );
    if (checklist.length) {
      lines.push("");
      for (const item of checklist)
        lines.push(`- [${item?.done ? "x" : " "}] ${text(item?.title)}`);
    }
    const images = Array.isArray(task.record.images) ? task.record.images : [];
    if (images.length) {
      lines.push(
        `- 添付: ${images
          .map((image) => text(image?.file_name))
          .filter(Boolean)
          .join(", ")}`,
      );
    }
    if (level < 6) {
      for (const child of task.children) {
        if (visited.has(child.record.id)) continue;
        visited.add(child.record.id);
        lines.push("", ...renderTask(child, level + 1, visited));
      }
    }
    return lines;
  }

  // 親子：同じ束の中で、親も未完了のときだけ子の見出しを親の下にぶら下げる。
  for (const bucket of orderedBuckets) {
    const inBucket = new Map(bucket.incomplete.map((task) => [task.record.id, task]));
    for (const task of bucket.incomplete) task.children = [];
    bucket.topLevel = [];
    for (const task of bucket.incomplete) {
      const parent = task.record.parent_task_id
        ? inBucket.get(task.record.parent_task_id)
        : undefined;
      if (parent && parent !== task) parent.children.push(task);
      else bucket.topLevel.push(task);
    }
  }

  function renderCompletedTask(task) {
    const lines = [`### ${text(task.record.title) || "（無題）"}`];
    const segments = [`状態: ${STATE_LABELS[task.state] || task.state}`];
    const date = completionDate(task);
    if (date) segments.push(`${task.state === "cancelled" ? "中止" : "完了"}: ${date}`);
    lines.push(`- ${segments.join(" ／ ")}`);
    lines.push(`- Tasken ID: ${task.record.id}`);
    const description = String(task.record.description || "").replace(/\s+$/, "");
    if (description) lines.push("", description);
    return lines;
  }

  function themeFile(bucket, { foldCompleted }) {
    const included = [
      ...(bucket.theme ? [bucket.theme] : []),
      ...taskRecordsWithSchedule([
        ...bucket.incomplete,
        ...(foldCompleted ? [] : bucket.recentCompleted),
      ]),
      ...bucket.notes,
      ...bucket.documents,
    ];
    const lines = [
      frontMatter({
        kind: "theme",
        themeId: bucket.theme ? bucket.theme.id : undefined,
        themeCode: bucket.segment,
        updatedMs: maxUpdatedMs(included),
      }),
      "",
      `# ${bucket.code} ${bucket.title}`,
    ];
    if (bucket.theme && text(bucket.theme.description))
      lines.push("", text(bucket.theme.description));
    const overdueCount = bucket.incomplete.filter(isOverdue).length;
    lines.push(
      "",
      `未完了 ${bucket.incomplete.length} 件（期限切れ ${overdueCount}）・最近 30 日の完了 ${foldCompleted ? 0 : bucket.recentCompleted.length} 件`,
    );
    const near = bucket.incomplete
      .filter(
        (task) =>
          task.startDate &&
          task.endDate &&
          task.endDate >= today &&
          task.startDate <= addDays(today, 14),
      )
      .sort(
        (a, b) =>
          compareText(a.startDate, b.startDate) || compareKeys(taskSortKey(a), taskSortKey(b)),
      );
    if (near.length) {
      lines.push("", "## 近い予定", "");
      for (const task of near) {
        const range =
          task.schedule?.date_kind === "deadline"
            ? `期日 ${task.endDate}`
            : task.startDate === task.endDate
              ? task.startDate
              : `${task.startDate}–${task.endDate}`;
        lines.push(`- ${range} ${text(task.record.title) || "（無題）"}`);
      }
    }
    lines.push("", "## 未完了", "");
    if (!bucket.topLevel.length) lines.push("（ありません）");
    const visited = new Set();
    bucket.topLevel.forEach((task, index) => {
      if (index) lines.push("");
      visited.add(task.record.id);
      lines.push(...renderTask(task, 3, visited));
    });
    lines.push("", "## 最近 30 日の完了", "");
    if (foldCompleted) {
      lines.push("完了した Task は、ファイルの大きさのため archive に畳んでいます。");
    } else if (!bucket.recentCompleted.length) {
      lines.push("（ありません）");
    } else {
      bucket.recentCompleted.forEach((task, index) => {
        if (index) lines.push("");
        lines.push(...renderCompletedTask(task));
      });
    }
    if (bucket.notes.length) {
      lines.push("", "## ノート", "");
      for (const note of bucket.notes) {
        const entry = bucket.noteFiles.get(note.id);
        if (entry.canonical) {
          const ref = canonicalMarkdownBindingRef(entry.canonical);
          const fileName =
            text(entry.canonical.file_name) ||
            text(ref ? ref.relative_path : entry.canonical.canonical_path)
              .split(/[\\/]/)
              .pop() ||
            "";
          // ルート相対の結び付けは、View から見た相対リンクをそのまま使う（置き場所が
          // テーマの Notes とは限らないため）。絶対パスの結び付けは従来どおり。
          const refFolder = ref ? ref.relative_path.split("/").slice(0, -1).join("/") : "";
          const folder = ref
            ? refFolder
              ? `../../${refFolder}`
              : "../.."
            : bucket.theme
              ? `../../Themes/${bucket.segment}/Notes`
              : "../../Inbox/Notes";
          lines.push(
            `- [${text(note.title) || "（無題）"}](${folder}/${fileName})（正本 Markdown）`,
          );
        } else {
          lines.push(`- [${text(note.title) || "（無題）"}](notes/${entry.path.split("/").pop()})`);
        }
      }
    }
    if (bucket.documents.length) {
      lines.push("", "## 文書", "");
      for (const document of bucket.documents) {
        lines.push(
          `- [${text(document.title) || "（無題）"}](documents/${bucket.documentFiles.get(document.id).split("/").pop()})`,
        );
      }
    }
    return finishFile(lines.join("\n"));
  }

  const files = new Map();
  files.set("README.md", README_CONTENT);

  // Theme ファイル。200 KB を超えたら完了を archive へ畳んで作り直す（設計 3.2）。
  const folded = new Set();
  const themeContents = new Map();
  for (const bucket of orderedBuckets) {
    let content = themeFile(bucket, { foldCompleted: false });
    if (new TextEncoder().encode(content).length > TASKEN_VIEW_THEME_FILE_LIMIT_BYTES) {
      folded.add(bucket.key);
      bucket.archived = [...bucket.archived, ...bucket.recentCompleted].sort((a, b) =>
        compareKeys(taskSortKey(a), taskSortKey(b)),
      );
      bucket.recentCompleted = [];
      content = themeFile(bucket, { foldCompleted: true });
    }
    themeContents.set(bucket.key, content);
  }

  // archive：年ごと。
  const archiveFiles = [];
  for (const bucket of orderedBuckets) {
    const byYear = new Map();
    for (const task of bucket.archived) {
      const date = completionDate(task);
      if (!date) continue;
      const year = date.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(task);
    }
    for (const year of [...byYear.keys()].sort()) {
      const members = byYear.get(year);
      const lines = [
        frontMatter({
          kind: "archive",
          themeId: bucket.theme ? bucket.theme.id : undefined,
          themeCode: bucket.segment,
          year,
          updatedMs: maxUpdatedMs(taskRecordsWithSchedule(members)),
        }),
        "",
        `# ${bucket.code} ${bucket.title} の完了（${year}）`,
        "",
      ];
      members.forEach((task, index) => {
        if (index) lines.push("");
        lines.push(...renderCompletedTask(task));
      });
      const path = `archive/${bucket.segment}/${year}.md`;
      archiveFiles.push({ path, bucket, year, count: members.length });
      files.set(path, finishFile(lines.join("\n")));
    }
  }

  for (const bucket of orderedBuckets) {
    files.set(`themes/${bucket.segment}.md`, themeContents.get(bucket.key));
    for (const note of bucket.notes) {
      const entry = bucket.noteFiles.get(note.id);
      if (!entry.path) continue;
      const lines = [
        frontMatter({
          kind: "note",
          themeId: bucket.theme ? bucket.theme.id : undefined,
          themeCode: bucket.segment,
          noteId: note.id,
          updatedMs: maxUpdatedMs([note]),
        }),
        "",
        `# ${text(note.title) || "（無題）"}`,
        "",
        String(note.body_markdown || "").replace(/\s+$/, ""),
      ];
      files.set(entry.path, finishFile(lines.join("\n")));
    }
    for (const document of bucket.documents) {
      const body =
        document.html === null || document.html === undefined
          ? "（本文ファイルを読めませんでした）"
          : taskenViewHtmlToText(document.html);
      const lines = [
        frontMatter({
          kind: "document",
          themeId: bucket.theme ? bucket.theme.id : undefined,
          themeCode: bucket.segment,
          documentId: document.id,
          updatedMs: maxUpdatedMs([document]),
        }),
        "",
        `# ${text(document.title) || "（無題）"}`,
        "",
        body,
      ];
      files.set(bucket.documentFiles.get(document.id), finishFile(lines.join("\n")));
    }
  }

  // now.md：Theme をまたいだ「今」。
  const allIncomplete = orderedBuckets.flatMap((bucket) =>
    bucket.incomplete.map((task) => ({ bucket, task })),
  );
  const nowSections = [];
  const entryLine = ({ bucket, task }, suffix = "") =>
    `- [${bucket.code}] [${text(task.record.title) || "（無題）"}](themes/${bucket.segment}.md)${suffix}`;
  const overdue = allIncomplete.filter(({ task }) => isOverdue(task));
  if (overdue.length) {
    nowSections.push([
      "期限切れ",
      overdue.map((entry) => entryLine(entry, `（期日: ${entry.task.dueDate}）`)),
    ]);
  }
  const inRange = (task, from, to) =>
    (task.startDate && task.endDate && task.startDate <= to && task.endDate >= from) ||
    (task.dueDate && task.dueDate >= from && task.dueDate <= to);
  const todayEntries = allIncomplete.filter(({ task }) => inRange(task, today, today));
  if (todayEntries.length)
    nowSections.push(["今日", todayEntries.map((entry) => entryLine(entry))]);
  const weekEnd = weekEndSunday(today);
  const weekEntries = allIncomplete.filter(({ task }) => inRange(task, today, weekEnd));
  if (weekEntries.length) nowSections.push(["今週", weekEntries.map((entry) => entryLine(entry))]);
  const reminded = allIncomplete
    .filter(({ task }) => taskenViewInstantOf(task.record.reminder_at) !== null)
    .sort(
      (a, b) =>
        taskenViewInstantOf(a.task.record.reminder_at) -
          taskenViewInstantOf(b.task.record.reminder_at) ||
        compareText(String(a.task.record.id), String(b.task.record.id)),
    );
  if (reminded.length) {
    nowSections.push([
      "知らせ",
      reminded.map((entry) =>
        entryLine(
          entry,
          `（知らせ: ${taskenViewDateTimeOf(taskenViewInstantOf(entry.task.record.reminder_at))}）`,
        ),
      ),
    ]);
  }
  const doing = allIncomplete.filter(({ task }) => task.state === "doing");
  if (doing.length) nowSections.push(["進行中", doing.map((entry) => entryLine(entry))]);
  const nowShown = new Map();
  for (const entries of [overdue, todayEntries, weekEntries, reminded, doing]) {
    for (const entry of entries) nowShown.set(entry.task.record.id, entry.task);
  }
  const nowLines = [
    frontMatter({
      kind: "now",
      updatedMs: maxUpdatedMs(taskRecordsWithSchedule([...nowShown.values()])),
    }),
    "",
    "# 今",
  ];
  if (!nowSections.length) nowLines.push("", "現在、出すべきものはありません。");
  for (const [title, entries] of nowSections) nowLines.push("", `## ${title}`, "", ...entries);
  files.set("now.md", finishFile(nowLines.join("\n")));

  // index.md：目次と鮮度。鮮度の時刻は、中身が変わったときだけ進むよう、
  // 全記録（Task に結ぶ Schedule を含む）の updated_at の最大値から作る（設計 3.3）。
  const allRecords = [...themes, ...taskRecordsWithSchedule(tasks), ...notes, ...documents];
  const overallMax = maxUpdatedMs(allRecords);
  const indexLines = [
    frontMatter({ kind: "index", updatedMs: overallMax }),
    "",
    "# Tasken の現在形",
    "",
    overallMax !== null
      ? `${taskenViewDateTimeOf(overallMax)} 時点の Tasken の内容`
      : "まだ記録がありません",
    "",
    "[今の状況](now.md)",
    "",
    "## Theme",
    "",
  ];
  if (!orderedBuckets.length) indexLines.push("（ありません）");
  for (const bucket of orderedBuckets) {
    const overdueCount = bucket.incomplete.filter(isOverdue).length;
    indexLines.push(
      `- [${bucket.code} ${bucket.title}](themes/${bucket.segment}.md) — 未完了 ${bucket.incomplete.length} 件（期限切れ ${overdueCount}）`,
    );
  }
  if (archiveFiles.length) {
    indexLines.push("", "## 完了の保管", "");
    for (const archive of archiveFiles) {
      indexLines.push(
        `- [${archive.bucket.code} ${archive.year}](archive/${archive.bucket.segment}/${archive.year}.md) — ${archive.count} 件`,
      );
    }
  }
  files.set("index.md", finishFile(indexLines.join("\n")));

  // 並びを固定する：README → index → now → themes → archive の順で返す。
  const ordered = new Map();
  ordered.set("README.md", files.get("README.md"));
  ordered.set("index.md", files.get("index.md"));
  ordered.set("now.md", files.get("now.md"));
  for (const [path, content] of files) {
    if (path.startsWith("themes/")) ordered.set(path, content);
  }
  for (const [path, content] of files) {
    if (path.startsWith("archive/")) ordered.set(path, content);
  }
  return ordered;
}
