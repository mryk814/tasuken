package jp.personal.tasken.companion

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

data class ShortSpeechRecognitionResult(
    val text: String,
    val mode: MobileSpeechRecognitionMode,
    val language: String,
    val confidence: Float?,
)

sealed interface ShortSpeechUiState {
    data class Idle(val availableMode: MobileSpeechRecognitionMode?) : ShortSpeechUiState
    data class Listening(val mode: MobileSpeechRecognitionMode) : ShortSpeechUiState
    data class Partial(val mode: MobileSpeechRecognitionMode, val text: String) : ShortSpeechUiState
    data class Processing(val mode: MobileSpeechRecognitionMode) : ShortSpeechUiState
    data class Result(val result: ShortSpeechRecognitionResult) : ShortSpeechUiState
    data class Error(val message: String) : ShortSpeechUiState
}

internal fun speechModeLabel(mode: MobileSpeechRecognitionMode): String = when (mode) {
    MobileSpeechRecognitionMode.OnDevice -> "端末内認識"
    MobileSpeechRecognitionMode.SystemService -> "システム音声サービス"
    MobileSpeechRecognitionMode.Unknown -> "音声認識"
}

internal fun speechPrivacyDescription(mode: MobileSpeechRecognitionMode?): String = when (mode) {
    MobileSpeechRecognitionMode.OnDevice -> "端末内で認識します。音声そのものはTaskenへ保存しません。"
    MobileSpeechRecognitionMode.SystemService -> "システム音声サービスを使います。音声がクラウドへ送信される可能性があります。"
    MobileSpeechRecognitionMode.Unknown -> "利用する音声サービスを確認できません。音声がクラウドへ送信される可能性があります。"
    null -> "この端末では音声認識を利用できません。手入力はそのまま使えます。"
}

internal fun speechErrorMessage(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO -> "マイク入力を読み取れませんでした。手入力または再試行を使ってください。"
    SpeechRecognizer.ERROR_CLIENT -> "音声入力を開始できませんでした。もう一度お試しください。"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "マイク権限がありません。手入力はそのまま使えます。"
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
        "音声サービスへ接続できませんでした。手入力または端末内認識をお試しください。"
    SpeechRecognizer.ERROR_NO_MATCH -> "音声を文字にできませんでした。内容を手入力するか、もう一度お話しください。"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "音声サービスが使用中です。少し待ってから再試行してください。"
    SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED ->
        "音声サービスを利用できません。手入力はそのまま使えます。"
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "音声が聞き取れませんでした。もう一度お話しください。"
    SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "音声入力の回数が多すぎます。少し待ってから再試行してください。"
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
        "現在の言語を音声認識で利用できません。手入力をお使いください。"
    else -> "音声入力を完了できませんでした。手入力はそのまま使えます。"
}

class AndroidShortSpeechRecognizer(private val context: Context) {
    private var recognizer: SpeechRecognizer? = null
    private var cancelled = false

    fun availableMode(): MobileSpeechRecognitionMode? = preferredRecognizerMode(context)

    fun start(
        language: String = Locale.getDefault().toLanguageTag(),
        onState: (ShortSpeechUiState) -> Unit,
    ) {
        cancel()
        cancelled = false
        val session = createRecognizer(context)
        if (session == null) {
            onState(ShortSpeechUiState.Error("この端末では音声認識を利用できません。手入力をお使いください。"))
            return
        }
        val (nextRecognizer, mode) = session
        recognizer = nextRecognizer
        nextRecognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                onState(ShortSpeechUiState.Listening(mode))
            }

            override fun onBeginningOfSpeech() {
                onState(ShortSpeechUiState.Listening(mode))
            }

            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit

            override fun onEndOfSpeech() {
                onState(ShortSpeechUiState.Processing(mode))
            }

            override fun onError(error: Int) {
                val wasCancelled = cancelled
                release()
                if (!wasCancelled) onState(ShortSpeechUiState.Error(speechErrorMessage(error)))
            }

            override fun onResults(results: Bundle?) {
                val candidates = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                val text = candidates.firstOrNull()?.trim().orEmpty()
                val confidence = results
                    ?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
                    ?.firstOrNull()
                    ?.takeIf { it >= 0f }
                release()
                if (text.isBlank()) {
                    onState(ShortSpeechUiState.Error(speechErrorMessage(SpeechRecognizer.ERROR_NO_MATCH)))
                } else {
                    onState(
                        ShortSpeechUiState.Result(
                            ShortSpeechRecognitionResult(text, mode, language, confidence),
                        ),
                    )
                }
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val partial = partialResults
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    ?.trim()
                    .orEmpty()
                if (partial.isNotEmpty()) onState(ShortSpeechUiState.Partial(mode, partial))
            }

            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        onState(ShortSpeechUiState.Listening(mode))
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        runCatching { nextRecognizer.startListening(intent) }
            .onFailure {
                release()
                onState(ShortSpeechUiState.Error("音声入力を開始できませんでした。もう一度お試しください。"))
            }
    }

    fun stop() {
        recognizer?.stopListening()
    }

    fun cancel() {
        cancelled = true
        recognizer?.cancel()
        release()
    }

    fun destroy() {
        cancel()
    }

    private fun release() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun createRecognizer(context: Context): Pair<SpeechRecognizer, MobileSpeechRecognitionMode>? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
            runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(context) }
                .getOrNull()
                ?.let { return it to MobileSpeechRecognitionMode.OnDevice }
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return null
        return runCatching { SpeechRecognizer.createSpeechRecognizer(context) }
            .getOrNull()
            ?.let { it to MobileSpeechRecognitionMode.SystemService }
    }

    companion object {
        internal fun preferredRecognizerMode(context: Context): MobileSpeechRecognitionMode? = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context) ->
                MobileSpeechRecognitionMode.OnDevice
            SpeechRecognizer.isRecognitionAvailable(context) -> MobileSpeechRecognitionMode.SystemService
            else -> null
        }
    }
}
