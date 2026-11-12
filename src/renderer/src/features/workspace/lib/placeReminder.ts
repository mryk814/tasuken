import type { TaskPlaceReminder } from "../domain-model/types";
import { formText } from "./format";

export const PLACE_RADIUS_DEFAULT = 300;
/** 100m〜2kmのうち、選びやすい値。AIや同期で入った中間の値は、その値を足して表示する。 */
export const PLACE_RADIUS_PRESETS = [100, 200, 300, 500, 1000, 2000];

export function placeRadiusOptions(current: number): number[] {
  return PLACE_RADIUS_PRESETS.includes(current)
    ? PLACE_RADIUS_PRESETS
    : [...PLACE_RADIUS_PRESETS, current].sort((a, b) => a - b);
}

export function formatRadius(meters: number): string {
  return meters >= 1000 ? `${meters / 1000}km` : `${meters}m`;
}

/**
 * 地図アプリからコピーした「34.6937, 135.1956」を読む。区切りはカンマか空白、全体を括弧で
 * 囲んでもよい。緯度・経度の範囲を外れたら読まない。
 */
export function parsePlaceCoordinates(
  text: string,
): { latitude: number; longitude: number } | null {
  const match = text
    .trim()
    .replace(/^[([]\s*|\s*[)\]]$/g, "")
    .match(/^(-?\d+(?:\.\d+)?)\s*[,，、\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!(latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180)) return null;
  return { latitude, longitude };
}

/** 小数6桁（約0.1m）までにして、末尾の0を落とす。 */
function coordinateText(value: number): string {
  return String(Number(value.toFixed(6)));
}

export function formatPlaceCoordinates(place: { latitude: number; longitude: number }): string {
  return `${coordinateText(place.latitude)}, ${coordinateText(place.longitude)}`;
}

/** 設定済みの場所の要約。名前と半径が一目で分かる形。 */
export function placeReminderSummary(place: TaskPlaceReminder | null | undefined): string {
  return place ? `${place.name} · ${formatRadius(place.radius_m)}` : "";
}

export type PlaceReminderFormResult =
  { ok: true; value: TaskPlaceReminder | null } | { ok: false; field: string; message: string };

/** フォームの場所の欄からTaskの値を作る。名前も座標も空なら、場所なし（null）。 */
export function placeReminderFromForm(values: FormData): PlaceReminderFormResult {
  const name = formText(values, "place_name");
  const coordinates = formText(values, "place_coordinates");
  if (!name && !coordinates) return { ok: true, value: null };
  if (!name) return { ok: false, field: "place_name", message: "場所の名前を入力してください。" };
  const parsed = parsePlaceCoordinates(coordinates);
  if (!parsed)
    return {
      ok: false,
      field: "place_coordinates",
      message: "座標は「34.6937, 135.1956」のように、緯度と経度で入力してください。",
    };
  const from = formText(values, "place_time_from");
  const to = formText(values, "place_time_to");
  if (Boolean(from) !== Boolean(to))
    return {
      ok: false,
      field: from ? "place_time_to" : "place_time_from",
      message: "時間帯は開始と終了を両方入力してください。",
    };
  const radius = Number(formText(values, "place_radius_m")) || PLACE_RADIUS_DEFAULT;
  const days = [
    ...new Set(
      values
        .getAll("place_days")
        .map((value) => Number(value))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ].sort((a, b) => a - b);
  return {
    ok: true,
    value: {
      name,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      radius_m: Math.min(2000, Math.max(100, Math.round(radius))),
      days,
      time_from: from || null,
      time_to: to || null,
    },
  };
}
