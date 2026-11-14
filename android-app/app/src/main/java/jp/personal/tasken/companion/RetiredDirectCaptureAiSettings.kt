package jp.personal.tasken.companion

import android.content.Context
import android.util.Log
import java.security.KeyStore

/**
 * 端末から直接 AI へ送る設定の片付け。
 *
 * 入力の AI 整理と、その「PCなし整理」の設定はスマホから外した（#755 束9a）。前の版は設定を
 * SharedPreferences「tasken_direct_capture_ai」に置き、API キーを Android Keystore の
 * 「tasken_direct_capture_ai_key」で暗号化して入れていた。読む所が無くなった鍵を端末に残さないよう、
 * 起動のたびにこの 2 つだけを名前で指して消す（無ければ何もしない）。ペアリングの資格など、
 * ほかの SharedPreferences と Keystore の項目には触らない。
 *
 * 失敗しても起動は止めない。次の起動でまた消しにいく。ログには例外の種類だけを出し、
 * 設定や鍵の中身、例外のメッセージは出さない。
 */
internal object RetiredDirectCaptureAiSettings {
    /** 前の版と同じ文字にする（違うと消せない）。 */
    internal const val PreferencesName = "tasken_direct_capture_ai"
    internal const val KeystoreAlias = "tasken_direct_capture_ai_key"

    private const val LogTag = "TaskenRetiredSettings"

    fun retire(context: Context) {
        try {
            // deleteSharedPreferences はファイルと退避ファイルを消し、プロセス内のキャッシュも外す。
            // 無いときも true を返す。消し切れないときは、せめて中身を空にする。
            if (!context.deleteSharedPreferences(PreferencesName)) {
                context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE).edit().clear().commit()
            }
        } catch (error: Exception) {
            Log.w(LogTag, "Retired direct AI preferences were not removed: ${error.javaClass.simpleName}")
        }
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (keyStore.containsAlias(KeystoreAlias)) keyStore.deleteEntry(KeystoreAlias)
        } catch (error: Exception) {
            Log.w(LogTag, "Retired direct AI key was not removed: ${error.javaClass.simpleName}")
        }
    }
}
