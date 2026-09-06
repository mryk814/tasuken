# Androidの日付別振り返りの読取契約

Issue #549。Androidの今日・直近7日の表示は、Desktopと同じ `profile: "recall"` の日付別索引を読む。
入力元の正本や日報形式を増やさない。

## Gateway

`GET /v1/activity` は `mobile:read` を持つ認証済み端末だけが利用できる。
`mobile.activity.read` をhealthのcapabilitiesで広告する。
新しいscopeは追加せず、端末許可を変更しない。
API version 1、schema version 7の追加エンドポイントである。

| Query                                        | 契約                                                              |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `apiVersion` / `schemaVersion` / `requestId` | 既存Mobile envelopeの識別子                                       |
| `date`                                       | 実在する `YYYY-MM-DD`、必須                                       |
| `timezone`                                   | 有効なIANA timezone、必須。不正値を既定timezoneへ黙って変換しない |
| `limit`                                      | 1〜500、省略時100                                                 |
| `cursor`                                     | 共通Activity queryが発行するopaque cursor、最大200文字            |

本人閲覧では `audience: null` を固定する。
AI非公開のTask・Note・Captureや当時／現在の所属Themeも本人が見られる。
AIの公開範囲は端末の認証・認可の代わりに使わない。
`audience` や `profile` など余分なqueryは拒否する。
現在削除済み・存在しない原記録を除くという共通recallの契約と、安全な文字列・参照への変換は維持する。

`data.events` は共通Activity entry、`data.page` は共通ページ情報をそのまま利用する。
日付内は共通queryの降順で返す。
WorkLogは `recall.date_basis: "performed_day"` と実施日を保持し、`local_time` は空文字にする。
入力日時は `occurred_at` と `metadata.work_log.entered_at` に残す。
`event_kind` と `recall.stage` を保持し、Task完了・自己申告WorkLog・Capture・AI報告・人の採用を区別する。

## 原記録への遷移

各entryに `mobile_source: { type, id, status, reason }` を追加する。
共通の `entity_ref` と `recall.source_ref` は書き換えない。

| 原記録                      | `type`          | `status` / `reason`                |
| --------------------------- | --------------- | ---------------------------------- |
| Task                        | `task`          | `available` / `null`               |
| Capture                     | `capture_entry` | `available` / `null`               |
| WorkLog Note                | `work_log`      | `available` / `null`               |
| Androidで詳細を扱わない種類 | 元のentity type | `unavailable` / `unsupported_type` |
| 対象の原記録が取得できない  | 元のtype        | `unavailable` / `not_found`        |

`available` はDesktopに原記録が存在し、既存Androidの詳細種類に対応する意味である。
端末内のcache取得完了や、本文がレスポンスに含まれることは保証しない。
Task・Captureの端末cache未取得、古いGatewayのWorkLog詳細capability不足はAndroidが別途理由を表示する。
通常Noteの本文エディターや新しいCapture詳細GETは追加しない。

WorkLogの `mobile_source.id` は正本Note IDで、#540の入力draft ID／command IDと一致する。
Captureは正本Capture IDを使う。
Androidのpendingとの照合には `type + id` を使い、合成されることがあるActivityの `event.id` を使わない。

## 取得状態

- `page.status: "ok"` と `next_cursor: null` でその日の取得完了。
- `data.truncated: true` と `page.next_cursor` がある間は一部取得。`meta.truncated` も同じ値。
- `invalid_cursor` はquery不一致・不正cursor、`resync_required` は取得途中の正本変更。件数はnullで、取得完了した空一覧ではない。
- 接続失敗、未取得日、旧Gatewayの `not_found` / `capability_unavailable` も0件扱いにしない。

Roomは取得済み表示と最終取得時刻を保持し、再取得の失敗で消さない。
継続中に再取得が必要になった場合は、以前の表示を残して先頭から取り直す。
Androidの今日／直近7日という表示範囲を、Gatewayで端末時刻に依存した固定窓へ変換しない。

実JSONの例は [activity-response.golden.json](../contracts/mobile/v1/activity-response.golden.json)。
`single` / `empty` / `partial` / `unavailable` を両側の契約確認に使う。
Gateway検証は `rtk node scripts/run-electron-node.mjs --test tests/mobile-activity-gateway.test.mjs`。
