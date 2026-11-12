package jp.personal.tasken.companion

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.location.Geocoder
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimeInput
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

private val radiusChoices = listOf(100, 300, 500, 1000, 2000)
private val weekdayLabels = listOf("日", "月", "火", "水", "木", "金", "土")

private fun radiusLabel(meters: Int) = if (meters >= 1000 && meters % 1000 == 0) "${meters / 1000}km" else "${meters}m"

/**
 * Task の場所のリマインダー（#727）。場所を付けると、そこに 3 分とどまったときに通知する。
 * 絵と短い語だけで、付ける・変える・外すを 1 タップで行う。位置情報の権限は場所を初めて付けるときにだけ求める。
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
internal fun TaskPlaceReminderEditor(
    place: MobilePlaceReminder?,
    previousPlaces: List<MobilePlaceReminder>,
    enabled: Boolean,
    stateDescription: String?,
    onChange: (MobilePlaceReminder?) -> Unit,
    /** 画面の確認と試験で、権限の状態を固定するため。通常は null（端末の実際の状態を見る）。 */
    readinessOverride: PlaceReminderReadiness? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var actualReadiness by remember { mutableStateOf(PlaceReminderGeofences.readiness(context)) }
    val readiness = readinessOverride ?: actualReadiness
    var locating by remember { mutableStateOf(false) }
    var locationFailed by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    // 0=閉じている、1=開始時刻、2=終了時刻
    var timeStep by remember { mutableStateOf(0) }
    var pendingFrom by remember { mutableStateOf("") }
    var askedLocation by remember { mutableStateOf(false) }
    var askedNotification by remember { mutableStateOf(false) }
    var useCurrentAfterGrant by remember { mutableStateOf(false) }

    fun refresh() {
        actualReadiness = PlaceReminderGeofences.readiness(context)
        // 権限が整った（または外れた）ときは、待たずに登録し直す。
        PlaceReminderGeofences.syncAsync(context)
    }

    // 設定画面で「常に許可」を選んで戻ってきたときにも見た目を合わせる。
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) actualReadiness = PlaceReminderGeofences.readiness(context)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    fun openAppSettings() {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    var requestNext: () -> Unit = {}
    val backgroundLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        refresh()
        if (granted) requestNext()
    }
    fun requestMissingPermissions(fromUser: Boolean) {
        // 許可の結果が返った直後でも古い値を見ないよう、ここで取り直す。
        when {
            PlaceReminderGeofences.readiness(context).let { it == PlaceReminderReadiness.NoPlayServices || it == PlaceReminderReadiness.Ready } -> Unit
            !PlaceReminderGeofences.hasForegroundLocation(context) -> Unit // 前景の許可は下の launcher が先に求める
            !PlaceReminderGeofences.hasBackgroundLocation(context) ->
                // Android 11 以降は「常に許可」を設定画面で選ぶ。10 では通常のダイアログ。
                if (Build.VERSION.SDK_INT >= 30 && fromUser) openAppSettings()
                else backgroundLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            Build.VERSION.SDK_INT >= 33 && !MobileTaskNotifications.canPost(context) ->
                if (askedNotification && fromUser) openAppSettings()
                else { askedNotification = true; notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }
            else -> Unit
        }
    }
    requestNext = { requestMissingPermissions(false) }

    var onForegroundResult: (Boolean) -> Unit = {}
    val foregroundLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        refresh()
        onForegroundResult(
            result[Manifest.permission.ACCESS_FINE_LOCATION] == true || result[Manifest.permission.ACCESS_COARSE_LOCATION] == true,
        )
    }
    fun requestForeground() {
        askedLocation = true
        foregroundLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    fun setPlace(next: MobilePlaceReminder) {
        onChange(next)
        // 場所を初めて付けたときだけ、足りない権限を前景→「常に許可」→通知の順に求める。
        if (place == null) {
            if (!PlaceReminderGeofences.hasForegroundLocation(context)) requestForeground() else requestMissingPermissions(false)
        }
    }

    @SuppressLint("MissingPermission")
    fun useCurrentLocation() {
        locating = true
        locationFailed = false
        scope.launch {
            val found = fetchCurrentPlace(context)
            locating = false
            if (found == null) locationFailed = true else setPlace(found)
        }
    }

    onForegroundResult = { granted ->
        val wantedCurrent = useCurrentAfterGrant
        useCurrentAfterGrant = false
        if (granted && wantedCurrent) useCurrentLocation()
        else if (granted) requestMissingPermissions(false)
    }

    fun onCurrentLocation() {
        if (PlaceReminderGeofences.hasForegroundLocation(context)) {
            useCurrentLocation()
        } else {
            useCurrentAfterGrant = true
            requestForeground()
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth().testTag("task-place-editor"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("場所", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        stateDescription?.takeIf { !enabled }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        if (place == null) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(
                    onClick = ::onCurrentLocation,
                    enabled = enabled && !locating,
                    label = { Text(if (locating) "取得中" else "現在地", maxLines = 1) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_tabler_current_location), null, Modifier.size(18.dp)) },
                    modifier = Modifier.testTag("place-use-current"),
                )
                previousPlaces.take(8).forEachIndexed { index, previous ->
                    AssistChip(
                        onClick = { setPlace(previous.copy(days = emptyList(), timeFrom = null, timeTo = null)) },
                        enabled = enabled,
                        label = { Text(previous.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp)) },
                        leadingIcon = { Icon(painterResource(R.drawable.ic_tabler_map_pin), null, Modifier.size(18.dp)) },
                        modifier = Modifier.testTag("place-previous-$index"),
                    )
                }
            }
            if (locationFailed) PlaceWarning("現在地を取得できません", R.drawable.ic_tabler_alert_triangle, Modifier.testTag("place-locate-error"))
        } else {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.secondaryContainer,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(start = 12.dp, top = 4.dp, bottom = 4.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        painterResource(R.drawable.ic_tabler_map_pin), null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(22.dp),
                    )
                    Column(
                        modifier = Modifier.weight(1f).clickable(enabled = enabled, onClickLabel = "場所の名前を変える") { renaming = true }
                            .heightIn(min = 40.dp).testTag("place-name"),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            place.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                        Text(
                            radiusLabel(place.radiusMeters), style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.testTag("place-radius-label"),
                        )
                    }
                    IconButton(
                        onClick = { onChange(null) }, enabled = enabled,
                        modifier = Modifier.testTag("place-remove"),
                    ) {
                        Icon(painterResource(R.drawable.ic_tabler_x), contentDescription = "場所を外す", tint = MaterialTheme.colorScheme.onSecondaryContainer)
                    }
                }
            }

            readinessWarning(readiness)?.let { (text, fixable) ->
                PlaceWarning(
                    text, R.drawable.ic_tabler_bell_off,
                    Modifier.testTag("place-not-notifying").let { base ->
                        if (fixable) base.clickable(onClickLabel = "通知できるようにする") {
                            when (readiness) {
                                PlaceReminderReadiness.NoLocationPermission ->
                                    if (askedLocation) openAppSettings() else requestForeground()
                                else -> requestMissingPermissions(true)
                            }
                        } else base
                    },
                )
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("place-radius")) {
                radiusChoices.forEach { meters ->
                    FilterChip(
                        selected = place.radiusMeters == meters,
                        onClick = { onChange(place.copy(radiusMeters = meters)) },
                        enabled = enabled,
                        label = { Text(radiusLabel(meters), maxLines = 1) },
                        modifier = Modifier.testTag("place-radius-$meters"),
                    )
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.testTag("place-days"),
            ) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.weight(1f, fill = false)) {
                    weekdayLabels.forEachIndexed { day, label ->
                        val selected = day in place.days
                        Surface(
                            onClick = {
                                val days = if (selected) place.days - day else (place.days + day).sorted()
                                onChange(place.copy(days = days))
                            },
                            enabled = enabled,
                            shape = CircleShape,
                            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                            contentColor = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                            border = if (selected) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.size(40.dp).testTag("place-day-$day").semantics { this.selected = selected; contentDescription = label + "曜日" },
                        ) {
                            Box(contentAlignment = Alignment.Center) { Text(label, style = MaterialTheme.typography.labelLarge) }
                        }
                    }
                }
                if (place.days.isEmpty()) {
                    Text("毎日", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                val window = place.timeFrom?.let { from -> place.timeTo?.let { to -> "$from–$to" } }
                Surface(
                    onClick = { timeStep = 1 },
                    enabled = enabled,
                    shape = RoundedCornerShape(10.dp),
                    color = if (window != null) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                    border = if (window != null) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.heightIn(min = 40.dp).testTag("place-time-window"),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(painterResource(R.drawable.ic_tabler_clock), null, Modifier.size(18.dp))
                        Text(window ?: "終日", style = MaterialTheme.typography.labelLarge)
                    }
                }
                if (window != null) {
                    IconButton(
                        onClick = { onChange(place.copy(timeFrom = null, timeTo = null)) }, enabled = enabled,
                        modifier = Modifier.testTag("place-time-clear"),
                    ) { Icon(painterResource(R.drawable.ic_tabler_x), contentDescription = "時間帯を外す", modifier = Modifier.size(20.dp)) }
                }
            }
        }
    }

    if (renaming && place != null) {
        var draft by remember { mutableStateOf(place.name) }
        AlertDialog(
            onDismissRequest = { renaming = false },
            title = { Text("場所の名前") },
            text = {
                OutlinedTextField(
                    value = draft, onValueChange = { if (it.length <= 80) draft = it }, singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("place-name-input"),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = { onChange(place.copy(name = draft.trim())); renaming = false },
                    enabled = draft.trim().isNotEmpty(),
                    modifier = Modifier.testTag("place-name-save"),
                ) { Text("決定") }
            },
            dismissButton = { TextButton(onClick = { renaming = false }) { Text("キャンセル") } },
        )
    }

    // 「から」と「まで」で別の入力状態にするため、段ごとに作り直す。
    if (timeStep > 0 && place != null) androidx.compose.runtime.key(timeStep) {
        val initial = (if (timeStep == 1) place.timeFrom else place.timeTo)
            ?.split(":")?.map(String::toInt) ?: listOf(if (timeStep == 1) 17 else 21, 0)
        val timeState = rememberTimePickerState(initialHour = initial[0], initialMinute = initial[1], is24Hour = true)
        AlertDialog(
            onDismissRequest = { timeStep = 0 },
            title = { Text(if (timeStep == 1) "から" else "まで") },
            text = { TimeInput(state = timeState, modifier = Modifier.testTag("place-time-input")) },
            confirmButton = {
                TextButton(
                    onClick = {
                        val value = "%02d:%02d".format(timeState.hour, timeState.minute)
                        if (timeStep == 1) {
                            pendingFrom = value
                            timeStep = 2
                        } else {
                            onChange(place.copy(timeFrom = pendingFrom, timeTo = value))
                            timeStep = 0
                        }
                    },
                    modifier = Modifier.testTag("place-time-next"),
                ) { Text(if (timeStep == 1) "次へ" else "決定") }
            },
            dismissButton = { TextButton(onClick = { timeStep = 0 }) { Text("キャンセル") } },
        )
    }
}

/** 通知されない理由を、絵と短い語で。直せるものは押せる。 */
private fun readinessWarning(readiness: PlaceReminderReadiness): Pair<String, Boolean>? = when (readiness) {
    PlaceReminderReadiness.Ready -> null
    PlaceReminderReadiness.NoPlayServices -> "この端末では通知されません" to false
    PlaceReminderReadiness.NoLocationPermission -> "位置情報が許可されていません" to true
    PlaceReminderReadiness.NoBackgroundLocation -> "「常に許可」で通知されます" to true
    PlaceReminderReadiness.NoNotificationPermission -> "通知が許可されていません" to true
}

@Composable
private fun PlaceWarning(text: String, icon: Int, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        modifier = modifier.heightIn(min = 40.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(painterResource(icon), null, Modifier.size(18.dp))
            Text(text, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** 現在地を 1 回だけ取り、住所から名前を付ける。取れなければ null。 */
@SuppressLint("MissingPermission")
private suspend fun fetchCurrentPlace(context: android.content.Context): MobilePlaceReminder? {
    if (!PlaceReminderGeofences.playServicesAvailable(context)) return null
    val client = LocationServices.getFusedLocationProviderClient(context)
    val source = CancellationTokenSource()
    val location = withTimeoutOrNull(15_000) {
        suspendCancellableCoroutine<android.location.Location?> { continuation ->
            client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, source.token)
                .addOnSuccessListener { continuation.resume(it) }
                .addOnFailureListener { continuation.resume(null) }
            continuation.invokeOnCancellation { source.cancel() }
        }
    } ?: runCatching {
        suspendCancellableCoroutine<android.location.Location?> { continuation ->
            client.lastLocation.addOnSuccessListener { continuation.resume(it) }.addOnFailureListener { continuation.resume(null) }
        }
    }.getOrNull() ?: return null
    val name = withContext(Dispatchers.IO) { placeNameFor(context, location.latitude, location.longitude) }
    return MobilePlaceReminder(
        name = name,
        // 小数 5 桁（約 1m）に丸める。
        latitude = Math.round(location.latitude * 1e5) / 1e5,
        longitude = Math.round(location.longitude * 1e5) / 1e5,
        radiusMeters = PLACE_REMINDER_DEFAULT_RADIUS_M,
    )
}

/** 住所の名前。取れない・数字だけのときは「現在地」。あとから名前の欄で直せる。 */
@Suppress("DEPRECATION")
private suspend fun placeNameFor(context: android.content.Context, latitude: Double, longitude: Double): String {
    if (!Geocoder.isPresent()) return "現在地"
    val geocoder = Geocoder(context, Locale.JAPAN)
    val address = withTimeoutOrNull(4_000) {
        runCatching {
            if (Build.VERSION.SDK_INT >= 33) {
                suspendCancellableCoroutine<android.location.Address?> { continuation ->
                    geocoder.getFromLocation(latitude, longitude, 1, object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<android.location.Address>) { continuation.resume(addresses.firstOrNull()) }
                        override fun onError(errorMessage: String?) { continuation.resume(null) }
                    })
                }
            } else geocoder.getFromLocation(latitude, longitude, 1)?.firstOrNull()
        }.getOrNull()
    }
    val candidates = listOfNotNull(address?.featureName, address?.thoroughfare, address?.subLocality, address?.locality)
    return candidates.map(String::trim).firstOrNull { it.isNotEmpty() && it.any { c -> !c.isDigit() && c != '-' && c != '−' } }
        ?.take(80) ?: "現在地"
}
