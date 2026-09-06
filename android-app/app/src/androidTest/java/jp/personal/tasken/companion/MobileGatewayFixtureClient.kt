package jp.personal.tasken.companion

import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URI
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Only connects to the explicitly supplied isolated runner fixture; never reads app pairing. */
internal class MobileGatewayFixtureClient {
    private val arguments = InstrumentationRegistry.getArguments()
    val available get() = arguments.containsKey("gatewayOrigin")
    val serverId get() = requireNotNull(arguments.getString("gatewayServerId"))
    val deviceId get() = requireNotNull(arguments.getString("gatewayDeviceId"))

    fun send(envelope: String): MobileCommandSendResult = runCatching {
        val (status, body) = request("/v1/commands", envelope, requireNotNull(arguments.getString("gatewayToken")))
        val capture = Json.parseToJsonElement(envelope).jsonObject.getValue("command").jsonObject
            .getValue("name").jsonPrimitive.content in setOf("CreateCapture", "DeleteCapture")
        val workLog = Json.parseToJsonElement(envelope).jsonObject.getValue("command").jsonObject
            .getValue("name").jsonPrimitive.content in setOf("RecordWorkLog", "DeleteWorkLog", "RestoreWorkLog")
        when {
            status == 200 -> if (workLog) MobileCommandSendResult.WorkLogApplied(MobileWorkLogContract.decodeReceipt(body))
                else if (capture) MobileCommandSendResult.CaptureApplied(MobileCaptureCommandContract.decodeReceipt(body))
                else MobileCommandSendResult.Applied(MobileTaskCommandContract.decodeReceipt(body))
            status == 409 -> MobileTaskCommandContract.decodeError(body).let { error ->
                if (error.error.code == "version_conflict") MobileCommandSendResult.Conflict(error)
                else MobileCommandSendResult.Rejected(error.error.code, error.error.message, error.error.retryable)
            }
            status >= 500 -> MobileCommandSendResult.Retry("Fixture HTTP $status")
            else -> MobileTaskCommandContract.decodeError(body).let { MobileCommandSendResult.Rejected(it.error.code, it.error.message, it.error.retryable) }
        }
    }.getOrElse { MobileCommandSendResult.Retry("Fixture connection interrupted (${it.javaClass.simpleName}): ${it.message?.take(300)}") }

    fun snapshot(): JsonObject = control(null)
    fun read(path: String): GatewayHttpResponse {
        require(path.startsWith("/v1/"))
        val (status, body) = request(path, null, requireNotNull(arguments.getString("gatewayToken")))
        return GatewayHttpResponse(status, body)
    }
    fun workLog(id: String): MobileWorkLogDto? {
        val response = request("/v1/work-logs?id=$id", null, requireNotNull(arguments.getString("gatewayToken")))
        check(response.first == 200)
        return MobileWorkLogContract.json.decodeFromString<MobileWorkLogReadResponse>(response.second).data.workLog
    }
    fun control(body: String? = null): JsonObject {
        val response = request("/__fixture", body, requireNotNull(arguments.getString("gatewayControlToken")))
        check(response.first == 200) { "Fixture control failed: ${response.first}" }
        return Json.parseToJsonElement(response.second).jsonObject
    }

    private fun request(path: String, body: String?, token: String): Pair<Int, String> {
        val connection = URI(requireNotNull(arguments.getString("gatewayOrigin")) + path).toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 3000; connection.readTimeout = 3000
            connection.requestMethod = if (body == null) "GET" else "POST"
            connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                val bytes = body.toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            return status to (if (status < 400) connection.inputStream else connection.errorStream).bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally { connection.disconnect() }
    }
}
