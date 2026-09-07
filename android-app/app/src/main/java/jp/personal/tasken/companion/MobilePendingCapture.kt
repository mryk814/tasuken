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
)

internal const val LONG_CAPTURE_UPDATE_REQUIRED =
    "このDesktopは長文Captureに対応していません。原文は端末に保持しています。Desktopを更新してから再送してください。"

internal const val PHOTO_CAPTURE_UPDATE_REQUIRED =
    "このDesktopは写真付きCaptureに対応していません。原文と写真は端末に保持しています。Desktopを更新してから再送してください。"

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
            state == OutboxState.Rejected -> "Desktopが受理しませんでした。原文を保持しています。接続先を確認して再送できます。"
            state == OutboxState.Sending -> "Desktopへ送信中です。原文は端末に保持しています。"
            else -> "Desktopへの送信を待っています。原文は端末に保持しています。"
        },
        canRetry = state == OutboxState.Rejected,
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
