# 期間記録の続き取得（#543）

`queryActivityEvents()`の公開結果をJSON・MCP・Markdownで共用する。
一回の返却上限は500件、既存Core/MCP入口の上限は100件を維持する。
`cursor`を省略した既存の呼出しは先頭ページを返し、既存の`events`・`truncated`・除外集計に`page`を追加する。

## 期間と順序

`date`は指定timezoneの暦日である。
`from`・`to`の`YYYY-MM-DD`指定もそのtimezoneの暦日として比較し、両端の日を含む。
offset付きtimestampなら同じ瞬間へ変換して比較し、両端のtimestampを含む。
たとえば`from = to = 2026-09-06`は一日全体、`from = to = 2026-09-06T23:55:00+09:00`はその瞬間だけを指定する。
日付とtimestampを文字列の大小で混同しない。

順序は発生時刻の瞬間、次にstable event IDで確定する。
降順でも同じ二つの基準を反転する。
同一timestampに複数eventがあっても、次ページへ進む際に飛ばさない。

## ページの契約

`page`は以下を保持する。

| フィールド                 | 意味                                                  |
| -------------------------- | ----------------------------------------------------- |
| `status`                   | `ok`、`invalid_cursor`、`resync_required`             |
| `period`                   | 指定したdate/from/to、実際のtimezone、両端を含むこと  |
| `limit` / `returned_count` | 一回の上限と今回返した件数                            |
| `offset`                   | 公開結果内の開始位置。取得失敗時はnull                |
| `matched_visible_count`    | 今回のqueryに合致する公開可能な件数。取得失敗時はnull |
| `next_cursor`              | 続きがある場合のcursor。なければnull                  |
| `revision`                 | 公開結果と除外集計のrevision                          |
| `generated_at`             | この応答を生成した日時                                |

`truncated`は今回より後に公開可能な行が残ることを表す。
後続ページ単体は、それより前の行を収録していない。
Markdownにも開始位置・収録期間・返却件数・続き・statusを出し、単一ページを全件収録と誤認させない。
除外説明は既存の種類・理由・件数だけを使い、非公開のEntity名・ID・URLを加えない。

## 続き取得中の変更

最初の応答の`next_cursor`を、同じ検索条件・上限で次の呼出しへ渡す。
timezone・対象期間・種別・profile・audience・並び順などが違うcursorは`invalid_cursor`となり、行を返さない。
cursorは公開API内部の形式であり、クライアントで組み立てない。

毎回現在の公開範囲を適用したうえで、公開結果と除外集計のrevisionを比較する。
追加・編集・削除・権限変更によって結果が変わった場合は`resync_required`と空の行を返す。
クライアントは取得済みページを捨て、cursorなしで先頭から取得し直す。
Task IDを指定した既存入口では、対象Taskの削除・非公開化は従来どおり`not_found`となり、続きの行を返さない。
古い公開結果をキャッシュして配り続けたり、新しい結果を古いページへ無言で継ぎ足したりしない。
公開結果にも除外集計にも影響しない変更は、revisionを変える必要がない。

cursorには検索条件とrevisionのdigest・開始位置だけを持たせ、本文やEntity IDを格納しない。
cursorは権限を与えるものではなく、公開判定を省略する手段にもならない。
DBへのevent追加やbackfillは行わない。

## 検証

`tests/activity-pagination.test.mjs`で0／499／500／501／5,000件、同一時刻、降順、小さい上限、全ページのID一致を確認する。
期間のtimezone・offset比較、変更時の再取得、不正cursor・別条件への流用、JSON/MCP/Markdownの収録情報と非公開参照の非露出を検証する。
既存Core/MCPの回帰でも同じquery結果とmetadataを通す。
