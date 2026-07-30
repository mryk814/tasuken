# 端末間同期

Taskenは各端末のローカルSQLiteを正本として使い続け、OneDriveまたは社内共有フォルダを変更差分の搬送路として利用する。
SQLiteファイルそのものは共有フォルダへ置かない。

## 利用手順

1. データを持つ主端末で、Settingsの「端末間同期」から同期フォルダを選ぶ。
2. OneDriveなどがそのフォルダを別端末へ同期し終えるのを待つ。
3. 空のTaskenを起動した別端末で、同じ同期フォルダを選ぶ。
4. 以後は10秒間隔または「今すぐ同期」で変更を交換する。

既存データがある別Workspaceは自動統合しない。
誤上書きを避けるため、参加側は空のTaskenであることを条件とする。

## データ契約

- 各保存transactionは、Entity本体の保存と同時にOutboxへ同期差分を記録する。
- 差分は`workspaceId`、`deviceId`、端末内連番、`revisionId`、親Revision、Entity本体を持つ。
- 各端末は共有フォルダ内の自分専用ディレクトリだけへ書き込む。
- 受信済み連番は端末ローカルDBに保存し、同じ差分を再適用しない。
- 削除は`deleted_at`を持つTombstoneとして同期する。
- 受信適用と受信位置の更新はSQLite transactionで行う。

## 競合

同じRevisionを起点に複数端末で同じEntityが変更された場合は、自動で後勝ちにしない。
Settingsに「この端末」と「相手端末」を表示し、利用者が残す方を決める。
解決結果は両方のRevisionを親に持つ新しい差分として共有されるため、他端末も同じ状態へ収束する。

## 現在の対象

SQLiteのWorkspace Entity（Theme、Task、Note、Timeline、Knowledge、Chat Ref、Artifactメタデータ等）を同期する。
Noteへ貼り付けたローカル画像とmanaged Artifactの物理ファイルはこの同期に含めない。
それらはOneDrive上の共通保存ルートまたは既存のファイル共有で別途扱う。

## 復旧

- 同期フォルダにアクセスできない間もローカル保存は継続する。
- 未送信差分はOutboxへ残り、アクセス復旧後に再送する。
- 同期停止は差分やローカルデータを削除しない。
- TaskenのSnapshotバックアップは同期とは独立して継続する。
