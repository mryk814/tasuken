package jp.personal.tasken.companion

import android.content.Context

/**
 * 要対応の新着通知の設定と、通知済みの判断の記録（#601）。
 *
 * 計画の規則:
 * - 通知は**質問・判断依頼・成果確認の新規発生だけ**を候補にする。
 * - **既定はアプリ内表示**。OS通知は利用者が明示的に有効化したときだけ出す。
 * - **同じ判断の再送で再通知しない**（判断IDごとに一度だけ記録する）。
 *
 * 記録は「いま一覧にある判断」で置き換えるので、一度消えた判断が再び現れたときは
 * 新規発生として扱う（Desktopが未解決へ戻した場合）。
 */
class AttentionNotificationStore(context: Context) {    private val preferences = context.applicationContext
        .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    /** 既定はfalse（アプリ内表示だけ）。 */
    fun isEnabled(): Boolean = preferences.getBoolean(KEY_ENABLED, false)

    fun setEnabled(enabled: Boolean): Boolean =
        preferences.edit().putBoolean(KEY_ENABLED, enabled).commit()

    fun knownIds(serverId: String): Set<String> =
        preferences.getStringSet(knownKey(serverId), emptySet()).orEmpty()

    /**
     * いま一覧にある判断を記録する。前回の記録は置き換えるため、
     * 対象から外れた判断の記録は残らない。
     */
    fun replaceKnownIds(serverId: String, ids: Collection<String>): Boolean =
        preferences.edit().putStringSet(knownKey(serverId), ids.toSet()).commit()

    fun clear(serverId: String): Boolean =
        preferences.edit().remove(knownKey(serverId)).commit()

    private fun knownKey(serverId: String): String = "$KEY_KNOWN_PREFIX$serverId"

    companion object {
        private const val PREFERENCES_NAME = "tasken_attention_notifications"
        private const val KEY_ENABLED = "new_attention_notifications_enabled"
        private const val KEY_KNOWN_PREFIX = "known_attention_ids:"

        /**
         * 通知の候補になる判断か。変更案（`proposal_pending`）と不明な種別は候補にしない。
         * 質問・判断依頼・成果確認だけが「利用者の対応が必要なイベント」である。
         */
        fun isNotificationCandidate(kind: AttentionKind): Boolean = when (kind) {
            AttentionKind.AnswerRequest, AttentionKind.DecisionRequest, AttentionKind.ReviewReport -> true
            AttentionKind.ProposalPending, AttentionKind.Unknown -> false
        }

        /**
         * 新しく現れた判断。並びはDesktopが返した順のままにする。
         * 一度記録した判断は、同じIDが再送されても新規として返さない。
         */
        fun newArrivals(rows: List<AttentionRow>, knownIds: Set<String>): List<AttentionRow> =
            rows.filter { isNotificationCandidate(it.kind) && it.attentionId !in knownIds }
    }
}
