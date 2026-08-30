package jp.personal.tasken.companion

import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/** Canonical Task deep links preserve an arbitrary contract ID byte-for-byte. */
object MobileTaskLocator {
    fun format(taskId: String): String {
        require(isCanonicalTaskId(taskId)) { "Task ID is invalid" }
        return "tasken://task/${percentEncode(taskId)}"
    }

    fun parse(uri: URI): String? {
        if (uri.scheme != "tasken" || uri.host != "task" || uri.userInfo != null || uri.port != -1 || uri.fragment != null) return null
        if (uri.rawQuery != null && uri.rawQuery !in setOf("source=widget", "source=notification")) return null
        val rawPath = uri.rawPath ?: return null
        if (!rawPath.startsWith('/') || rawPath.length == 1 || rawPath.drop(1).contains('/')) return null
        val taskId = strictPercentDecode(rawPath.drop(1))?.takeIf(::isCanonicalTaskId) ?: return null
        return taskId.takeIf { format(it) == "tasken://task$rawPath" }
    }

    fun isCanonicalTaskId(value: String): Boolean =
        value.length in 1..200 && value == value.trim() && isWellFormedUnicode(value)

    private fun isWellFormedUnicode(value: String): Boolean {
        var index = 0
        while (index < value.length) {
            val current = value[index]
            when {
                Character.isHighSurrogate(current) -> {
                    if (index + 1 >= value.length || !Character.isLowSurrogate(value[index + 1])) return false
                    index += 2
                }
                Character.isLowSurrogate(current) -> return false
                else -> index += 1
            }
        }
        return true
    }

    private fun percentEncode(value: String): String = buildString {
        value.toByteArray(StandardCharsets.UTF_8).forEach { byte ->
            val code = byte.toInt() and 0xff
            if ((code in 'a'.code..'z'.code) || (code in 'A'.code..'Z'.code) ||
                (code in '0'.code..'9'.code) || code in intArrayOf('-'.code, '.'.code, '_'.code, '~'.code)
            ) append(code.toChar()) else append("%${code.toString(16).uppercase().padStart(2, '0')}")
        }
    }

    private fun strictPercentDecode(value: String): String? = try {
        val bytes = ArrayList<Byte>()
        var index = 0
        while (index < value.length) {
            if (value[index] == '%') {
                if (index + 2 >= value.length) return null
                val high = value[index + 1].digitToIntOrNull(16) ?: return null
                val low = value[index + 2].digitToIntOrNull(16) ?: return null
                bytes += ((high shl 4) + low).toByte()
                index += 3
            } else {
                val end = value.offsetByCodePoints(index, 1)
                bytes += value.substring(index, end).toByteArray(StandardCharsets.UTF_8).toList()
                index = end
            }
        }
        StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
    } catch (_: CharacterCodingException) {
        null
    }
}
