package jp.personal.tasken.companion

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

data class MobilePendingCapture(
    val commandId: String,
    val text: String,
    val createdAt: String,
    val status: String,
    val canRetry: Boolean,
    /** 受け取られなかった理由が PC の版の古さで、本人が PC を新しくすると送れる物。 */
    val needsFix: Boolean = false,
)

/** 送り直しを待っている命令のまとめ。同期の画面で、何回送ったか・最後はいつか・なぜ送れなかったかを見せる。 */
data class MobileSendRetry(val attempts: Int, val lastAttemptAt: String?, val reason: String?)

/** 理由は、PC が返した形（code・message の JSON）でも、端末が付けた文でも入っている。画面には文だけ出す。 */
internal fun outboxReasonText(lastError: String?): String? {
    val raw = lastError?.takeIf { it.isNotBlank() } ?: return null
    return runCatching {
        Json.parseToJsonElement(raw).jsonObject.getValue("message").jsonPrimitive.content
    }.getOrDefault(raw).takeIf { it.isNotBlank() }
}

internal fun List<OutboxCommandEntity>.toSendRetry(): MobileSendRetry? {
    if (isEmpty()) return null
    // 最後に試した命令の理由を見せる（試した時刻が無い行は、途中で止まった送信を戻した物）。
    val latest = maxWith(compareBy<OutboxCommandEntity> { it.lastAttemptAt.orEmpty() }.thenBy { it.attemptCount })
    return MobileSendRetry(
        attempts = maxOf { it.attemptCount },
        lastAttemptAt = latest.lastAttemptAt,
        reason = outboxReasonText(latest.lastError),
    )
}

internal const val LONG_CAPTURE_UPDATE_REQUIRED =
    "このDesktopは長文Captureに対応していません。原文は端末に保持しています。Desktopを更新してから送り直してください。"

internal const val PHOTO_CAPTURE_UPDATE_REQUIRED =
    "このDesktopは写真付きCaptureに対応していません。原文と写真は端末に保持しています。Desktopを更新してから送り直してください。"

internal fun hasCaptureImages(envelopeJson: String): Boolean = runCatching {
    val capture = Json.parseToJsonElement(envelopeJson).jsonObject.getValue("command").jsonObject
        .getValue("capture").jsonObject
    (capture["images"]?.jsonArray?.size ?: 0) > 0
}.getOrDefault(false)

internal fun OutboxCommandEntity.toPendingCapture(): MobilePendingCapture? {
    if (commandName != "CreateCapture") return null
    val text = runCatching {
        Json.parseToJsonElement(envelopeJson).jsonObject.getValue("command").jsonObject
            .getValue("capture").jsonObject.getValue("text").jsonPrimitive.content
    }.getOrNull() ?: return null
    val errorCode = runCatching {
        Json.parseToJsonElement(requireNotNull(lastError)).jsonObject["code"]?.jsonPrimitive?.content
    }.getOrNull()
    return MobilePendingCapture(
        commandId, text, createdAt,
        status = when {
            state == OutboxState.Rejected && errorCode == "capability_unavailable" && hasCaptureImages(envelopeJson) -> PHOTO_CAPTURE_UPDATE_REQUIRED
            state == OutboxState.Rejected && errorCode == "capability_unavailable" -> LONG_CAPTURE_UPDATE_REQUIRED
            state == OutboxState.Rejected -> "PC が受け取りませんでした。原文は端末に残してあります。接続先を確かめて送り直せます。"
            state == OutboxState.Sending -> "PC へ送っています。原文は端末に残してあります。"
            else -> "つながったら送ります。原文は端末に残してあります。"
        },
        canRetry = state == OutboxState.Rejected,
        needsFix = state == OutboxState.Rejected && errorCode == "capability_unavailable",
    )
}

/** Only a response from the paired server may classify a long capture as unsupported. */
internal fun isUnsupportedLongCapture(
    envelopeJson: String,
    response: GatewayHttpResponse,
    expectedServerId: String,
): Boolean = runCatching {
    if (response.status !in setOf(400, 409, 422)) return false
    val command = Json.parseToJsonElement(envelopeJson).jsonObject.getValue("command").jsonObject
    if (command["name"]?.jsonPrimitive?.content != "CreateCapture") return false
    val capture = command.getValue("capture").jsonObject
    if (capture["textContract"]?.jsonPrimitive?.content != MOBILE_CAPTURE_TEXT_CONTRACT &&
        capture.getValue("text").jsonPrimitive.content.length <= MOBILE_TASK_TITLE_MAX_LENGTH) return false
    val body = Json.parseToJsonElement(response.body).jsonObject
    body.getValue("meta").jsonObject.getValue("serverId").jsonPrimitive.content == expectedServerId &&
        body.getValue("error").jsonObject.getValue("code").jsonPrimitive.content in setOf("validation_failed", "version_mismatch")
}.getOrDefault(false)

/** Only a response from the paired server may classify a photo capture as unsupported. */
internal fun isUnsupportedPhotoCapture(
    envelopeJson: String,
    response: GatewayHttpResponse,
    expectedServerId: String,
): Boolean = runCatching {
    if (response.status !in setOf(400, 409, 422)) return false
    val command = Json.parseToJsonElement(envelopeJson).jsonObject.getValue("command").jsonObject
    if (command["name"]?.jsonPrimitive?.content != "CreateCapture") return false
    if (!hasCaptureImages(envelopeJson)) return false
    val body = Json.parseToJsonElement(response.body).jsonObject
    body.getValue("meta").jsonObject.getValue("serverId").jsonPrimitive.content == expectedServerId &&
        body.getValue("error").jsonObject.getValue("code").jsonPrimitive.content in setOf("validation_failed", "version_mismatch", "capability_unavailable")
}.getOrDefault(false)
