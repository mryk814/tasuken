package jp.personal.tasken.companion

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * Camera action used inside the capture sheet's compact secondary action row.
 */
@Composable
internal fun CapturePhotoButton(
    photoCount: Int,
    enabled: Boolean,
    onTakePhoto: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedButton(
        onClick = onTakePhoto,
        enabled = enabled && photoCount < CAPTURE_PHOTO_MAX_COUNT,
        modifier = modifier.testTag("capture-photo-action"),
    ) {
        Icon(painterResource(R.drawable.ic_tabler_camera), contentDescription = null)
        Text(
            "写真（${photoCount}/${CAPTURE_PHOTO_MAX_COUNT}）",
            modifier = Modifier.padding(start = 8.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Staged photo thumbnails. Photos are app-private files encoded at the command boundary.
 */
@Composable
internal fun CapturePhotoStrip(
    photos: List<MobileCapturePhoto>,
    enabled: Boolean,
    onRemovePhoto: (String) -> Unit,
    loadThumbnail: (String) -> androidx.compose.ui.graphics.ImageBitmap?,
) {
    if (photos.isEmpty()) return
    LazyRow(
        modifier = Modifier.fillMaxWidth().testTag("capture-photo-list"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(photos, key = { it.fileName }) { photo ->
            val bitmap = remember(photo.fileName) { loadThumbnail(photo.fileName) }
            DisposableEffect(photo.fileName) {
                onDispose { runCatching { bitmap?.asAndroidBitmap()?.recycle() } }
            }
            Box(
                modifier = Modifier.size(96.dp),
                contentAlignment = Alignment.TopEnd,
            ) {
                if (bitmap != null) {
                    Image(
                        bitmap = bitmap,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.size(96.dp).testTag("capture-photo-thumbnail"),
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .size(96.dp)
                            .testTag("capture-photo-thumbnail-missing"),
                    ) {
                        Text(
                            "読込不可",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.align(Alignment.Center),
                        )
                    }
                }
                IconButton(
                    onClick = { onRemovePhoto(photo.fileName) },
                    enabled = enabled,
                    modifier = Modifier.testTag("capture-photo-remove"),
                ) {
                    Icon(painterResource(R.drawable.ic_tabler_x), contentDescription = "削除")
                }
            }
        }
    }
}
