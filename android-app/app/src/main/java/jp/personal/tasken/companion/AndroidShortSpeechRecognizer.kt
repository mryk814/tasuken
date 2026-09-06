package jp.personal.tasken.companion

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

data class ShortSpeechRecognitionResult(
    val text: String,
    val mode: MobileSpeechRecognitionMode,
    val language: String,
    val confidence: Float?,
    val warning: String? = null,
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
    private val handler = Handler(Looper.getMainLooper())
    private var session: SpeechSession? = null

    fun availableMode(): MobileSpeechRecognitionMode? = preferredRecognizerMode(context)

    fun start(
        language: String = Locale.getDefault().toLanguageTag(),
        onState: (ShortSpeechUiState) -> Unit,
    ) {
        cancel()
        val mode = preferredRecognizerMode(context)
        if (mode == null) {
            onState(ShortSpeechUiState.Error("この端末では音声認識を利用できません。手入力をお使いください。"))
            return
        }
        val nextSession = SpeechSession(
            mode = mode,
            language = language,
            onState = onState,
            lastSpeechAtMillis = SystemClock.elapsedRealtime(),
        )
        session = nextSession
        startChunk(nextSession)
    }

    private fun startChunk(active: SpeechSession) {
        if (session !== active || active.stopping) return
        val nextRecognizer = createRecognizer(context, active.mode)
        if (nextRecognizer == null) {
            finishWithError(active, "この端末では音声認識を利用できません。手入力をお使いください。")
            return
        }
        recognizer = nextRecognizer
        nextRecognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                if (!isCurrent(active, nextRecognizer)) return
                active.onState(ShortSpeechUiState.Listening(active.mode))
            }

            override fun onBeginningOfSpeech() {
                if (!isCurrent(active, nextRecognizer)) return
                active.lastSpeechAtMillis = SystemClock.elapsedRealtime()
                active.onState(ShortSpeechUiState.Listening(active.mode))
            }

            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit

            override fun onEndOfSpeech() {
                if (!isCurrent(active, nextRecognizer)) return
                active.onState(
                    if (active.stopping) ShortSpeechUiState.Processing(active.mode)
                    else ShortSpeechUiState.Listening(active.mode),
                )
            }

            override fun onError(error: Int) {
                if (!isCurrent(active, nextRecognizer)) return
                active.transcript = mergeSpeechTranscript(active.transcript, active.partialTranscript)
                active.partialTranscript = ""
                releaseRecognizer(nextRecognizer)
                if (active.stopping) {
                    finish(active, error)
                } else if (error in recoverableEndpointErrors && !idleLimitReached(active)) {
                    handler.postDelayed({ startChunk(active) }, chunkRestartDelayMillis)
                } else if (active.transcript.isNotBlank() && error in recoverableEndpointErrors) {
                    finish(active)
                } else {
                    finishWithError(active, speechErrorMessage(error))
                }
            }

            override fun onResults(results: Bundle?) {
                if (!isCurrent(active, nextRecognizer)) return
                val candidates = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                val text = candidates.firstOrNull()?.trim()?.takeIf(String::isNotEmpty)
                    ?: active.partialTranscript
                val confidence = results
                    ?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
                    ?.firstOrNull()
                    ?.takeIf { it >= 0f }
                releaseRecognizer(nextRecognizer)
                if (text.isNotBlank()) {
                    active.transcript = mergeSpeechTranscript(active.transcript, text)
                    active.lastSpeechAtMillis = SystemClock.elapsedRealtime()
                    if (confidence != null) active.confidences += confidence
                }
                active.partialTranscript = ""
                if (active.stopping) {
                    finish(active, SpeechRecognizer.ERROR_NO_MATCH)
                } else if (idleLimitReached(active)) {
                    finish(active, SpeechRecognizer.ERROR_NO_MATCH)
                } else {
                    if (active.transcript.isNotBlank()) {
                        active.onState(ShortSpeechUiState.Partial(active.mode, active.transcript))
                    }
                    handler.postDelayed({ startChunk(active) }, chunkRestartDelayMillis)
                }
            }

            override fun onPartialResults(partialResults: Bundle?) {
                if (!isCurrent(active, nextRecognizer)) return
                val partial = partialResults
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    ?.trim()
                    .orEmpty()
                if (partial.isNotEmpty()) {
                    active.partialTranscript = partial
                    active.lastSpeechAtMillis = SystemClock.elapsedRealtime()
                    active.onState(
                        ShortSpeechUiState.Partial(
                            active.mode,
                            mergeSpeechTranscript(active.transcript, partial),
                        ),
                    )
                }
            }

            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        active.onState(ShortSpeechUiState.Listening(active.mode))
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, active.language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        runCatching { nextRecognizer.startListening(intent) }
            .onFailure {
                releaseRecognizer(nextRecognizer)
                finishWithError(active, "音声入力を開始できませんでした。もう一度お試しください。")
            }
    }

    fun stop() {
        val active = session ?: return
        active.stopping = true
        active.onState(ShortSpeechUiState.Processing(active.mode))
        val current = recognizer
        if (current == null) finish(active)
        else runCatching { current.stopListening() }.onFailure { finish(active) }
    }

    fun cancel() {
        val active = session
        session = null
        active?.stopping = true
        handler.removeCallbacksAndMessages(null)
        val previous = recognizer
        recognizer = null
        previous?.cancel()
        previous?.destroy()
    }

    fun destroy() {
        cancel()
    }

    private fun isCurrent(active: SpeechSession, candidate: SpeechRecognizer): Boolean =
        session === active && recognizer === candidate

    private fun releaseRecognizer(candidate: SpeechRecognizer) {
        if (recognizer === candidate) recognizer = null
        candidate.destroy()
    }

    private fun idleLimitReached(active: SpeechSession): Boolean =
        SystemClock.elapsedRealtime() - active.lastSpeechAtMillis >= idleFinalizeMillis

    private fun finish(
        active: SpeechSession,
        emptyError: Int = SpeechRecognizer.ERROR_NO_MATCH,
        warning: String? = null,
    ) {
        if (session !== active) return
        session = null
        handler.removeCallbacksAndMessages(null)
        recognizer?.destroy()
        recognizer = null
        val text = mergeSpeechTranscript(active.transcript, active.partialTranscript)
        if (text.isBlank()) {
            active.onState(ShortSpeechUiState.Error(speechErrorMessage(emptyError)))
            return
        }
        active.onState(
            ShortSpeechUiState.Result(
                ShortSpeechRecognitionResult(
                    text = text,
                    mode = active.mode,
                    language = active.language,
                    confidence = active.confidences.takeIf { it.isNotEmpty() }?.average()?.toFloat(),
                    warning = warning,
                ),
            ),
        )
    }

    private fun finishWithError(active: SpeechSession, message: String) {
        if (session !== active) return
        if (active.transcript.isNotBlank() || active.partialTranscript.isNotBlank()) {
            finish(active, warning = "$message 聞き取れた内容は残しました。")
            return
        }
        session = null
        handler.removeCallbacksAndMessages(null)
        recognizer?.destroy()
        recognizer = null
        active.onState(ShortSpeechUiState.Error(message))
    }

    private fun createRecognizer(
        context: Context,
        mode: MobileSpeechRecognitionMode,
    ): SpeechRecognizer? {
        if (mode == MobileSpeechRecognitionMode.OnDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(context) }
                .getOrNull()
                ?.let { return it }
        }
        if (mode != MobileSpeechRecognitionMode.SystemService || !SpeechRecognizer.isRecognitionAvailable(context)) return null
        return runCatching { SpeechRecognizer.createSpeechRecognizer(context) }.getOrNull()
    }

    companion object {
        private const val idleFinalizeMillis = 30_000L
        private const val chunkRestartDelayMillis = 150L
        private val recoverableEndpointErrors = setOf(
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
        )
        internal fun preferredRecognizerMode(context: Context): MobileSpeechRecognitionMode? = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context) ->
                MobileSpeechRecognitionMode.OnDevice
            SpeechRecognizer.isRecognitionAvailable(context) -> MobileSpeechRecognitionMode.SystemService
            else -> null
        }
    }
}

private data class SpeechSession(
    val mode: MobileSpeechRecognitionMode,
    val language: String,
    val onState: (ShortSpeechUiState) -> Unit,
    var lastSpeechAtMillis: Long,
    var transcript: String = "",
    var partialTranscript: String = "",
    val confidences: MutableList<Float> = mutableListOf(),
    var stopping: Boolean = false,
)

internal fun mergeSpeechTranscript(committed: String, next: String): String {
    val left = committed.trim()
    val right = next.trim()
    if (left.isEmpty()) return right
    if (right.isEmpty()) return left
    return "$left $right"
}
