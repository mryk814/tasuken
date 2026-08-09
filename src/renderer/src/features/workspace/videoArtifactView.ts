import type { MediaAvailability } from "../../../../shared/mediaArtifact.mjs";

const VIDEO_AVAILABILITY_MESSAGES: Record<Exclude<MediaAvailability, "available">, string> = {
  missing: "動画ファイルが見つかりません。linked元またはTasken管理フォルダを確認してください。",
  changed: "動画ファイルの内容が取り込み時から変更されています。元のファイルへ戻すか、取り込み直してください。",
  unsafe_source: "動画の保存場所を安全に確認できません。symlinkや差し替えを避けた通常ファイルを選び直してください。",
  unsupported_codec: "この動画形式は内蔵decoderに対応していません。外部アプリで開いてください。",
};

export function videoAvailabilityMessage(availability: Exclude<MediaAvailability, "available">): string {
  return VIDEO_AVAILABILITY_MESSAGES[availability];
}

export function videoOwnerThemeIsSaved(formThemeId: string | null, savedThemeId: string | null): boolean {
  return (formThemeId || null) === (savedThemeId || null);
}
