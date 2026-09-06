package jp.personal.tasken.companion

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.Duration
import java.time.Instant
import java.util.UUID

internal const val CAPTURE_PHOTO_MAX_DIMENSION = 2048
internal const val CAPTURE_PHOTO_JPEG_QUALITY = 80
internal const val CAPTURE_PHOTO_MAX_COUNT = 8

/**
 * Builds the stable wire reference id for the n-th photo (1-based) of one capture.
 * Retried sends keep file order, so reference ids stay stable across retries.
 */
internal fun capturePhotoReferenceId(index: Int): String {
    require(index >= 1)
    return "photo-$index"
}

/** Pure downscale math kept JVM-testable; Bitmap work stays in [MobileCapturePhotoStore]. */
internal fun scaledPhotoDimensions(width: Int, height: Int, maxDimension: Int): Pair<Int, Int> {
    require(width > 0 && height > 0 && maxDimension > 0)
    val longest = maxOf(width, height)
    if (longest <= maxDimension) return width to height
    val scale = maxDimension.toDouble() / longest.toDouble()
    return maxOf(1, (width * scale).toInt()) to maxOf(1, (height * scale).toInt())
}

/**
 * App-private photo files for Capture drafts. Files (not bytes) are referenced
 * from drafts; bytes are encoded once at the command boundary into the outbox,
 * so the draft store and Room stay small.
 */
class MobileCapturePhotoStore(
    context: Context,
    private val now: () -> Instant = Instant::now,
) {
    private val applicationContext = context.applicationContext
    private val directory = File(applicationContext.filesDir, "capture-photos").also {
        if (!it.isDirectory) it.mkdirs()
    }

    init {
        pruneOlderThan(Duration.ofDays(7))
    }

    fun authority(): String = "${applicationContext.packageName}.fileprovider"

    /** Creates an empty JPEG file and returns its name for the camera intent output. */
    fun createPhotoFile(): String {
        val name = "capture-${UUID.randomUUID()}.jpg"
        val file = File(directory, name)
        require(file.parentFile == directory)
        require(file.createNewFile())
        return name
    }

    fun photoUri(fileName: String): Uri {
        requireValidName(fileName)
        return FileProvider.getUriForFile(applicationContext, authority(), File(directory, fileName))
    }

    fun hasPhoto(fileName: String): Boolean {
        if (!isValidName(fileName)) return false
        val file = File(directory, fileName)
        return file.isFile && file.length() > 0
    }

    /**
     * Encodes staged photos to wire DTOs in order. Throws when a file is missing
     * or undecodable so the Draft is kept for retry instead of sending half a set.
     */
    fun encodePhotos(fileNames: List<String>): List<MobileCaptureImageDto> {
        require(fileNames.size in 1..CAPTURE_PHOTO_MAX_COUNT)
        return fileNames.mapIndexed { index, fileName ->
            val bytes = downscaledJpegBytes(fileName)
                ?: throw IllegalArgumentException("写真を読み込めませんでした。再撮影してください。")
            MobileCaptureImageDto(
                referenceId = capturePhotoReferenceId(index + 1),
                fileName = fileName,
                mediaType = "image/jpeg",
                dataBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
            )
        }
    }

    fun deletePhotos(fileNames: List<String>) {
        fileNames.forEach { fileName ->
            if (!isValidName(fileName)) return@forEach
            runCatching { File(directory, fileName).delete() }
        }
    }

    /**
     * Loads a small UI thumbnail. Returns null when the file is missing or
     * undecodable; callers show a placeholder instead of failing the sheet.
     */
    fun loadThumbnail(fileName: String, maxSizePx: Int = 256): androidx.compose.ui.graphics.ImageBitmap? =
        runCatching {
            requireValidName(fileName)
            val file = File(directory, fileName)
            val bounds = BitmapFactory.Options().also { it.inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            var sampleSize = 1
            while (bounds.outWidth / (sampleSize * 2) >= maxSizePx &&
                bounds.outHeight / (sampleSize * 2) >= maxSizePx
            ) {
                sampleSize *= 2
            }
            val options = BitmapFactory.Options().also { it.inSampleSize = sampleSize }
            BitmapFactory.decodeFile(file.absolutePath, options)?.asImageBitmap()
        }.getOrNull()

    private fun downscaledJpegBytes(fileName: String): ByteArray? = runCatching {
        requireValidName(fileName)
        val file = File(directory, fileName)
        val bounds = BitmapFactory.Options().also { it.inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val (targetWidth, targetHeight) =
            scaledPhotoDimensions(bounds.outWidth, bounds.outHeight, CAPTURE_PHOTO_MAX_DIMENSION)
        var sampleSize = 1
        while (bounds.outWidth / (sampleSize * 2) >= targetWidth &&
            bounds.outHeight / (sampleSize * 2) >= targetHeight
        ) {
            sampleSize *= 2
        }
        val options = BitmapFactory.Options().also { it.inSampleSize = sampleSize }
        var bitmap = BitmapFactory.decodeFile(file.absolutePath, options) ?: return null
        if (bitmap.width != targetWidth || bitmap.height != targetHeight) {
            val scaled = Bitmap.createScaledBitmap(bitmap, targetWidth, targetHeight, true)
            if (scaled !== bitmap) bitmap.recycle()
            bitmap = scaled
        }
        val output = ByteArrayOutputStream()
        try {
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, CAPTURE_PHOTO_JPEG_QUALITY, output)) {
                return null
            }
            output.toByteArray()
        } finally {
            bitmap.recycle()
        }
    }.getOrNull()

    private fun pruneOlderThan(maxAge: Duration) {
        val cutoff = now().minus(maxAge).toEpochMilli()
        runCatching {
            directory.listFiles()?.forEach { file ->
                if (file.isFile && file.lastModified() < cutoff) file.delete()
            }
        }
    }

    private fun requireValidName(fileName: String) {
        require(isValidName(fileName))
    }

    private fun isValidName(fileName: String): Boolean {
        if (fileName.isBlank() || fileName.length > MOBILE_CAPTURE_IMAGE_FILE_NAME_MAX_LENGTH) return false
        if (fileName.contains('/') || fileName.contains('\\') || fileName.contains('\u0000')) return false
        if (fileName == "." || fileName == "..") return false
        return fileName.endsWith(".jpg", ignoreCase = true)
    }
}
