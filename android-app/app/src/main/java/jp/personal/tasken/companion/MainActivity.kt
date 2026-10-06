package jp.personal.tasken.companion

import android.Manifest
import android.content.res.Configuration
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Bundle
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.Locale
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.IconButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.layout.ListDetailPaneScaffoldRole
import androidx.compose.material3.adaptive.layout.PaneScaffoldDirective
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirective
import androidx.compose.material3.adaptive.navigation.NavigableListDetailPaneScaffold
import androidx.compose.material3.adaptive.navigation.rememberListDetailPaneScaffoldNavigator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private val entryRequest = MutableStateFlow<MobileEntryRequest>(MobileEntryRequest.None)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        entryRequest.value = resolveEntryRequest(intent)
        val repository = AndroidMobileTaskRepository(applicationContext)
        val viewModelFactory = TodayViewModelFactory(
            repository,
            refreshExternalProjection = { TaskenTodayWidget.updateAll(applicationContext) },
            attentionNotificationStore = AttentionNotificationStore(applicationContext),
            notifyAttentionArrivals = { rows, serverId ->
                MobileAttentionNotifications.notifyArrivals(applicationContext, rows, serverId)
            },
        )
        setContent {
            TaskenTheme {
                val request by entryRequest.collectAsState()
                TodayApp(viewModel(factory = viewModelFactory), request)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        entryRequest.value = resolveEntryRequest(intent)
    }

    private fun resolveEntryRequest(intent: Intent): MobileEntryRequest {
        val token = intent.getLongExtra(EXTRA_ENTRY_TOKEN, 0L).takeIf { it != 0L }
            ?: System.nanoTime().also { intent.putExtra(EXTRA_ENTRY_TOKEN, it) }
        return MobileEntryRequestResolver.fromIntent(intent, token)
    }

    companion object {
        private const val EXTRA_ENTRY_TOKEN = "jp.personal.tasken.companion.extra.ENTRY_TOKEN"
    }
}

@Composable
internal fun TaskenTheme(content: @Composable () -> Unit) {
    val isDark =
        (LocalConfiguration.current.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
    val colors = if (isDark) taskenDarkColorScheme() else taskenLightColorScheme()
    MaterialTheme(
        colorScheme = colors,
        shapes = MaterialTheme.shapes.copy(
            small = RoundedCornerShape(4.dp),
            medium = RoundedCornerShape(7.dp),
            large = RoundedCornerShape(10.dp),
        ),
        content = content,
    )
}

internal val TaskenDualPaneMinWidth = 700.dp

@OptIn(ExperimentalMaterial3AdaptiveApi::class)
internal fun taskenPaneScaffoldDirective(
    base: PaneScaffoldDirective,
    windowWidth: Dp,
): PaneScaffoldDirective = if (windowWidth >= TaskenDualPaneMinWidth) {
    base.copy(maxHorizontalPartitions = maxOf(2, base.maxHorizontalPartitions))
} else {
    base
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3AdaptiveApi::class)
@Composable
internal fun TodayApp(
    todayViewModel: TodayViewModel = viewModel(),
    entryRequest: MobileEntryRequest = MobileEntryRequest.None,
) {
    val uiState by todayViewModel.uiState.collectAsState()
    val agentSessions by todayViewModel.agentSessions.collectAsState()
    val agentSessionsUnavailable by todayViewModel.agentSessionsUnavailable.collectAsState()
    val routines by todayViewModel.routines.collectAsState()
    val routineSavingId by todayViewModel.routineSavingId.collectAsState()
    val refreshing by todayViewModel.refreshing.collectAsState()
    val captureState by todayViewModel.captureState.collectAsState()
    val pendingCaptures by todayViewModel.pendingCaptures.collectAsState()
    val taskActionState by todayViewModel.taskActionState.collectAsState()
    val pendingCount by todayViewModel.pendingCount.collectAsState()
    val conflictCount by todayViewModel.conflictCount.collectAsState()
    val allTasks by todayViewModel.allTasks.collectAsState()
    val themeCatalogState by todayViewModel.themeCatalogState.collectAsState()
    val workReceiptDetailState by todayViewModel.workReceiptDetailState.collectAsState()
    val taskWorkProposals by todayViewModel.taskWorkProposals.collectAsState()
    val feedPosts by todayViewModel.feedPosts.collectAsState()
    val proposalReviewOnline by todayViewModel.proposalReviewOnline.collectAsState()
    val proposalReviewState by todayViewModel.proposalReviewState.collectAsState()
    val humanReviewOnline by todayViewModel.humanReviewOnline.collectAsState()
    val humanReviewRequiresRePairing by todayViewModel.humanReviewRequiresRePairing.collectAsState()
    val humanReviewState by todayViewModel.humanReviewState.collectAsState()
    val attentionRows by todayViewModel.attention.collectAsState()
    val attentionCounts by todayViewModel.attentionCounts.collectAsState()
    val attentionFetchedAt by todayViewModel.attentionFetchedAt.collectAsState()
    val attentionOnline by todayViewModel.attentionOnline.collectAsState()
    val attentionRefreshing by todayViewModel.attentionRefreshing.collectAsState()
    val attentionNewArrivals by todayViewModel.attentionNewArrivals.collectAsState()
    val agentReplyState by todayViewModel.agentReplyState.collectAsState()
    val aiReadyState by todayViewModel.aiReadyState.collectAsState()
    val pendingSafeShare by todayViewModel.pendingSafeShare.collectAsState()
    val themes = themeCatalogState.themes
    val context = LocalContext.current
    val attentionNotificationStore = remember(context) { AttentionNotificationStore(context) }
    var attentionNotificationsEnabled by remember {
        mutableStateOf(attentionNotificationStore.isEnabled())
    }
    var notificationsEnabled by remember(context) {
        mutableStateOf(MobileTaskNotifications.canPost(context))
    }
    var notificationPermissionDenied by rememberSaveable { mutableStateOf(false) }
    val captureDraftStore = remember(context) { MobileCaptureDraftStore(context.applicationContext) }
    val restoredCaptureDraft = remember(captureDraftStore) { captureDraftStore.load() }
    val restoredUndoTarget = remember(captureDraftStore) { captureDraftStore.loadUndoTarget() }
    var recoveredInputs by remember(captureDraftStore) { mutableStateOf(captureDraftStore.recoveredInputs()) }
    var recoveryOpen by rememberSaveable { mutableStateOf(false) }
    var pendingCapturesOpen by rememberSaveable { mutableStateOf(false) }
    var workLogOpen by rememberSaveable { mutableStateOf(false) }
    var workLogTaskId by rememberSaveable { mutableStateOf<String?>(null) }
    var workLogRecordId by rememberSaveable { mutableStateOf<String?>(null) }
    var relatedTaskId by rememberSaveable { mutableStateOf<String?>(null) }
    var themeContextId by rememberSaveable { mutableStateOf<String?>(null) }
    var localSearchOpen by rememberSaveable { mutableStateOf(false) }
    var directAiSettingsOpen by rememberSaveable { mutableStateOf(false) }
    var syncSheetOpen by rememberSaveable { mutableStateOf(false) }
    var settingsOpen by rememberSaveable { mutableStateOf(false) }
    var localSearchTaskReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var searchDocumentType by rememberSaveable { mutableStateOf<String?>(null) }
    var searchDocumentId by rememberSaveable { mutableStateOf<String?>(null) }
    var localSearchNotice by remember { mutableStateOf<String?>(null) }
    val localSearchSavedState = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
    var recallCapture by remember { mutableStateOf<MobilePendingCapture?>(null) }
    val paneState = rememberTodayPaneState(restoredCaptureDraft)
    // AIの動きをどこまで見たか。区切り線は入った時点の位置で引き、見た印は次に開く時のために進める。
    val aiSeenStore = remember(context) { AiSeenStore(context) }
    var aiLastSeen by remember { mutableStateOf(aiSeenStore.lastSeenAt()) }
    var aiSeenBefore by remember { mutableStateOf(aiLastSeen) }
    val newestAi = remember(allTasks, taskWorkProposals, feedPosts) {
        newestAiActivity(buildAiTimeline(allTasks, taskWorkProposals, feedPosts))
    }
    val onAiSection = paneState.activeSection == AppSection.Feed
    val aiUnseen = newestAi != null && aiLastSeen?.let { newestAi.isAfter(it) } != false
    LaunchedEffect(onAiSection) {
        if (onAiSection) aiSeenBefore = aiLastSeen
    }
    LaunchedEffect(onAiSection, newestAi) {
        if (onAiSection && newestAi != null) {
            aiSeenStore.markSeen(newestAi)
            aiLastSeen = aiSeenStore.lastSeenAt()
        }
    }
    val speechRecognizer = remember(context) { AndroidShortSpeechRecognizer(context.applicationContext) }
    val photoStore = remember(context) { MobileCapturePhotoStore(context.applicationContext) }
    var pendingPhotoName by remember { mutableStateOf<String?>(null) }
    val takePictureLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val fileName = pendingPhotoName
        pendingPhotoName = null
        if (success && fileName != null && photoStore.hasPhoto(fileName)) {
            if (paneState.captureOpen) {
                paneState.captureDraft = paneState.captureDraft.withPhoto(MobileCapturePhoto(fileName))
            }
        } else if (fileName != null) {
            photoStore.deletePhotos(listOf(fileName))
        }
    }
    var speechState by remember(speechRecognizer) {
        mutableStateOf<ShortSpeechUiState>(ShortSpeechUiState.Idle(speechRecognizer.availableMode()))
    }
    var speechRequestDraftId by remember { mutableStateOf<String?>(null) }
    var speechAppendRequested by remember { mutableStateOf(false) }
    val startSpeechRecognition = {
        val draftId = speechRequestDraftId
        val append = speechAppendRequested
        if (paneState.captureOpen && draftId == paneState.captureDraft.draftId) {
            val capturedAt = Instant.now().toString()
            val timeZone = java.time.ZoneId.systemDefault().id
            speechRecognizer.start(Locale.getDefault().toLanguageTag()) { nextState ->
                if (paneState.captureOpen && draftId == paneState.captureDraft.draftId) {
                    speechState = nextState
                    if (nextState is ShortSpeechUiState.Result) {
                        paneState.captureDraft = paneState.captureDraft.withSpeechResult(nextState.result, append, capturedAt, timeZone)
                    }
                }
            }
        }
    }
    val microphonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startSpeechRecognition()
        } else {
            speechState = ShortSpeechUiState.Error("マイク権限がありません。手入力はそのまま使えます。")
        }
    }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        notificationsEnabled = MobileTaskNotifications.canPost(context)
        notificationPermissionDenied = !granted
    }
    LaunchedEffect(pendingSafeShare, context) {
        val share = pendingSafeShare ?: return@LaunchedEffect
        context.startActivity(MobileSafeShare.chooserIntent(share))
        todayViewModel.consumeSafeShare(share)
    }
    val requestSpeechRecognition: (Boolean) -> Unit = { append ->
        speechRequestDraftId = paneState.captureDraft.draftId
        speechAppendRequested = append
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startSpeechRecognition()
        } else {
            microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    // AIへの返信を話して書く。認識した文字は下書きへ足すだけで、送信は本人が押す。
    var replySpeechState by remember(speechRecognizer) {
        mutableStateOf<ShortSpeechUiState>(ShortSpeechUiState.Idle(speechRecognizer.availableMode()))
    }
    val replyMicrophonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) replySpeechState = ShortSpeechUiState.Error("マイク権限がありません。文字で返信できます。")
    }
    val replyDictation = ReplyDictation(
        state = replySpeechState,
        start = { deliver ->
            if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                speechRecognizer.start(Locale.getDefault().toLanguageTag()) { next ->
                    replySpeechState = next
                    if (next is ShortSpeechUiState.Result) {
                        deliver(next.result.text)
                        replySpeechState = ShortSpeechUiState.Idle(speechRecognizer.availableMode())
                    }
                }
            } else {
                replyMicrophonePermission.launch(Manifest.permission.RECORD_AUDIO)
            }
        },
        stop = speechRecognizer::stop,
    )
    val adaptiveInfo = currentWindowAdaptiveInfo()
    val windowWidthDp = LocalConfiguration.current.screenWidthDp.dp
    val scaffoldDirective = taskenPaneScaffoldDirective(
        base = calculatePaneScaffoldDirective(adaptiveInfo),
        windowWidth = windowWidthDp,
    )
    // Foldの展開幅では一覧と詳細を並べる（同じ閾値を詳細ペインの使い方にも使う）。
    val attentionInDetailPane = scaffoldDirective.maxHorizontalPartitions > 1
    val navigator = key(scaffoldDirective) {
        rememberListDetailPaneScaffoldNavigator(
            scaffoldDirective = scaffoldDirective,
        )
    }
    val coroutineScope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val hapticFeedback = LocalHapticFeedback.current
    var completionFeedback by remember { mutableStateOf<TaskCompletionFeedback?>(null) }
    // 端末に保存できた追加。一覧の行を一度光らせ、入力シートには保存の印を出す。
    var justAddedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var captureSavedKey by remember { mutableStateOf<Long?>(null) }
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    var handledEntryToken by rememberSaveable { mutableLongStateOf(0L) }
    var draftPersistenceFailed by rememberSaveable { mutableStateOf(false) }

    DisposableEffect(speechRecognizer) {
        onDispose { speechRecognizer.destroy() }
    }

    // 反応・返信が受け付けられなかったときだけ知らせる（保存できたときは画面に出るので黙る）。
    LaunchedEffect(todayViewModel) {
        todayViewModel.feedMessages.collect { message -> snackbarHostState.showSnackbar(message) }
    }

    LaunchedEffect(todayViewModel) {
        todayViewModel.taskCompletionFeedback.collectLatest { feedback ->
            hapticFeedback.performHapticFeedback(HapticFeedbackType.Confirm)
            completionFeedback = feedback
            delay(180)
            if (completionFeedback?.eventId == feedback.eventId) completionFeedback = null
        }
    }

    LaunchedEffect(paneState, captureDraftStore) {
        snapshotFlow {
            MobileCaptureDraftSnapshot(
                draft = paneState.captureDraft,
                captureOpen = paneState.captureOpen,
            )
        }.distinctUntilChanged().collect { snapshot ->
            val saved = withContext(Dispatchers.IO) { captureDraftStore.save(snapshot) }
            if (!saved && !draftPersistenceFailed) {
                draftPersistenceFailed = true
                snackbarHostState.showSnackbar(
                    "入力途中のDraftを端末へ保存できませんでした。空き容量を確認して再試行してください。",
                )
            } else if (saved) {
                if (draftPersistenceFailed) {
                    recoveredInputs = withContext(Dispatchers.IO) { captureDraftStore.recoveredInputs() }
                }
                draftPersistenceFailed = false
            }
        }
    }
    LaunchedEffect(restoredUndoTarget) {
        restoredUndoTarget?.let { target ->
            val entityLabel = if (target.kind == MobileCaptureKind.Task) "Task" else "Capture"
            showCreateUndoSnackbar(
                snackbarHostState = snackbarHostState,
                todayViewModel = todayViewModel,
                captureDraftStore = captureDraftStore,
                target = target,
                message = "直前に追加した${entityLabel}を元に戻せます。",
                duration = SnackbarDuration.Indefinite,
            )
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, todayViewModel, context) {
        val dateReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                todayViewModel.refreshLocalDate()
            }
        }
        androidx.core.content.ContextCompat.registerReceiver(
            context,
            dateReceiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_DATE_CHANGED)
                addAction(Intent.ACTION_TIME_CHANGED)
                addAction(Intent.ACTION_TIMEZONE_CHANGED)
            },
            androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                notificationsEnabled = MobileTaskNotifications.canPost(context)
                if (notificationsEnabled) notificationPermissionDenied = false
                todayViewModel.load()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            context.unregisterReceiver(dateReceiver)
        }
    }
    LaunchedEffect(entryRequest, uiState, allTasks, attentionRows, attentionFetchedAt) {
        if (entryRequest.token == 0L || entryRequest.token == handledEntryToken) return@LaunchedEffect
        when (entryRequest) {
            is MobileEntryRequest.Capture -> {
                paneState.openCapture(
                    source = entryRequest.source.toCaptureSource(),
                    initialText = entryRequest.draft,
                    requestVoice = entryRequest.startVoice,
                    sharedMimeType = entryRequest.sharedMimeType,
                )
                speechState = ShortSpeechUiState.Idle(speechRecognizer.availableMode())
                handledEntryToken = entryRequest.token
            }
            is MobileEntryRequest.Task -> {
                val taskExists = allTasks.any { it.id == entryRequest.taskId }
                if (taskExists == true) {
                    paneState.activeSection = AppSection.Tasks
                    paneState.selectedTaskId = entryRequest.taskId
                    navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, entryRequest.taskId)
                    focusManager.clearFocus(force = true)
                    keyboardController?.hide()
                    handledEntryToken = entryRequest.token
                } else if (uiState is TodayUiState.Empty || uiState is TodayUiState.Error) {
                    snackbarHostState.showSnackbar("Taskを開けませんでした。Taskを同期して再試行してください。")
                    handledEntryToken = entryRequest.token
                }
            }
            is MobileEntryRequest.Today -> {
                paneState.activeSection = AppSection.Today
                navigator.navigateTo(ListDetailPaneScaffoldRole.List)
                handledEntryToken = entryRequest.token
            }
            is MobileEntryRequest.Attention -> {
                // 要対応の新着通知から、その判断へ移動する（#601）。
                val row = attentionRows.firstOrNull { it.attentionId == entryRequest.attentionId }
                if (row != null) {
                    paneState.activeSection = AppSection.Feed
                    paneState.openAttention(row.attentionId)
                    todayViewModel.clearAttentionNewArrivals()
                    if (attentionInDetailPane) {
                        navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, row.attentionId)
                    } else {
                        navigator.navigateTo(ListDetailPaneScaffoldRole.List)
                    }
                    handledEntryToken = entryRequest.token
                } else if (attentionFetchedAt != null) {
                    // 既に解決済みの判断。開けなかったことを黙って飲み込まない。
                    snackbarHostState.showSnackbar("この判断はもう要対応にありません。")
                    handledEntryToken = entryRequest.token
                }
            }
            MobileEntryRequest.None -> Unit
        }
    }
    LaunchedEffect(navigator) {
        paneState.selectedTaskId?.let { taskId ->
            navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, taskId)
        }
    }
    LaunchedEffect(paneState.captureOpen, paneState.captureVoiceStartRequested) {
        if (paneState.captureOpen && paneState.captureVoiceStartRequested) {
            paneState.consumeVoiceStartRequest()
            requestSpeechRecognition(true)
        }
    }
    LaunchedEffect(captureState) {
        if (captureState is CaptureUiState.Queued) {
            val queued = captureState as CaptureUiState.Queued
            val queuedEntityIds = listOf(queued.entityId) + queued.additionalEntityIds
            justAddedIds = queuedEntityIds.toSet()
            captureSavedKey = System.nanoTime()
            hapticFeedback.performHapticFeedback(HapticFeedbackType.Confirm)
            if (queuedEntityIds.size > 1) {
                speechRecognizer.cancel()
                speechState = ShortSpeechUiState.Idle(speechRecognizer.availableMode())
                if (queued.completionBehavior == CaptureCompletionBehavior.Continue) {
                    paneState.continueCapture()
                } else {
                    paneState.resetCapture()
                }
                todayViewModel.resetCaptureState()
                coroutineScope.launch {
                    val result = snackbarHostState.showSnackbar(
                        message = "${queuedEntityIds.size}件のTaskを追加しました。Desktopへ自動送信します。",
                        actionLabel = "元に戻す",
                        duration = SnackbarDuration.Long,
                    )
                    if (result == SnackbarResult.ActionPerformed) {
                        todayViewModel.undoCreatedCaptures(queuedEntityIds)
                    }
                }
                return@LaunchedEffect
            }
            val undoTarget = MobileCaptureUndoTarget(queued.entityId, queued.kind)
            val undoTargetSaved = withContext(Dispatchers.IO) {
                captureDraftStore.saveUndoTarget(undoTarget)
            }
            speechRecognizer.cancel()
            speechState = ShortSpeechUiState.Idle(speechRecognizer.availableMode())
            if (queued.completionBehavior == CaptureCompletionBehavior.Continue) {
                paneState.continueCapture()
            } else {
                paneState.resetCapture()
            }
            todayViewModel.resetCaptureState()
            coroutineScope.launch {
                if (!undoTargetSaved) {
                    snackbarHostState.showSnackbar(
                        "追加は保存しましたが、再起動後のUndo対象を保持できませんでした。空き容量を確認してください。",
                    )
                }
                val entityLabel = if (queued.kind == MobileCaptureKind.Task) "Task" else "Capture"
                showCreateUndoSnackbar(
                    snackbarHostState = snackbarHostState,
                    todayViewModel = todayViewModel,
                    captureDraftStore = captureDraftStore,
                    target = undoTarget,
                    message = "${entityLabel}を追加しました。Desktopへ自動送信します。",
                    duration = if (queued.completionBehavior == CaptureCompletionBehavior.Continue) {
                        SnackbarDuration.Indefinite
                    } else {
                        SnackbarDuration.Long
                    },
                )
            }
        }
    }
    LaunchedEffect(taskActionState) {
        when (taskActionState) {
            is TaskActionUiState.Queued -> {
                val queued = taskActionState as TaskActionUiState.Queued
                snackbarHostState.showSnackbar(
                    queued.message ?: if (queued.requiresSync) {
                        "Taskを更新しました。Desktopへ自動送信します。"
                    } else {
                        "未送信の変更を取り消しました。"
                    },
                )
                todayViewModel.resetTaskActionState()
            }
            is TaskActionUiState.Error -> {
                snackbarHostState.showSnackbar((taskActionState as TaskActionUiState.Error).message)
            }
            is TaskActionUiState.ConflictResolved -> {
                val resolved = taskActionState as TaskActionUiState.ConflictResolved
                snackbarHostState.showSnackbar(
                    if (resolved.keptLocal) "この端末の変更を再送します。" else "Desktopの状態を採用しました。",
                )
                todayViewModel.resetTaskActionState()
            }
            is TaskActionUiState.RejectedThemeDismissed -> {
                snackbarHostState.showSnackbar("送信できなかったTheme変更を取り下げました。")
                todayViewModel.resetTaskActionState()
            }
            TaskActionUiState.Idle, is TaskActionUiState.Saving -> Unit
        }
    }
    LaunchedEffect(proposalReviewState) {
        when (val state = proposalReviewState) {
            is ProposalReviewUiState.Applied -> {
                snackbarHostState.showSnackbar(
                    if (state.decision == "accept") "Proposalを承認しました。" else "Proposalを却下しました。",
                )
                todayViewModel.resetProposalReviewState()
            }
            is ProposalReviewUiState.Error -> {
                snackbarHostState.showSnackbar(state.message)
                todayViewModel.resetProposalReviewState()
            }
            ProposalReviewUiState.Idle, is ProposalReviewUiState.Reviewing -> Unit
        }
    }
    LaunchedEffect(humanReviewState) {
        when (val state = humanReviewState) {
            is HumanReviewUiState.Applied -> {
                snackbarHostState.showSnackbar(
                    if (state.action == "accept") "Work Receiptを承認してTaskを完了しました。" else "AIへ返信しました。",
                )
                todayViewModel.resetHumanReviewState()
            }
            is HumanReviewUiState.Conflict -> {
                snackbarHostState.showSnackbar(state.message)
                todayViewModel.resetHumanReviewState()
            }
            is HumanReviewUiState.Rejected -> {
                snackbarHostState.showSnackbar(state.message)
                todayViewModel.resetHumanReviewState()
            }
            is HumanReviewUiState.Unavailable -> {
                snackbarHostState.showSnackbar(state.message)
                todayViewModel.resetHumanReviewState()
            }
            HumanReviewUiState.Idle, is HumanReviewUiState.Reviewing -> Unit
        }
    }

    val syncState = syncSummary(uiState, pendingCount, conflictCount, pendingCaptures.size, recoveredInputs.size)
    val selectSection: (AppSection) -> Unit = { section ->
        paneState.selectSection(section)
        coroutineScope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.List) }
    }
    val openCompose: () -> Unit = {
        paneState.openCapture(
            source = MobileCaptureSource.AndroidApp,
            requestInputFocus = true,
            replaceDraft = false,
        )
        speechState = ShortSpeechUiState.Idle(speechRecognizer.availableMode())
    }
    val openVoiceCompose: () -> Unit = {
        paneState.openVoiceCapture()
        speechState = ShortSpeechUiState.Idle(speechRecognizer.availableMode())
    }
    val sectionBadge: @Composable (AppSection) -> Unit = { section ->
        // あなたの返事を待つ数。Desktopのbadgeと同じ意味で、新着だけの時は点で知らせる。
        val needsYou = attentionCounts?.needsYou ?: 0
        if (section == AppSection.Feed) {
            when {
                needsYou > 0 -> Badge(Modifier.testTag("ai-tab-badge").semantics { contentDescription = "対応待ち${needsYou}件" }) {
                    Text(if (needsYou > 99) "99+" else needsYou.toString())
                }
                attentionNewArrivals.isNotEmpty() || (aiUnseen && !onAiSection) ->
                    Badge(Modifier.testTag("ai-tab-badge"))
            }
        }
    }
    val requestNotifications: (() -> Unit)? = if (android.os.Build.VERSION.SDK_INT >= 33) {
        {
            if (notificationPermissionDenied) {
                context.startActivity(
                    Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                        putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
                    },
                )
            } else {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    } else {
        null
    }

    val recordWorkLog: ((MobileTask) -> Unit)? = if (todayViewModel.workLogRepository != null) {
        { task -> workLogTaskId = task.id; workLogRecordId = null; workLogOpen = true }
    } else {
        null
    }
    val toggleFeedNotifications: () -> Unit = {
        val next = !attentionNotificationsEnabled
        attentionNotificationsEnabled = next
        attentionNotificationStore.setEnabled(next)
        // OS通知を出すには権限が要る。有効にした時点で一度だけ求める。
        if (next && !notificationsEnabled && android.os.Build.VERSION.SDK_INT >= 33) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (paneState.activeSection == AppSection.Today) {
                        // Todayの見出しは1行に集約する（Desktopと同じ「今日やること」と日付）。
                        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("今日やること")
                            Text(
                                LocalDate.now().format(DateTimeFormatter.ofPattern("M月d日（E）", Locale.JAPANESE)),
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(bottom = 2.dp),
                            )
                        }
                    } else {
                        Text(sectionLabel(paneState.activeSection))
                    }
                },
                actions = {
                    // どのタブでも同じ3つ。探す・同期を確かめる・設定する。
                    if (todayViewModel.localSearchRepository != null) {
                        IconButton(onClick = { localSearchOpen = true }, modifier = Modifier.testTag("open-local-search")) {
                            Icon(painterResource(R.drawable.ic_tabler_search), contentDescription = "検索")
                        }
                    }
                    SyncStatusButton(syncState, onClick = { syncSheetOpen = true })
                    IconButton(onClick = { settingsOpen = true }, modifier = Modifier.testTag("open-settings")) {
                        Icon(painterResource(R.drawable.ic_tabler_settings), contentDescription = "設定")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        bottomBar = {
            if (!attentionInDetailPane) {
                AppNavigationBar(active = paneState.activeSection, onSelect = selectSection, badge = sectionBadge)
            }
        },
    ) { padding ->
        Row(Modifier.fillMaxSize().padding(padding)) {
        if (attentionInDetailPane) {
            AppNavigationRail(
                active = paneState.activeSection,
                onSelect = selectSection,
                badge = sectionBadge,
                header = { ComposeFab(onWrite = openCompose, onSpeak = openVoiceCompose, modifier = Modifier.padding(vertical = 8.dp), vertical = true) },
            )
        }
        Box(Modifier.weight(1f).fillMaxHeight()) {
        NavigableListDetailPaneScaffold(
            navigator = navigator,
            listPane = {
                AnimatedPane {
                    Box(modifier = Modifier.fillMaxSize()) {
                        val onTaskSelected: (String) -> Unit = { taskId ->
                            paneState.selectedTaskId = taskId
                            coroutineScope.launch {
                                navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, taskId)
                                focusManager.clearFocus(force = true)
                                keyboardController?.hide()
                            }
                        }
                        androidx.compose.animation.AnimatedContent(
                            targetState = paneState.activeSection,
                            transitionSpec = { sectionTransition(initialState, targetState) },
                            label = "app-section",
                        ) { section -> when (section) {
                            AppSection.Today -> TodayListPane(
                                uiState = uiState,
                                agentSessions = agentSessions,
                                agentSessionsUnavailable = agentSessionsUnavailable,
                                routines = routines,
                                routineSavingId = routineSavingId,
                                onRecordHabit = todayViewModel::recordHabit,
                                onRecordMaintenance = todayViewModel::recordMaintenance,
                                refreshing = refreshing,
                                themes = themes,
                                paneState = paneState,
                                onRetry = todayViewModel::load,
                                onRetryPairing = todayViewModel::retryPairing,
                                onPair = todayViewModel::pair,
                                onTaskSelected = onTaskSelected,
                                actionState = taskActionState,
                                onTaskStateAction = todayViewModel::toggleTaskState,
                                onChecklistUpdate = todayViewModel::updateTaskChecklist,
                                onTodayDateUpdate = todayViewModel::updateTaskTodayDate,
                                completionFeedback = completionFeedback,
                                justAddedIds = justAddedIds,
                                onRecordWorkLog = recordWorkLog,
                            )
                            AppSection.Tasks -> TasksListPane(
                                uiState = uiState,
                                tasks = allTasks,
                                themes = themes,
                                paneState = paneState,
                                onRetry = todayViewModel::load,
                                onRetryPairing = todayViewModel::retryPairing,
                                onPair = todayViewModel::pair,
                                onTaskSelected = onTaskSelected,
                                actionState = taskActionState,
                                onTaskStateAction = todayViewModel::toggleTaskState,
                                onChecklistUpdate = todayViewModel::updateTaskChecklist,
                                onTodayDateUpdate = todayViewModel::updateTaskTodayDate,
                                completionFeedback = completionFeedback,
                                justAddedIds = justAddedIds,
                                onRecordWorkLog = recordWorkLog,
                            )
                            AppSection.Feed -> FeedListPane(
                                uiState = uiState,
                                tasks = allTasks,
                                themes = themes,
                                proposals = taskWorkProposals,
                                feedPosts = feedPosts,
                                onToggleFeedReaction = todayViewModel::toggleFeedReaction,
                                onPostFeedReply = todayViewModel::postFeedReply,
                                paneState = paneState,
                                onRetry = todayViewModel::load,
                                onRetryPairing = todayViewModel::retryPairing,
                                onPair = todayViewModel::pair,
                                onTaskSelected = onTaskSelected,
                                attention = attentionRows,
                                attentionCounts = attentionCounts,
                                attentionFetchedAt = attentionFetchedAt,
                                attentionOnline = attentionOnline,
                                attentionRefreshing = attentionRefreshing,
                                agentReplyState = agentReplyState,
                                onRefreshAttention = todayViewModel::refreshAttention,
                                onReplyToAgent = todayViewModel::replyToAgent,
                                onResetAgentReply = todayViewModel::resetAgentReplyState,
                                attentionInDetailPane = attentionInDetailPane,
                                selectedAttentionId = paneState.selectedAttentionId,
                                attentionNewArrivals = attentionNewArrivals,
                                seenBefore = aiSeenBefore,
                                replyDictation = replyDictation,
                                onAttentionOpened = todayViewModel::clearAttentionNewArrivals,
                                onAttentionSelected = { row ->
                                    paneState.openAttention(row.attentionId)
                                    coroutineScope.launch {
                                        navigator.navigateTo(
                                            ListDetailPaneScaffoldRole.Detail,
                                            row.attentionId,
                                        )
                                        focusManager.clearFocus(force = true)
                                        keyboardController?.hide()
                                    }
                                },
                            )
                            AppSection.Records -> RecordsListPane(
                                repository = todayViewModel.recallRepository,
                                tasks = allTasks,
                                onTask = onTaskSelected,
                                onWorkLog = { id -> workLogRecordId = id; workLogTaskId = null; workLogOpen = true },
                                onCapture = { recallCapture = it },
                            )
                        }}
                        androidx.compose.animation.AnimatedVisibility(
                            visible = !attentionInDetailPane,
                            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                            enter = androidx.compose.animation.scaleIn(
                                androidx.compose.animation.core.spring(dampingRatio = 0.6f, stiffness = 500f),
                            ) + androidx.compose.animation.fadeIn(),
                            exit = androidx.compose.animation.scaleOut() + androidx.compose.animation.fadeOut(),
                        ) {
                            ComposeFab(onWrite = openCompose, onSpeak = openVoiceCompose)
                        }
                    }
                }
            },
            detailPane = {
                AnimatedPane {
                    val task = allTasks.firstOrNull { it.id == paneState.selectedTaskId }
                    val receiptId = task?.latestWorkReceipt?.id
                    LaunchedEffect(task?.id, receiptId) {
                        if (task != null && receiptId != null) {
                            todayViewModel.loadWorkReceipt(task.id, receiptId)
                        }
                    }
                    val navigateToList: () -> Unit = {
                        coroutineScope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.List) }
                    }
                    val selectedAttention = paneState.selectedAttentionId?.let { id ->
                        attentionRows.firstOrNull { it.attentionId == id }
                    }
                    // Desktopが返した一覧から消えた判断は、詳細に残さない。
                    LaunchedEffect(paneState.selectedAttentionId, attentionRows) {
                        if (paneState.selectedAttentionId != null && selectedAttention == null) {
                            paneState.clearAttentionReply()
                        }
                    }
                    // 正式に保存できたときだけ、回答と選択を閉じる。失敗時は入力を残す。
                    LaunchedEffect(agentReplyState) {
                        val applied = agentReplyState as? AgentReplyUiState.Applied
                        if (applied != null && selectedAttention?.attentionId == applied.attentionId) {
                            paneState.clearAttentionReply()
                        }
                    }
                    Column(Modifier.fillMaxSize()) {
                    if (selectedAttention != null && attentionInDetailPane) {
                        AttentionDetailPane(
                            row = selectedAttention,
                            body = paneState.attentionReplyBody,
                            onBodyChange = { paneState.attentionReplyBody = it.take(10_000) },
                            state = agentReplyState,
                            online = attentionOnline,
                            onSend = {
                                todayViewModel.replyToAgent(
                                    selectedAttention,
                                    null,
                                    paneState.attentionReplyBody,
                                )
                            },
                            onOpenTask = selectedAttention.taskId?.let { taskId ->
                                { paneState.selectedTaskId = taskId }
                            },
                            onBack = navigateToList,
                            dictation = replyDictation,
                        )
                    } else {
                    if (localSearchTaskReturn != null) TextButton(onClick = { localSearchOpen = true; localSearchTaskReturn = null },
                        modifier = Modifier.testTag("local-search-return")) { Text("検索へ戻る") }
                    Box(Modifier.weight(1f)) {
                    TodayDetailPane(
                        task = task,
                        onRecordWorkLog = { workLogTaskId = it.id; workLogOpen = true },
                        onReadRelatedDocuments = if (todayViewModel.relatedDocumentsRepository != null) ({ relatedTaskId = it.id }) else null,
                        onReadThemeContext = if (todayViewModel.themeContextRepository != null) ({ themeContextId = it }) else null,
                        actionState = taskActionState,
                        workReceiptDetailState = workReceiptDetailState,
                        taskWorkProposals = taskWorkProposals.filter { it.taskId == task?.id },
                        proposalReviewOnline = proposalReviewOnline,
                        proposalReviewState = proposalReviewState,
                        humanReviewOnline = humanReviewOnline,
                        humanReviewRequiresRePairing = humanReviewRequiresRePairing,
                        humanReviewState = humanReviewState,
                        aiReadyState = aiReadyState,
                        themes = themes,
                        themeCatalogState = themeCatalogState,
                        onStateAction = todayViewModel::toggleTaskState,
                        onTitleUpdate = todayViewModel::updateTaskTitle,
                        onTodayDateUpdate = todayViewModel::updateTaskTodayDate,
                        onThemeUpdate = todayViewModel::updateTaskTheme,
                        onScheduleUpdate = todayViewModel::updateTaskSchedule,
                        onChecklistUpdate = todayViewModel::updateTaskChecklist,
                        onRejectedThemeDiscard = todayViewModel::discardRejectedThemeUpdate,
                        onConflictResolution = todayViewModel::resolveConflict,
                        onWorkReceiptRetry = { selectedTask, selectedReceiptId ->
                            todayViewModel.loadWorkReceipt(selectedTask.id, selectedReceiptId, force = true)
                        },
                        onProposalDecision = todayViewModel::reviewTaskWorkProposal,
                        onHumanReview = todayViewModel::reviewTaskWork,
                        onTaskAiReady = todayViewModel::setTaskAiReady,
                        onNavigateBack = if (task != null) navigateToList else null,
                        completionFeedbackEventId = completionFeedback
                            ?.takeIf { it.taskId == task?.id }
                            ?.eventId,
                    )
                    }
                    }
                    }
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
            SnackbarHost(snackbarHostState, modifier = Modifier
                .align(Alignment.TopCenter)
                .testTag("top-snackbar-host"))
        }
        }
    }

    if (syncSheetOpen) {
        SyncStatusSheet(
            summary = syncState,
            refreshing = refreshing,
            onSyncNow = todayViewModel::load,
            onRepair = { syncSheetOpen = false; todayViewModel.retryPairing() },
            onOpenUnsentCaptures = { syncSheetOpen = false; pendingCapturesOpen = true },
            onOpenRecoveredInputs = { syncSheetOpen = false; recoveryOpen = true },
            onDismiss = { syncSheetOpen = false },
        )
    }
    if (settingsOpen) {
        AppSettingsSheet(
            notificationsAllowed = notificationsEnabled,
            notificationPermissionDenied = notificationPermissionDenied,
            onRequestNotifications = requestNotifications,
            feedNotificationsEnabled = attentionNotificationsEnabled,
            onToggleFeedNotifications = toggleFeedNotifications,
            onOpenDirectAiSettings = { settingsOpen = false; directAiSettingsOpen = true },
            onRepair = { settingsOpen = false; todayViewModel.retryPairing() },
            onDismiss = { settingsOpen = false },
        )
    }

    if (pendingCapturesOpen) {
        MobilePendingCaptureDialog(
            entries = pendingCaptures,
            onRetry = todayViewModel::retryPendingCapture,
            onDismiss = { pendingCapturesOpen = false },
        )
    }

    if (recoveryOpen) {
        val canRestore = paneState.captureDraft.text.isEmpty() &&
            paneState.captureDraft.originalText.isNullOrEmpty() &&
            captureState !is CaptureUiState.Saving && !paneState.captureOpen
        MobileCaptureRecoveryDialog(
            entries = recoveredInputs,
            canRestore = canRestore,
            onRestore = { entry ->
                if (!canRestore || paneState.captureDraft.text.isNotEmpty() ||
                    !paneState.captureDraft.originalText.isNullOrEmpty()
                ) {
                    false
                } else {
                    val restored = captureDraftStore.restoreRecoveredInput(entry.id)
                    if (restored != null) {
                        paneState.captureDraft = restored.draft
                        paneState.captureOpen = true
                    }
                    restored != null
                }
            },
            onDelete = { id ->
                captureDraftStore.deleteRecoveredInput(id).also { deleted ->
                    if (deleted) recoveredInputs = captureDraftStore.recoveredInputs()
                }
            },
            onDismiss = { recoveryOpen = false },
        )
    }

    themeContextId?.let { themeId ->
        todayViewModel.themeContextRepository?.let { repository ->
            MobileThemeContextSheet(repository, themeId, onDismiss = { themeContextId = null })
        }
    }
    androidx.activity.compose.BackHandler(localSearchTaskReturn != null && !localSearchOpen && !workLogOpen &&
        relatedTaskId == null && themeContextId == null && !paneState.captureOpen) {
        localSearchOpen = true; localSearchTaskReturn = null
    }
    if (localSearchOpen && !workLogOpen && recallCapture == null && relatedTaskId == null) {
        todayViewModel.localSearchRepository?.let { repository ->
            localSearchSavedState.SaveableStateProvider("local-search") {
                MobileLocalSearchSheet(repository, themes, initialQuery = paneState.taskSearch, initialThemeId = paneState.taskThemeId,
                    notice = localSearchNotice, onDismiss = { localSearchOpen = false; localSearchNotice = null }, onOpen = { hit ->
                        localSearchNotice = null
                        when {
                            hit.kind == MobileLocalSearchKind.Task -> {
                                localSearchOpen = false; localSearchTaskReturn = hit.sourceId
                                paneState.selectedTaskId = hit.sourceId
                                coroutineScope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, hit.sourceId) }
                            }
                            hit.kind == MobileLocalSearchKind.WorkLog -> { workLogRecordId = hit.sourceId; workLogTaskId = null; workLogOpen = true }
                            hit.relatedTaskId != null -> { relatedTaskId = hit.relatedTaskId; searchDocumentType = hit.kind.sourceType; searchDocumentId = hit.sourceId }
                            hit.kind == MobileLocalSearchKind.Capture -> coroutineScope.launch {
                                val capture = repository.localSearchCapture(hit.sourceId)
                                if (capture == null) localSearchNotice = "原文が見つからないか、閲覧権限が変わりました。検索結果を確認してください。"
                                else recallCapture = capture
                            }
                        }
                    })
            }
        }
    }
    relatedTaskId?.let { taskId ->
        todayViewModel.relatedDocumentsRepository?.let { repository ->
            MobileRelatedDocumentsSheet(repository, taskId, onDismiss = { relatedTaskId = null; searchDocumentType = null; searchDocumentId = null },
                initialDocument = searchDocumentId?.let { id -> searchDocumentType?.let { it to id } },
                dismissLabel = if (localSearchOpen) "検索へ戻る" else "Taskへ戻る")
        }
    }
    recallCapture?.let { capture ->
        val current = pendingCaptures.firstOrNull { it.commandId == capture.commandId }
            ?: capture.copy(canRetry = false, status = "端末に保存した原文です。Desktop受理後も保持しています。")
        MobilePendingCaptureDialog(listOf(current), onRetry = { todayViewModel.retryPendingCapture(it) },
            onDismiss = { recallCapture = null }, initialSelectedId = capture.commandId, title = "Captureの原文")
    }
    if (workLogOpen) {
        todayViewModel.workLogRepository?.let { repository ->
            MobileWorkLogSheet(repository, themes, allTasks, allTasks.firstOrNull { it.id == workLogTaskId }, initialRecordId = workLogRecordId,
                onDismiss = { workLogOpen = false; workLogRecordId = null })
        }
    }
    if (directAiSettingsOpen) {
        val directStore = remember(context) { DirectCaptureSettingsStore(context.applicationContext) }
        DirectAiSettingsSheet(directStore, onChanged = {}, onDismiss = { directAiSettingsOpen = false })
    }
    if (paneState.captureOpen) {
        CaptureTaskSheet(
            savedEventKey = captureSavedKey,
            draft = paneState.captureDraft,
            state = captureState,
            speechState = speechState,
            themes = themes,
            themeCatalogState = themeCatalogState,
            onDraftChanged = { paneState.captureDraft = paneState.captureDraft.withText(it) },
            onThemeSelected = { themeId ->
                paneState.captureDraft = paneState.captureDraft.withThemeId(themeId)
            },
            onKindSelected = { kind ->
                paneState.captureDraft = paneState.captureDraft.withKind(kind)
            },
            onOrganize = todayViewModel::organizeCapture,
            onOrganizationChanged = { proposal ->
                val current = paneState.captureDraft
                paneState.captureDraft = current.withEditedOrganizations(proposal)
            },
            onOrganizationDiscarded = {
                val current = paneState.captureDraft
                paneState.captureDraft = current.withoutOrganization()
            },
            requestInputFocus = paneState.captureInputFocusRequested,
            onInputFocusHandled = paneState::consumeInputFocusRequest,
            onSubmit = { behavior -> todayViewModel.createCapture(paneState.captureDraft, behavior) },
            onTakePhoto = {
                if (paneState.captureDraft.photos.size < CAPTURE_PHOTO_MAX_COUNT) {
                    runCatching {
                        val fileName = photoStore.createPhotoFile()
                        pendingPhotoName = fileName
                        takePictureLauncher.launch(photoStore.photoUri(fileName))
                    }.onFailure {
                        pendingPhotoName = null
                        coroutineScope.launch {
                            snackbarHostState.showSnackbar("カメラを起動できませんでした。")
                        }
                    }
                }
            },
            onRemovePhoto = { fileName ->
                paneState.captureDraft = paneState.captureDraft.withoutPhoto(fileName)
                photoStore.deletePhotos(listOf(fileName))
            },
            loadPhotoThumbnail = photoStore::loadThumbnail,
            onSwitchToWorkLog = if (todayViewModel.workLogRepository != null) {
                {
                    if (captureState !is CaptureUiState.Saving) {
                        speechRecognizer.cancel()
                        speechState = ShortSpeechUiState.Idle(speechRecognizer.availableMode())
                        paneState.captureOpen = false
                        todayViewModel.resetCaptureState()
                        workLogTaskId = null
                        workLogRecordId = null
                        workLogOpen = true
                    }
                }
            } else {
                null
            },
            onStartVoice = { requestSpeechRecognition(false) },
            onStopVoice = speechRecognizer::stop,
            onDismiss = {
                if (captureState !is CaptureUiState.Saving) {
                    speechRecognizer.cancel()
                    speechState = ShortSpeechUiState.Idle(speechRecognizer.availableMode())
                    paneState.captureOpen = false
                    todayViewModel.resetCaptureState()
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CaptureTaskSheet(
    draft: MobileCaptureDraft,
    state: CaptureUiState,
    speechState: ShortSpeechUiState,
    themes: List<MobileTheme>,
    themeCatalogState: MobileThemeCatalogState,
    onDraftChanged: (String) -> Unit,
    onThemeSelected: (String?) -> Unit,
    onKindSelected: (MobileCaptureKind) -> Unit,
    onOrganize: (suspend (MobileCaptureDraft) -> List<MobileCaptureOrganization>)? = null,
    onOrganizationChanged: (List<MobileCaptureOrganization>) -> Unit = {},
    onOrganizationDiscarded: () -> Unit = {},
    requestInputFocus: Boolean = false,
    onInputFocusHandled: () -> Unit = {},
    onSubmit: (CaptureCompletionBehavior) -> Unit,
    onTakePhoto: () -> Unit = {},
    onRemovePhoto: (String) -> Unit = {},
    loadPhotoThumbnail: (String) -> androidx.compose.ui.graphics.ImageBitmap? = { null },
    onStartVoice: () -> Unit,
    onStopVoice: () -> Unit,
    onDismiss: () -> Unit,
    /** 端末への保存が済んだ合図。続けて追加する時も、保存できたことを見せる。 */
    savedEventKey: Any? = null,
    /** 「やったこと」へ切り替える。入力中の文字は下書きに残る。 */
    onSwitchToWorkLog: (() -> Unit)? = null,
    bottomContentInsets: WindowInsets = WindowInsets.safeDrawing
        .union(WindowInsets.ime)
        .only(WindowInsetsSides.Bottom),
) {
    val focusRequester = remember(draft.draftId) { FocusRequester() }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val directStore = remember(context) { DirectCaptureSettingsStore(context.applicationContext) }
    var organizeJob by remember { mutableStateOf<Job?>(null) }
    var organizeRequest by remember { mutableIntStateOf(0) }
    var organizeBusy by remember { mutableStateOf(false) }
    var organizeError by remember(draft.draftId) { mutableStateOf<String?>(null) }
    val currentDraft by rememberUpdatedState(draft)
    // 本人が「メモ」を選んだか。長文の自動切り替えとは分けて持つ。
    var memoMode by rememberSaveable(draft.draftId) { mutableStateOf(false) }
    DisposableEffect(Unit) {
        onDispose {
            organizeRequest++
            organizeJob?.cancel()
        }
    }
    fun startOrganize() {
        val organize = onOrganize ?: return
        val requested = draft
        if ((requested.originalText ?: requested.text).isBlank()) return
        val request = ++organizeRequest
        organizeJob?.cancel()
        organizeError = null
        organizeBusy = true
        organizeJob = scope.launch {
            try {
                val proposals = organize(requested)
                require(proposals.isNotEmpty() && proposals.size <= 8)
                proposals.forEach(MobileCaptureOrganization::validate)
                if (request == organizeRequest && currentDraft == requested) onOrganizationChanged(proposals)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                if (request == organizeRequest && currentDraft == requested) {
                    organizeError = if (directStore.settings().enabled) {
                        failure.message ?: DIRECT_CAPTURE_FAILURE
                    } else {
                        "AI整理を利用できません。PCがオフの場合は設定（右上の歯車）の「PCなし整理」から直接整理できます。通常の追加も使えます。"
                    }
                }
            } finally {
                if (request == organizeRequest) {
                    organizeJob = null
                    organizeBusy = false
                }
            }
        }
    }
    fun submit(behavior: CaptureCompletionBehavior) {
        // 500文字を超える入力は、原文を保つためメモ(Capture)として保存する。
        val nextKind = if (memoMode || draft.text.length > MOBILE_TASK_TITLE_MAX_LENGTH) {
            MobileCaptureKind.Capture
        } else {
            MobileCaptureKind.Task
        }
        if (draft.kind != nextKind) onKindSelected(nextKind)
        onSubmit(behavior)
    }
    // 音声を確定した後はAI整理を基本にする。
    LaunchedEffect(speechState, onOrganize) {
        if (onOrganize != null && speechState is ShortSpeechUiState.Result && draft.organization == null && !organizeBusy) {
            startOrganize()
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        contentWindowInsets = {
            WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top)
        },
    ) {
        val keyboardController = LocalSoftwareKeyboardController.current
        val speechBusy = speechState is ShortSpeechUiState.Listening ||
            speechState is ShortSpeechUiState.Partial || speechState is ShortSpeechUiState.Processing
        val speechActive = speechState !is ShortSpeechUiState.Idle
        val overLimit = draft.text.length > MOBILE_CAPTURE_TEXT_MAX_LENGTH
        val taskOverLimit = draft.text.length > MOBILE_TASK_TITLE_MAX_LENGTH
        val included = draft.allOrganizations().filterNot { it.excluded }
        val organizationValid = draft.organization == null ||
            (included.isNotEmpty() && included.all { runCatching { it.validate() }.isSuccess })
        val canSubmit = state !is CaptureUiState.Saving && !speechBusy && !organizeBusy &&
            (draft.organization != null || (draft.text.isNotBlank() && !overLimit)) && organizationValid
        LaunchedEffect(draft.draftId, requestInputFocus, sheetState.isVisible) {
            // Request focus in the sheet's window after its opening transition.
            if (requestInputFocus && sheetState.isVisible && draft.organization == null) {
                focusRequester.requestFocus()
                keyboardController?.show()
                onInputFocusHandled()
            }
        }
        val sheetEnabled = state !is CaptureUiState.Saving && !speechBusy
        val body: @Composable () -> Unit = {
            // 何を残すかを最初に選ぶ。Task・メモ・やったことの入口をこのシートへまとめる。
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                androidx.compose.material3.SingleChoiceSegmentedButtonRow(modifier = Modifier.weight(1f)) {
                    val modes = buildList {
                        add(Triple("Task", "capture-mode-task", !memoMode))
                        add(Triple("メモ", "capture-mode-memo", memoMode))
                        if (onSwitchToWorkLog != null) add(Triple("やったこと", "capture-mode-work-log", false))
                    }
                    modes.forEachIndexed { index, (label, tag, selected) ->
                        SegmentedButton(
                            selected = selected,
                            onClick = {
                                when (tag) {
                                    "capture-mode-task" -> memoMode = false
                                    "capture-mode-memo" -> memoMode = true
                                    else -> onSwitchToWorkLog?.invoke()
                                }
                            },
                            enabled = sheetEnabled,
                            shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(index, modes.size),
                            icon = {},
                            label = { Text(label, maxLines = 1) },
                            modifier = Modifier.testTag(tag),
                        )
                    }
                }
                SavedStamp(savedEventKey, modifier = Modifier.testTag("capture-saved-stamp"))
            }
            if (draft.organization == null) {
                // 枠のない入力欄。キーボードで狭くなる画面では、文字そのものを主役にする。
                androidx.compose.material3.TextField(
                    value = draft.text,
                    onValueChange = onDraftChanged,
                    label = { Text(if (memoMode) "メモ" else "Task名") },
                    placeholder = { Text(if (memoMode) "思いついたこと、あとで整理したいこと" else "例: 帰りに牛乳を買う") },
                    supportingText = if (overLimit) {
                        { Text("${draft.text.length} / ${MOBILE_CAPTURE_TEXT_MAX_LENGTH}文字。全文を保持しています。編集するか、全文をコピーして回収できます。") }
                    } else if (taskOverLimit && !memoMode) {
                        { Text("${draft.text.length}文字。長文はメモとして保存します。") }
                    } else if (state is CaptureUiState.Error) {
                        { Text(state.message) }
                    } else if (draft.text.length >= MOBILE_TASK_TITLE_MAX_LENGTH * 4 / 5) {
                        { Text("${draft.text.length} / ${MOBILE_TASK_TITLE_MAX_LENGTH}文字") }
                    } else {
                        null
                    },
                    isError = state is CaptureUiState.Error || overLimit,
                    enabled = sheetEnabled,
                    minLines = 1,
                    maxLines = 6,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = {
                        if (canSubmit) submit(CaptureCompletionBehavior.Close)
                    }),
                    textStyle = MaterialTheme.typography.bodyLarge,
                    colors = androidx.compose.material3.TextFieldDefaults.colors(
                        focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        errorContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focusRequester)
                        .testTag("capture-text-input"),
                )
                if (draft.text.isNotEmpty() && overLimit) {
                    CaptureCopyButton(draft.text)
                }
                CaptureThemePicker(
                    themeId = draft.projectId,
                    themes = themes,
                    catalogState = themeCatalogState,
                    enabled = sheetEnabled,
                    onThemeSelected = { themeId ->
                        onThemeSelected(themeId)
                        if (draft.source != MobileCaptureSource.AndroidSpeech) {
                            focusRequester.requestFocus()
                            keyboardController?.show()
                        }
                    },
                )
                if (speechActive) {
                    val speechStatusScroll = rememberScrollState()
                    LaunchedEffect(speechState, speechStatusScroll.maxValue) {
                        speechStatusScroll.scrollTo(speechStatusScroll.maxValue)
                    }
                    Text(
                        speechStatusText(speechState),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (speechState is ShortSpeechUiState.Error) MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.fillMaxWidth().height(120.dp)
                            .testTag("capture-speech-status").verticalScroll(speechStatusScroll),
                    )
                }
                CapturePhotoStrip(
                    photos = draft.photos,
                    enabled = sheetEnabled,
                    onRemovePhoto = onRemovePhoto,
                    loadThumbnail = loadPhotoThumbnail,
                )
                if (organizeBusy) {
                    Text("整理中…", style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.testTag("capture-organizing"))
                }
                organizeError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("capture-organization-error"))
                }
            } else {
                CaptureOrganizationEditor(
                    draft = draft,
                    themes = themes,
                    themeCatalogState = themeCatalogState,
                    enabled = sheetEnabled,
                    onChange = onOrganizationChanged,
                    onRestoreOriginal = onOrganizationDiscarded,
                )
            }
            if (state is CaptureUiState.Error && draft.organization != null) {
                Text(state.message, color = MaterialTheme.colorScheme.error)
            }
        }
        // キーボードのすぐ上に固定する道具と確定。親指の届く1段に集める。
        val submitRow: @Composable () -> Unit = {
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("capture-submit-row"),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (draft.organization == null) {
                    VoiceToolButton(
                        speechState = speechState,
                        hasText = draft.text.isNotBlank(),
                        enabled = state !is CaptureUiState.Saving && speechState !is ShortSpeechUiState.Processing,
                        onClick = {
                            keyboardController?.hide()
                            if (speechBusy) onStopVoice() else onStartVoice()
                        },
                        modifier = Modifier.testTag("capture-voice-action"),
                    )
                    CapturePhotoButton(
                        photoCount = draft.photos.size,
                        enabled = sheetEnabled,
                        onTakePhoto = onTakePhoto,
                    )
                    if (onOrganize != null) {
                        IconButton(
                            onClick = {
                                keyboardController?.hide()
                                if (organizeBusy) {
                                    organizeRequest++
                                    organizeJob?.cancel()
                                    organizeJob = null
                                    organizeBusy = false
                                } else {
                                    startOrganize()
                                }
                            },
                            enabled = sheetEnabled && (draft.originalText ?: draft.text).isNotBlank(),
                            modifier = Modifier.size(48.dp).testTag("capture-organize"),
                        ) {
                            if (organizeBusy) {
                                CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(painterResource(R.drawable.ic_tabler_sparkles), contentDescription = "AIで分ける")
                            }
                        }
                    }
                }
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = { submit(CaptureCompletionBehavior.Continue) },
                    enabled = canSubmit,
                    modifier = Modifier.testTag("capture-submit-continue"),
                ) {
                    Text("追加して次へ", maxLines = 1)
                }
                Button(
                    onClick = { submit(CaptureCompletionBehavior.Close) },
                    enabled = canSubmit,
                    contentPadding = PaddingValues(start = 14.dp, end = 16.dp),
                    modifier = Modifier.heightIn(min = 48.dp).testTag("capture-submit-close"),
                ) {
                    Icon(painterResource(R.drawable.ic_tabler_send), contentDescription = null, modifier = Modifier.size(18.dp))
                    Text(
                        if (state is CaptureUiState.Saving) "保存中" else "追加",
                        modifier = Modifier.padding(start = 6.dp),
                        maxLines = 1,
                    )
                }
            }
        }
        val bottomInset: @Composable () -> Unit = {
            Spacer(
                modifier = Modifier
                    .fillMaxWidth()
                    .windowInsetsBottomHeight(bottomContentInsets)
                    .testTag("capture-bottom-inset-spacer"),
            )
        }
        if (draft.organization == null) {
            // 本文は縮められる領域、道具と確定は常にキーボードの直上。
            Column(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .fillMaxWidth()
                        .testTag("capture-sheet-content")
                        .verticalScroll(rememberScrollState())
                        .padding(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    body()
                }
                androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                    submitRow()
                    bottomInset()
                }
            }
        } else {
            // 整理案の編集中は確定操作を常に押せるよう下部に固定する。
            Column(modifier = Modifier.fillMaxWidth().fillMaxHeight(0.94f)) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .testTag("capture-sheet-content")
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    body()
                }
                Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                        submitRow()
                        bottomInset()
                    }
                }
            }
        }
    }
}

@Composable
internal fun CaptureThemePicker(
    themeId: String?,
    themes: List<MobileTheme>,
    catalogState: MobileThemeCatalogState,
    enabled: Boolean,
    onThemeSelected: (String?) -> Unit,
) {
    val selectedTheme = themes.firstOrNull { it.id == themeId }
    val catalogAllowsSelection = catalogState is MobileThemeCatalogState.Available ||
        catalogState is MobileThemeCatalogState.Stale ||
        (catalogState is MobileThemeCatalogState.Loading && themes.isNotEmpty())
    val themeChipsEnabled = enabled && catalogAllowsSelection
    val helperText = when (catalogState) {
        is MobileThemeCatalogState.Loading -> {
            if (themes.isEmpty()) "Themeを読み込み中" else "保存済みThemeを表示しながら更新中"
        }
        is MobileThemeCatalogState.Available -> if (themes.isEmpty()) "利用できるThemeがありません" else null
        is MobileThemeCatalogState.Stale -> "Theme一覧を更新できません。保存済みThemeを表示中"
        is MobileThemeCatalogState.Unsupported -> "Desktopを更新するとThemeを選べます"
        is MobileThemeCatalogState.Error ->
            "Theme一覧を取得できません。接続後に再試行してください。Themeなしで追加できます。"
    }
    val themeListState = rememberLazyListState()
    LaunchedEffect(themeId, themes) {
        val selectedIndex = themes.indexOfFirst { it.id == themeId }
        if (selectedIndex >= 0) {
            val listIndex = selectedIndex + 1
            val selectionVisible = themeListState.layoutInfo.visibleItemsInfo.any { it.index == listIndex }
            if (!selectionVisible) themeListState.scrollToItem(listIndex)
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LazyRow(
            state = themeListState,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("capture-theme-options"),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(end = 20.dp),
        ) {
            val noThemeSelected = themeId == null
            item(key = "theme-none") {
                FilterChip(
                    selected = noThemeSelected,
                    onClick = { onThemeSelected(null) },
                    label = { Text("Themeなし") },
                    enabled = enabled,
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .testTag("capture-theme-none-option")
                        .semantics { selected = noThemeSelected },
                )
            }
            if (themeId != null && selectedTheme == null) {
                item(key = "theme-selected-unavailable") {
                    FilterChip(
                        selected = true,
                        onClick = { onThemeSelected(themeId) },
                        label = { Text("選択済みTheme") },
                        enabled = enabled,
                        modifier = Modifier
                            .heightIn(min = 44.dp)
                            .testTag("capture-theme-unavailable-option")
                            .semantics { selected = true },
                    )
                }
            }
            items(themes, key = { it.id }) { theme ->
                val isSelected = theme.id == themeId
                FilterChip(
                    selected = isSelected,
                    onClick = { onThemeSelected(theme.id) },
                    label = {
                        Text(
                            theme.title,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    enabled = themeChipsEnabled,
                    leadingIcon = { ThemeColorDot(theme) },
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .widthIn(max = 220.dp)
                        .testTag("capture-theme-option-${theme.id}")
                        .semantics { selected = isSelected },
                )
            }
        }
        if (helperText != null) {
            Text(
                helperText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun captureSourceLabel(source: MobileCaptureSource): String = when (source) {
    MobileCaptureSource.AndroidApp -> "Tasken"
    MobileCaptureSource.Widget -> "Widget"
    MobileCaptureSource.AppShortcut -> "App Shortcut"
    MobileCaptureSource.ShareTarget -> "Share Target"
    MobileCaptureSource.AndroidSpeech -> "Android音声入力"
}

private fun speechStatusText(state: ShortSpeechUiState): String = when (state) {
    is ShortSpeechUiState.Idle -> speechPrivacyDescription(state.availableMode)
    is ShortSpeechUiState.Listening ->
        "聞いています… 話し終えたらもう一度押してください。 ${speechModeLabel(state.mode)}"
    is ShortSpeechUiState.Partial -> "認識中: ${state.text}（もう一度押すと確定）"
    is ShortSpeechUiState.Processing -> "文字にしています… ${speechModeLabel(state.mode)}"
    is ShortSpeechUiState.Result ->
        state.result.warning ?: "${speechModeLabel(state.result.mode)}の結果です。内容を確認・修正してから追加してください。"
    is ShortSpeechUiState.Error -> state.message
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TodayListPane(
    uiState: TodayUiState,
    refreshing: Boolean = false,
    themes: List<MobileTheme>,
    paneState: TodayPaneState,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
    onPair: (String, String) -> Unit,
    onTaskSelected: (String) -> Unit,
    actionState: TaskActionUiState,
    onTaskStateAction: (MobileTask) -> Unit,
    onChecklistUpdate: (MobileTask, List<MobileChecklistItem>) -> Unit,
    onTodayDateUpdate: ((MobileTask, LocalDate?) -> Unit)? = null,
    completionFeedback: TaskCompletionFeedback? = null,
    justAddedIds: Set<String> = emptySet(),
    agentSessions: List<MobileAgentSessionDto> = emptyList(),
    agentSessionsUnavailable: Boolean = false,
    onRecordWorkLog: ((MobileTask) -> Unit)? = null,
    routines: MobileRoutinesDataDto? = null,
    routineSavingId: String? = null,
    onRecordHabit: (MobileRoutineHabitDto) -> Unit = {},
    onRecordMaintenance: (MobileRoutineMaintenanceDto) -> Unit = {},
) {
    val tasks = when (uiState) {
        is TodayUiState.Success -> uiState.tasks
        is TodayUiState.Cached -> uiState.tasks
        TodayUiState.Empty -> emptyList()
        else -> null
    }
    if (tasks != null) {
        val cached = uiState as? TodayUiState.Cached
        val generatedAt = when (uiState) {
            is TodayUiState.Success -> uiState.generatedAt
            is TodayUiState.Cached -> uiState.generatedAt
            else -> ""
        }
        Column(modifier = Modifier.fillMaxSize()) {
            TodayProgressHeader(
                tasks = tasks,
                cached = cached,
                refreshing = refreshing,
                generatedAt = generatedAt,
                onRetry = onRetry,
                onRetryPairing = onRetryPairing,
                collapsed = tasks.isNotEmpty() && (paneState.listScrollIndex > 0 || paneState.listScrollOffset > 0),
            )
            val hintContext = LocalContext.current
            val hintStore = remember(hintContext) { UiHintStore(hintContext) }
            var gestureHintVisible by remember(hintStore) { mutableStateOf(!hintStore.shown(UiHintStore.TODAY_GESTURES)) }
            androidx.compose.animation.AnimatedVisibility(visible = gestureHintVisible && tasks.any { it.state != "done" }) {
                GestureHint(
                    text = "右へ払うと完了、左へ払うと明日へ。長押しでメニューを開けます",
                    onDismiss = {
                        gestureHintVisible = false
                        hintStore.markShown(UiHintStore.TODAY_GESTURES)
                    },
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                )
            }
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = if (cached?.recovery == TodayUiState.CachedRecovery.RePair) onRetryPairing else onRetry,
                modifier = Modifier.weight(1f).testTag("today-pull-refresh"),
            ) {
                if (tasks.isEmpty() && agentSessions.isEmpty() && !agentSessionsUnavailable && routines?.isEmpty != false) {
                    CenteredState { Text("今日のタスクはありません") }
                } else {
                    TodayTaskList(
                        tasks,
                        paneState,
                        onTaskSelected,
                        themes = themes,
                        actionState = actionState,
                        onTaskStateAction = onTaskStateAction,
                        onChecklistUpdate = onChecklistUpdate,
                        onTodayDateUpdate = onTodayDateUpdate,
                        completionFeedback = completionFeedback,
                        justAddedIds = justAddedIds,
                        agentSessions = agentSessions,
                        agentSessionsUnavailable = agentSessionsUnavailable,
                        onAgentSessionRetry = onRetry,
                        onRecordWorkLog = onRecordWorkLog,
                        routines = routines,
                        routineSavingId = routineSavingId,
                        onRecordHabit = onRecordHabit,
                        onRecordMaintenance = onRecordMaintenance,
                    )
                }
            }
        }
        return
    }
    when (uiState) {
        TodayUiState.Loading -> CenteredState {
            CircularProgressIndicator()
            Text("Todayを読み込んでいます")
        }
        is TodayUiState.PairingRequired -> PairingPane(uiState, onPair)
        is TodayUiState.Error -> GatewayErrorState(uiState, onRetry, onRetryPairing)
        TodayUiState.Empty, is TodayUiState.Cached, is TodayUiState.Success -> Unit
    }
}

@Composable
private fun CachedTaskBanner(
    state: TodayUiState.Cached,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
    refreshing: Boolean = false,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text("端末に保存済み", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                Text(state.message, style = MaterialTheme.typography.bodySmall)
                Text(
                    state.generatedAt.takeIf { it.isNotBlank() }
                        ?.let { "最終同期 ${formatLocalTimestamp(it)}" }
                        ?: "同期実績なし",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(
                onClick = if (state.recovery == TodayUiState.CachedRecovery.RePair) onRetryPairing else onRetry,
                enabled = !refreshing,
            ) {
                Text(
                    when {
                        refreshing -> "確認中"
                        state.recovery == TodayUiState.CachedRecovery.RePair -> "再接続"
                        else -> "再読み込み"
                    },
                )
            }
        }
    }
}

internal enum class AiInboxSection { InProgress, NeedsReview, Blocked, RecentlyAccepted }

internal fun aiInboxSectionLabel(section: AiInboxSection): String = when (section) {
    AiInboxSection.InProgress -> "作業中"
    AiInboxSection.NeedsReview -> "確認待ち"
    AiInboxSection.Blocked -> "停止中"
    AiInboxSection.RecentlyAccepted -> "最近完了"
}

internal fun aiInboxSection(workState: String?): AiInboxSection? = when (workState) {
    "in_progress", "working", "delegated" -> AiInboxSection.InProgress
    "needs_human_review", "reported_done", "needs_review" -> AiInboxSection.NeedsReview
    "blocked", "failed" -> AiInboxSection.Blocked
    "accepted", "completed" -> AiInboxSection.RecentlyAccepted
    else -> null
}

internal fun filterAiInboxTasks(tasks: List<MobileTask>): List<Pair<AiInboxSection, List<MobileTask>>> {
    val grouped = tasks.mapNotNull { task ->
        aiInboxSection(task.workState)?.let { section -> section to task }
    }.groupBy({ it.first }, { it.second })
    return listOf(
        AiInboxSection.InProgress,
        AiInboxSection.NeedsReview,
        AiInboxSection.Blocked,
        AiInboxSection.RecentlyAccepted,
    ).mapNotNull { section -> grouped[section]?.takeIf { it.isNotEmpty() }?.let { section to it } }
}

internal fun filterCachedTasks(
    tasks: List<MobileTask>,
    query: String,
    filter: TaskListFilter,
): List<MobileTask> {
    val normalizedQuery = query.trim()
    return tasks.filter { task ->
        val matchesQuery = normalizedQuery.isEmpty() || task.title.contains(normalizedQuery, ignoreCase = true)
        val matchesState = when (filter) {
            TaskListFilter.Open -> task.state !in setOf("done", "cancelled")
            TaskListFilter.Done -> task.state == "done"
            TaskListFilter.All -> true
        }
        matchesQuery && matchesState
    }
}

@Composable
internal fun TasksListPane(
    uiState: TodayUiState,
    tasks: List<MobileTask>,
    themes: List<MobileTheme>,
    paneState: TodayPaneState,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
    onPair: (String, String) -> Unit,
    onTaskSelected: (String) -> Unit,
    actionState: TaskActionUiState,
    onTaskStateAction: (MobileTask) -> Unit,
    onChecklistUpdate: (MobileTask, List<MobileChecklistItem>) -> Unit = { _, _ -> },
    onTodayDateUpdate: ((MobileTask, LocalDate?) -> Unit)? = null,
    completionFeedback: TaskCompletionFeedback? = null,
    justAddedIds: Set<String> = emptySet(),
    onRecordWorkLog: ((MobileTask) -> Unit)? = null,
) {
    when {
        uiState is TodayUiState.PairingRequired -> PairingPane(uiState, onPair)
        uiState is TodayUiState.Error && tasks.isEmpty() -> GatewayErrorState(uiState, onRetry, onRetryPairing)
        uiState is TodayUiState.Loading && tasks.isEmpty() -> CenteredState {
            CircularProgressIndicator()
            Text("Taskを読み込んでいます")
        }
        else -> {
            val filtered = filterDailyTasks(
                tasks, paneState.taskSearch, paneState.taskFilter,
                paneState.taskScheduleFilter, paneState.taskThemeId,
            )
            Column(modifier = Modifier.fillMaxSize()) {
                if (uiState is TodayUiState.Cached) {
                    CachedTaskBanner(uiState, onRetry, onRetryPairing)
                }
                OutlinedTextField(
                    value = paneState.taskSearch,
                    onValueChange = { paneState.taskSearch = it.take(100) },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    label = { Text("Taskを検索") },
                    singleLine = true,
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    listOf(
                        TaskListFilter.Open to "未完了",
                        TaskListFilter.Done to "完了",
                        TaskListFilter.All to "すべて",
                    ).forEach { (filter, label) ->
                        FilterChip(
                            selected = paneState.taskFilter == filter,
                            onClick = { paneState.taskFilter = filter },
                            label = { Text(label) },
                        )
                    }
                }
                TaskListFilters(paneState, themes)
                if (filtered.isEmpty()) {
                    CenteredState {
                        Text(if (tasks.isEmpty()) "Taskはありません" else "条件に合うTaskはありません")
                        if (tasks.isNotEmpty()) {
                            TextButton(onClick = paneState::resetTaskFilters) { Text("絞り込みを解除") }
                        }
                    }
                } else {
                    TodayTaskList(
                        filtered,
                        paneState,
                        onTaskSelected,
                        allTasksMode = true,
                        themes = themes,
                        actionState = actionState,
                        onTaskStateAction = onTaskStateAction,
                        onChecklistUpdate = onChecklistUpdate,
                        onTodayDateUpdate = onTodayDateUpdate,
                        completionFeedback = completionFeedback,
                        justAddedIds = justAddedIds,
                        onRecordWorkLog = onRecordWorkLog,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FeedListPane(
    uiState: TodayUiState,
    tasks: List<MobileTask>,
    themes: List<MobileTheme>,
    proposals: List<MobileTaskWorkProposal>,
    paneState: TodayPaneState,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
    onPair: (String, String) -> Unit,
    onTaskSelected: (String) -> Unit,
    /** DesktopのFeed投稿（AIの投稿・自分の投稿）。タスクの動きと同じ流れに並べる。 */
    feedPosts: List<MobileFeedPostDto> = emptyList(),
    /** 「おもしろい」「ブックマーク」の付け外し。 */
    onToggleFeedReaction: (MobileFeedPostDto, String) -> Unit = { _, _ -> },
    /** 返信（自分のメモ）を残す。 */
    onPostFeedReply: (MobileFeedPostDto, String) -> Unit = { _, _ -> },
    attention: List<AttentionRow> = emptyList(),
    attentionCounts: MobileAttentionCountsDto? = null,
    attentionFetchedAt: String? = null,
    attentionOnline: Boolean = false,
    attentionRefreshing: Boolean = false,
    agentReplyState: AgentReplyUiState = AgentReplyUiState.Idle,
    onRefreshAttention: () -> Unit = {},
    onReplyToAgent: (AttentionRow, String?, String) -> Unit = { _, _, _ -> },
    onResetAgentReply: () -> Unit = {},
    /** Foldの展開幅では詳細ペインへ開く（1列では行の直下へ置く）。 */
    attentionInDetailPane: Boolean = false,
    selectedAttentionId: String? = null,
    onAttentionSelected: (AttentionRow) -> Unit = {},
    /** 新しく現れた判断（#601）。既定はアプリ内で知らせる。 */
    attentionNewArrivals: List<AttentionRow> = emptyList(),
    onOpenNewArrival: (AttentionRow) -> Unit = {},
    attentionNotificationsEnabled: Boolean = false,
    onToggleAttentionNotifications: (() -> Unit)? = null,
    onAttentionOpened: () -> Unit = {},
    /** 前回AIタブを見た時刻。これより新しい動きを新着として示す。 */
    seenBefore: java.time.Instant? = null,
    replyDictation: ReplyDictation? = null,
) {
    // 回答の下書きは1列でも展開幅と同じ保存先（paneState）に置く。
    // 面を移動しても、画面が作り直されても残り、正式に保存できたときだけ閉じる。
    val inlineTarget =
        if (attentionInDetailPane) {
            null
        } else {
            selectedAttentionId?.let { id -> attention.firstOrNull { it.attentionId == id } }
        }
    // DesktopのFeedと同じく「すべて」と「対応待ち」を切り替える。AIの投稿も人の記録も同じ流れに置く。
    var onlyNeedsYou by rememberSaveable { mutableStateOf(false) }
    var replyingToPostId by rememberSaveable { mutableStateOf<String?>(null) }
    feedPosts.firstOrNull { it.postId == replyingToPostId }?.let { target ->
        FeedReplySheet(
            post = target,
            onSend = { body ->
                onPostFeedReply(target, body)
                replyingToPostId = null
            },
            onDismiss = { replyingToPostId = null },
            dictation = replyDictation,
        )
    }
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = !onlyNeedsYou,
                onClick = { onlyNeedsYou = false },
                label = { Text("すべて") },
                modifier = Modifier.testTag("feed-filter-all"),
            )
            FilterChip(
                selected = onlyNeedsYou,
                onClick = { onlyNeedsYou = true },
                label = { Text("対応待ち") },
                modifier = Modifier.testTag("feed-filter-needs-you"),
            )
        }
        PullToRefreshBox(
            isRefreshing = attentionRefreshing,
            onRefresh = { onRefreshAttention(); onRetry() },
            modifier = Modifier.weight(1f).testTag("ai-pull-refresh"),
        ) {
    when {
        uiState is TodayUiState.PairingRequired -> PairingPane(uiState, onPair)
        uiState is TodayUiState.Error && tasks.isEmpty() -> GatewayErrorState(uiState, onRetry, onRetryPairing)
        uiState is TodayUiState.Loading && tasks.isEmpty() -> CenteredState {
            CircularProgressIndicator()
            Text("Agent Deskを読み込んでいます")
        }
        else -> {
            // 要対応が0件でも見出しは出す。「取得できていない」と「0件」を利用者が区別できるようにする。
            run {
                val listState = rememberLazyListState(
                    initialFirstVisibleItemIndex = paneState.aiListScrollIndex,
                    initialFirstVisibleItemScrollOffset = paneState.aiListScrollOffset,
                )
                LaunchedEffect(listState) {
                    snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
                        .collect { (index, offset) -> paneState.recordAiScroll(index, offset) }
                }
                ScrollToTopEffect(paneState.scrollToTopRequest, AppSection.Feed, listState)
                LazyColumn(
                    modifier = Modifier.fillMaxSize().testTag("ai-inbox-list"),
                    state = listState,
                    // 投稿は左右いっぱいに並べ、投稿どうしの空きは線だけにする。
                    // 要対応のカードや見出しだけが、それぞれ左右12dpの余白を持つ。
                    contentPadding = PaddingValues(bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(0.dp),
                ) {
                    item(key = "section-attention") {
                        Box(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
                        AgentAttentionHeader(
                            counts = attentionCounts,
                            fetchedAt = attentionFetchedAt,
                            online = attentionOnline,
                            refreshing = attentionRefreshing,
                            onRefresh = onRefreshAttention,
                            newArrivals = attentionNewArrivals,
                            onOpenNewArrival = { row ->
                                onResetAgentReply()
                                onAttentionOpened()
                                onOpenNewArrival(row)
                                onAttentionSelected(row)
                            },
                            notificationsEnabled = attentionNotificationsEnabled,
                            onToggleNotifications = onToggleAttentionNotifications,
                        )
                        }
                    }
                    items(attention, key = { "attention-${it.attentionId}" }) { row ->
                        Box(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
                        AgentAttentionCard(
                            row = row,
                            selected = selectedAttentionId == row.attentionId,
                            replyOpenBelow = inlineTarget?.attentionId == row.attentionId,
                            onOpenReply = {
                                onResetAgentReply()
                                // 展開幅では詳細ペインへ、1列では行の直下へ開く。置き場所だけを変える。
                                onAttentionSelected(row)
                            },
                            onOpenTask = { row.taskId?.let(onTaskSelected) },
                        )
                        }
                    }
                    if (inlineTarget != null) {
                        val target = inlineTarget
                        item(key = "attention-reply") {
                            Box(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
                            AgentReplyEditor(
                                row = target,
                                body = paneState.attentionReplyBody,
                                onBodyChange = { paneState.attentionReplyBody = it.take(10_000) },
                                state = agentReplyState,
                                online = attentionOnline,
                                onSend = { onReplyToAgent(target, null, paneState.attentionReplyBody) },
                                onCancel = {
                                    // 「閉じる」は破棄ではない。下書きは残す。
                                    paneState.closeAttention()
                                    onResetAgentReply()
                                },
                                dictation = replyDictation,
                            )
                            }
                        }
                    }
                    if (!onlyNeedsYou) item(key = "section-agent-counts") {
                        Box(Modifier.padding(horizontal = 12.dp)) { AiCountsStrip(counts = attentionCounts) }
                    }
                    val timeline = if (onlyNeedsYou) emptyList() else buildAiTimeline(tasks, proposals, feedPosts)
                    if (timeline.isNotEmpty()) {
                        item(key = "section-ai-timeline") {
                            AiSectionTitle("最近の動き", Modifier.padding(horizontal = 16.dp).padding(bottom = 4.dp))
                        }
                    }
                    // 自分の投稿は新着に数えない（自分で書いたものを「新着」と呼ばない）。
                    val others = timeline.filterNot { it.isOwn }
                    val hasNewAndOld = seenBefore != null &&
                        others.any { it.at?.isAfter(seenBefore) == true } &&
                        others.any { it.at?.isAfter(seenBefore) != true }
                    var dividerPlaced = false
                    for (entry in timeline) {
                        val isNew = !entry.isOwn && seenBefore != null && entry.at?.isAfter(seenBefore) == true
                        // 区切りは「新着」と「見た分」の境目に引く。自分の投稿はどちら側にも数えない。
                        if (hasNewAndOld && !isNew && !entry.isOwn && !dividerPlaced) {
                            dividerPlaced = true
                            item(key = "ai-seen-divider") { AiSeenDivider(Modifier.padding(horizontal = 16.dp).testTag("ai-seen-divider")) }
                        }
                        when (entry) {
                            is AiTimelineEntry.Post -> item(key = entry.key) {
                                FeedPostItem(
                                    post = entry.post,
                                    at = entry.at,
                                    isNew = isNew,
                                    highlighted = entry.post.taskId != null && entry.post.taskId == paneState.selectedTaskId,
                                    onOpenTask = onTaskSelected,
                                    onToggleReaction = { kind -> onToggleFeedReaction(entry.post, kind) },
                                    onReply = { replyingToPostId = entry.post.postId },
                                )
                            }
                            is AiTimelineEntry.Proposal -> item(key = entry.key) {
                                val proposal = entry.proposal
                                AiPost(
                                    author = proposal.executorLabel ?: proposal.caller,
                                    verb = "変更を提案しました",
                                    at = entry.at,
                                    isNew = isNew,
                                    highlighted = proposal.taskId == paneState.selectedTaskId,
                                    onClick = { onTaskSelected(proposal.taskId) },
                                    menu = { close ->
                                        DropdownMenuItem(text = { Text("Taskを開く") }, onClick = { close(); onTaskSelected(proposal.taskId) })
                                    },
                                    modifier = Modifier.testTag("proposal-list-${proposal.id}"),
                                ) {
                                    Text(proposal.taskTitle, style = FeedBodyStyle, fontWeight = FontWeight.SemiBold)
                                    proposal.summary?.let { Text(it, style = FeedBodyStyle, maxLines = 3, overflow = TextOverflow.Ellipsis) }
                                    FlowRow(
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalArrangement = Arrangement.spacedBy(2.dp),
                                        itemVerticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        TaskThemeLabel(proposal.themeId, themes)
                                        Text(
                                            taskWorkProposalActionLabel(proposal.action),
                                            color = MaterialTheme.colorScheme.tertiary,
                                            style = MaterialTheme.typography.labelMedium,
                                        )
                                        Text(
                                            proposal.sourceApp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            style = MaterialTheme.typography.labelSmall,
                                        )
                                    }
                                    if (proposal.stale) {
                                        Text("Task更新済み · 承認不可", color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                            is AiTimelineEntry.TaskActivity -> item(key = entry.key) {
                                val task = entry.task
                                AiPost(
                                    author = task.latestWorkReceipt?.executorLabel ?: "AI",
                                    verb = aiActivityVerb(aiInboxSection(task.workState)),
                                    at = entry.at,
                                    isNew = isNew,
                                    highlighted = task.id == paneState.selectedTaskId,
                                    onClick = { onTaskSelected(task.id) },
                                    menu = { close ->
                                        DropdownMenuItem(text = { Text("Taskを開く") }, onClick = { close(); onTaskSelected(task.id) })
                                    },
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(task.title, style = FeedBodyStyle, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                        AiOriginMark(task.aiOrigin)
                                    }
                                    task.latestWorkReceipt?.summary?.let { summary ->
                                        Text(summary, style = FeedBodyStyle, maxLines = 3, overflow = TextOverflow.Ellipsis)
                                    }
                                    FlowRow(
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalArrangement = Arrangement.spacedBy(2.dp),
                                        itemVerticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        TaskThemeLabel(task.themeId, themes)
                                        Text(
                                            taskWorkStateLabel(task.workState ?: ""),
                                            color = MaterialTheme.colorScheme.primary,
                                            style = MaterialTheme.typography.labelMedium,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        }
        }
    }
}

/**
 * 要対応の見出し（#601）。
 *
 * 件数はDesktopのbadgeと同じ意味で、**判断の数**。まだ読めていない間は
 * 「0件」と書かず、取得できていないことを示す。
 */
@Composable
private fun AgentAttentionHeader(
    counts: MobileAttentionCountsDto?,
    fetchedAt: String?,
    online: Boolean,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    /** 新しく現れた判断（#601）。既定のアプリ内表示はここで知らせる。 */
    newArrivals: List<AttentionRow> = emptyList(),
    onOpenNewArrival: (AttentionRow) -> Unit = {},
    notificationsEnabled: Boolean = false,
    onToggleNotifications: (() -> Unit)? = null,
) {
    Column(modifier = Modifier.fillMaxWidth().testTag("attention-header")) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (counts == null) "対応待ち" else "対応待ち ${counts.needsYou}",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            TextButton(onClick = onRefresh, enabled = !refreshing, modifier = Modifier.testTag("attention-refresh")) {
                Text(if (refreshing) "更新中" else "更新")
            }
        }
        if (counts == null) {
            Text(
                "要対応をまだ取得できていません。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
                modifier = Modifier.testTag("attention-unavailable"),
            )
        } else if (counts.needsYou == 0) {
            Text(
                "対応待ちはありません。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("attention-empty"),
            )
        }
        if (counts != null && !online) {
            Text(
                "Desktopへ接続できません。表示は最後に取得した内容です。",
                color = MaterialTheme.colorScheme.error,
                fontSize = 12.sp,
                modifier = Modifier.testTag("attention-stale"),
            )
        }
        fetchedAt?.let { at ->
            Text(
                "最終取得 ${attentionTimeLabel(at)}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
            )
        }
        // 新着は短く知らせ、押すとその判断へ移動する。行の本文はここへ写さない。
        newArrivals.firstOrNull()?.let { first ->
            TextButton(
                onClick = { onOpenNewArrival(first) },
                modifier = Modifier.testTag("attention-new-arrivals"),
            ) {
                Text("新しい対応待ち ${newArrivals.size}件")
            }
        }
        onToggleNotifications?.let { toggle ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = notificationsEnabled,
                    onCheckedChange = { toggle() },
                    modifier = Modifier.testTag("attention-notifications-toggle"),
                )
                Text(
                    "要対応の新着を通知",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** 作業中・開始待ちは要対応ではない。件数だけを別枠で示す。 */
@Composable
private fun AgentWorkCounts(counts: MobileAttentionCountsDto?) {
    if (counts == null) return
    Column(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(
            "作業中 ${counts.working}",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "開始待ち ${counts.queued}",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "開始は未確認",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun AgentAttentionCard(
    row: AttentionRow,
    selected: Boolean,
    /** 直下に返信欄を開いている。入口を重ねて出さない。 */
    replyOpenBelow: Boolean = false,
    onOpenReply: () -> Unit,
    onOpenTask: () -> Unit,
) {
    // あなたの番。AIからの投稿として見せ、問いかけは吹き出しで目立たせる。
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("attention-row-${row.attentionId}")
            .semantics { role = Role.Button },
        shape = RoundedCornerShape(16.dp),
        // あなたの返事を待つ投稿。枠ではなく淡い面で、流れの中から見つけやすくする。
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f),
        border = if (selected) BorderStroke(1.5.dp, MaterialTheme.colorScheme.primary) else null,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 14.dp, top = 12.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
        FeedAvatar(row.agentLabel ?: "AI")
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    row.agentLabel ?: "AI",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
                Surface(color = MaterialTheme.colorScheme.primary, shape = RoundedCornerShape(50)) {
                    Text(
                        attentionKindLabel(row.kind),
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            Text(row.headline, fontWeight = FontWeight.SemiBold)
            row.taskTitle?.let { title ->
                Text(title, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            }
            if (row.summary != row.headline) Text(row.summary, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (row.questionOrAction.isNotBlank() && row.questionOrAction != row.summary) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    shape = RoundedCornerShape(topStart = 4.dp, topEnd = 12.dp, bottomEnd = 12.dp, bottomStart = 12.dp),
                ) {
                    Text(
                        row.questionOrAction,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 4,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (row.canReply && !replyOpenBelow) {
                    // 返信欄の入口。押すとその場で書き始められる（Xの返信欄と同じ手触り）。
                    Surface(
                        onClick = onOpenReply,
                        shape = RoundedCornerShape(24.dp),
                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 44.dp)
                            .semantics { contentDescription = "回答する" }
                            .testTag("attention-reply-open-${row.attentionId}"),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "返信する…",
                                modifier = Modifier.weight(1f),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            Icon(
                                painterResource(R.drawable.ic_tabler_microphone),
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
                if (row.taskId != null) {
                    TextButton(
                        onClick = onOpenTask,
                        modifier = Modifier.testTag("attention-open-task-${row.attentionId}"),
                    ) {
                        Text("Taskを開く")
                    }
                }
            }
        }
        }
    }
}

/**
 * 要対応の詳細（#601）。
 *
 * Foldの展開幅では一覧の隣（Detailペイン）に置き、1列では一覧からpushして開く。
 * 上部に見出しと状態、中央に質問と成果、下部に回答欄と主操作を置く。
 * 表示は Desktop が返した値をそのまま使い、画面側で状態を作り直さない。
 */
@Composable
internal fun AttentionDetailPane(
    row: AttentionRow,
    body: String,
    onBodyChange: (String) -> Unit,
    state: AgentReplyUiState,
    online: Boolean,
    onSend: () -> Unit,
    onOpenTask: (() -> Unit)?,
    onBack: (() -> Unit)?,
    dictation: ReplyDictation? = null,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).testTag("attention-detail"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      // 読む部分だけをスクロールし、返信欄はキーボードの直上に残す。
      Column(
        modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        if (onBack != null) {
            TextButton(onClick = onBack, modifier = Modifier.testTag("attention-detail-back")) {
                Text("一覧へ戻る")
            }
        }
        Text(attentionKindLabel(row.kind), color = MaterialTheme.colorScheme.primary)
        row.taskTitle?.let { title ->
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
        Text(
            row.headline,
            modifier = Modifier.testTag("attention-detail-headline"),
            fontWeight = FontWeight.SemiBold,
        )
        Text(row.questionOrAction, modifier = Modifier.testTag("attention-detail-question"))
        row.agentLabel?.let { label ->
            Text("実行者 $label", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        }
        Text(
            "Taskの版 ${row.taskVersion ?: 0}",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
        )
        if (onOpenTask != null) {
            TextButton(onClick = onOpenTask, modifier = Modifier.testTag("attention-detail-open-task")) {
                Text("Taskを開く")
            }
        }
      }
        AttentionReplyForm(
            row = row,
            body = body,
            onBodyChange = onBodyChange,
            state = state,
            online = online,
            onSend = onSend,
            onCancel = null,
            tagPrefix = "attention-detail",
            dictation = dictation,
        )
    }
}

@Composable
private fun AttentionReplyForm(
    row: AttentionRow,
    body: String,
    onBodyChange: (String) -> Unit,
    state: AgentReplyUiState,
    online: Boolean,
    onSend: () -> Unit,
    onCancel: (() -> Unit)?,
    tagPrefix: String,
    /** 話して返す。認識した文字は下書きへ足し、送るのは本人が押した時だけ。 */
    dictation: ReplyDictation? = null,
    focusOnOpen: Boolean = false,
) {
    val sending = state is AgentReplyUiState.Replying
    val currentBody by rememberUpdatedState(body)
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(row.attentionId, focusOnOpen) {
        if (focusOnOpen) runCatching { focusRequester.requestFocus() }
    }
    Column(
        modifier = Modifier.fillMaxWidth().testTag("$tagPrefix-reply-editor"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // 会話の返信欄。入力・音声・送信を1つの帯にまとめる。
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(start = 4.dp, end = 4.dp)) {
                androidx.compose.material3.TextField(
                    value = body,
                    onValueChange = onBodyChange,
                    modifier = Modifier.weight(1f).focusRequester(focusRequester).testTag("$tagPrefix-reply-text"),
                    placeholder = { Text("${row.agentLabel ?: "AI"}に返信") },
                    minLines = 1,
                    maxLines = 6,
                    enabled = !sending,
                    colors = androidx.compose.material3.TextFieldDefaults.colors(
                        focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    ),
                )
                dictation?.let { voice ->
                    val listening = voice.state is ShortSpeechUiState.Listening || voice.state is ShortSpeechUiState.Partial
                    VoiceToolButton(
                        speechState = voice.state,
                        hasText = body.isNotBlank(),
                        enabled = !sending && voice.state !is ShortSpeechUiState.Processing,
                        onClick = {
                            if (listening) {
                                voice.stop()
                            } else {
                                voice.start { spoken ->
                                    onBodyChange(if (currentBody.isBlank()) spoken else "${currentBody.trimEnd()} $spoken")
                                }
                            }
                        },
                        modifier = Modifier.testTag("$tagPrefix-reply-voice"),
                    )
                }
                androidx.compose.material3.FilledIconButton(
                    onClick = onSend,
                    enabled = body.isNotBlank() && !sending && online,
                    modifier = Modifier.padding(bottom = 4.dp).testTag("$tagPrefix-reply-send"),
                ) {
                    if (sending) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            painterResource(R.drawable.ic_tabler_arrow_up),
                            contentDescription = "回答を送る",
                        )
                    }
                }
            }
        }
        if (!online) {
            Text(
                "Desktopへ接続してから回答してください。",
                color = MaterialTheme.colorScheme.error,
                fontSize = 12.sp,
            )
        }
        when (state) {
            is AgentReplyUiState.Applied -> Text(
                "回答を送りました。${agentDisplayStateLabel(state.displayState)}",
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.testTag("$tagPrefix-reply-message"),
            )
            is AgentReplyUiState.Conflict -> Text(
                state.message,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.testTag("$tagPrefix-reply-message"),
            )
            is AgentReplyUiState.Rejected -> Text(
                state.message,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.testTag("$tagPrefix-reply-message"),
            )
            is AgentReplyUiState.Unavailable -> Text(
                state.message,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.testTag("$tagPrefix-reply-message"),
            )
            else -> Unit
        }
        onCancel?.let { cancel ->
            TextButton(
                onClick = cancel,
                enabled = !sending,
                modifier = Modifier.testTag("$tagPrefix-reply-cancel"),
            ) {
                Text("閉じる")
            }
        }
    }
}

@Composable
private fun AgentReplyEditor(
    row: AttentionRow,
    body: String,
    onBodyChange: (String) -> Unit,
    state: AgentReplyUiState,
    online: Boolean,
    onSend: () -> Unit,
    onCancel: () -> Unit,
    dictation: ReplyDictation? = null,
) {
    // 質問は直上のカードに出ている。ここでは返信だけに集中させる。
    AttentionReplyForm(
        row = row,
        body = body,
        onBodyChange = onBodyChange,
        state = state,
        online = online,
        onSend = onSend,
        onCancel = onCancel,
        // 一覧の行の直下は従来の test tag（attention-reply-*）を保つ。
        tagPrefix = "attention",
        dictation = dictation,
        focusOnOpen = true,
    )
}

internal fun attentionKindLabel(kind: AttentionKind): String = when (kind) {
    AttentionKind.AnswerRequest -> "回答待ち"
    AttentionKind.DecisionRequest -> "判断待ち"
    AttentionKind.ReviewReport -> "成果確認"
    AttentionKind.ProposalPending -> "変更案"
    AttentionKind.Unknown -> "要確認"
}

/** Desktopが返した表示状態の言い換え。Android側で状態を作り直さない。 */
internal fun agentDisplayStateLabel(displayState: String): String = when (displayState) {
    "answered_resume_waiting" -> "agentの再開を待ちます。"
    "working" -> "agentが作業中です。"
    "review_waiting" -> "成果の確認待ちです。"
    else -> "Desktopの状態を確認してください。"
}

internal fun attentionTimeLabel(value: String): String = runCatching {
    java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault())
}.map { at ->
    "${at.monthValue}月${at.dayOfMonth}日 ${String.format("%02d:%02d", at.hour, at.minute)}"
}.getOrElse { "時刻不明" }

@Composable
private fun GatewayErrorState(    state: TodayUiState.Error,
    onRetry: () -> Unit,
    onRetryPairing: () -> Unit,
) {
    CenteredState {
        Text(state.message, fontWeight = FontWeight.SemiBold)
        Text(state.recovery, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onRetry) { Text("再読み込み") }
        TextButton(onClick = onRetryPairing) { Text("やり直す") }
    }
}

@Composable
private fun PairingPane(
    state: TodayUiState.PairingRequired,
    onPair: (String, String) -> Unit,
) {
    var origin by remember(state.origin) { mutableStateOf(state.origin) }
    var pairingCode by remember { mutableStateOf("") }
    CenteredState {
        Text("Desktopと接続", fontWeight = FontWeight.SemiBold)
        if (state.message.isNotBlank()) {
            Text(state.message, color = MaterialTheme.colorScheme.error)
        }
        OutlinedTextField(
            value = origin,
            onValueChange = { origin = it },
            label = { Text("Tailscale Serve URL") },
            placeholder = { Text("https://tasken.example.ts.net") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = pairingCode,
            onValueChange = { pairingCode = it.filter(Char::isDigit).take(8) },
            label = { Text("8桁のPairing code") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = { onPair(origin, pairingCode) },
            enabled = origin.isNotBlank() && pairingCode.length == 8,
        ) {
            Text("接続")
        }
    }
}


@Composable
internal fun TodayTaskList(
    tasks: List<MobileTask>,
    paneState: TodayPaneState,
    onTaskSelected: (String) -> Unit,
    allTasksMode: Boolean = false,
    themes: List<MobileTheme>,
    actionState: TaskActionUiState,
    onTaskStateAction: (MobileTask) -> Unit,
    onChecklistUpdate: (MobileTask, List<MobileChecklistItem>) -> Unit = { _, _ -> },
    onTodayDateUpdate: ((MobileTask, LocalDate?) -> Unit)? = null,
    completionFeedback: TaskCompletionFeedback? = null,
    justAddedIds: Set<String> = emptySet(),
    agentSessions: List<MobileAgentSessionDto> = emptyList(),
    agentSessionsUnavailable: Boolean = false,
    onAgentSessionRetry: () -> Unit = {},
    onRecordWorkLog: ((MobileTask) -> Unit)? = null,
    routines: MobileRoutinesDataDto? = null,
    routineSavingId: String? = null,
    onRecordHabit: (MobileRoutineHabitDto) -> Unit = {},
    onRecordMaintenance: (MobileRoutineMaintenanceDto) -> Unit = {},
) {
    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = if (allTasksMode) paneState.taskListScrollIndex else paneState.listScrollIndex,
        initialFirstVisibleItemScrollOffset = if (allTasksMode) paneState.taskListScrollOffset else paneState.listScrollOffset,
    )
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
            .collect { (index, offset) ->
                if (allTasksMode) paneState.recordTaskScroll(index, offset) else paneState.recordScroll(index, offset)
            }
    }
    ScrollToTopEffect(paneState.scrollToTopRequest, if (allTasksMode) AppSection.Tasks else AppSection.Today, listState)
    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag(if (allTasksMode) "all-task-list" else "today-task-list"),
        state = listState,
        contentPadding = PaddingValues(start = 12.dp, top = 12.dp, end = 12.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (agentSessions.isNotEmpty() || agentSessionsUnavailable) {
            item(key = "agent-session-timeline") {
                AgentSessionTimeline(agentSessions, agentSessionsUnavailable, onAgentSessionRetry)
            }
        }
        itemsIndexed(tasks, key = { _, task -> task.id }) { index, task ->
            val requiresWorkReceipt = task.workState in setOf("needs_human_review", "reported_done", "blocked")
            val stateActionEnabled = (!task.pending || task.canChangePendingState) &&
                task.conflict == null && actionState !is TaskActionUiState.Saving &&
                !requiresWorkReceipt
            val stateActionDescription = when {
                actionState is TaskActionUiState.Saving && actionState.taskId == task.id -> "${task.title}は保存処理中"
                actionState is TaskActionUiState.Saving -> "${task.title}は別のTaskの保存完了後に操作"
                task.conflict != null -> "${task.title}は競合を解決してから操作"
                task.pending && !task.canChangePendingState -> "${task.title}は同期後に操作"
                requiresWorkReceipt -> "${task.title}はWork Receiptを確認してから操作"
                task.state == "done" -> "${task.title}を未完了に戻す"
                else -> "${task.title}を完了"
            }
            val scheduleEditable = onTodayDateUpdate != null && task.state !in setOf("done", "cancelled") &&
                (!task.pending || task.canEditPendingCreate || task.canEditPendingTask) &&
                task.conflict == null && actionState !is TaskActionUiState.Saving
            val today = LocalDate.now()
            val rescheduleTarget = when {
                !scheduleEditable -> null
                allTasksMode && task.todayDate != today.toString() -> today
                else -> today.plusDays(1)
            }
            SwipeTaskActions(
                completeLabel = if (!stateActionEnabled) null else if (task.state == "done") "未完了に戻す" else "完了",
                onComplete = { onTaskStateAction(task) },
                rescheduleLabel = rescheduleTarget?.let { if (it == today) "今日やる" else "明日へ" },
                onReschedule = { rescheduleTarget?.let { onTodayDateUpdate?.invoke(task, it) } },
                modifier = Modifier.animateItem().testTag("task-swipe-${task.id}"),
            ) {
            val rowInteraction = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
            var rowMenuOpen by remember { mutableStateOf(false) }
            val rowHaptics = LocalHapticFeedback.current
            val selected = task.id == paneState.selectedTaskId
            val rowShape = segmentShape(index, tasks.size)
            val addedTint = rememberJustAddedTint(task.id in justAddedIds)
            Surface(
                shape = rowShape,
                color = addedTint.compositeOver(
                    if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                ),
                border = if (selected) BorderStroke(1.5.dp, MaterialTheme.colorScheme.primary) else null,
                modifier = Modifier
                    .fillMaxWidth()
                    .pressScale(rowInteraction, pressed = 0.985f)
                    .clip(rowShape)
                    .semantics { role = Role.Button }
                    .combinedClickable(
                        interactionSource = rowInteraction,
                        indication = androidx.compose.material3.ripple(),
                        onLongClickLabel = "操作メニュー",
                        onLongClick = {
                            rowHaptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            rowMenuOpen = true
                        },
                    ) {
                        onTaskSelected(task.id)
                    },
            ) {
              Column {
                // 長押しのメニュー。スワイプと同じ操作を、指を払わなくても選べるようにする。
                DropdownMenu(
                    expanded = rowMenuOpen,
                    onDismissRequest = { rowMenuOpen = false },
                    modifier = Modifier.testTag("task-menu-${task.id}"),
                ) {
                    if (stateActionEnabled) {
                        DropdownMenuItem(
                            text = { Text(if (task.state == "done") "未完了に戻す" else "完了") },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_tabler_circle_check), contentDescription = null) },
                            onClick = { rowMenuOpen = false; onTaskStateAction(task) },
                        )
                    }
                    rescheduleTarget?.let { target ->
                        DropdownMenuItem(
                            text = { Text(if (target == today) "今日やる" else "明日へ") },
                            leadingIcon = {
                                Icon(painterResource(if (target == today) R.drawable.ic_tabler_sun else R.drawable.ic_tabler_arrow_right), contentDescription = null)
                            },
                            onClick = { rowMenuOpen = false; onTodayDateUpdate?.invoke(task, target) },
                        )
                    }
                    if (scheduleEditable && task.todayDate == today.toString()) {
                        DropdownMenuItem(
                            text = { Text("今日の予定から外す") },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_tabler_x), contentDescription = null) },
                            onClick = { rowMenuOpen = false; onTodayDateUpdate?.invoke(task, null) },
                        )
                    }
                    onRecordWorkLog?.let { record ->
                        DropdownMenuItem(
                            text = { Text("やったことを残す") },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_tabler_pencil), contentDescription = null) },
                            onClick = { rowMenuOpen = false; record(task) },
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("開く") },
                        leadingIcon = { Icon(painterResource(R.drawable.ic_tabler_arrow_right), contentDescription = null) },
                        onClick = { rowMenuOpen = false; onTaskSelected(task.id) },
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        val doneAlpha by animateFloatAsState(
                            if (task.state == "done") 0.55f else 1f,
                            label = "task-done-alpha",
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            task.title,
                            modifier = Modifier.weight(1f).graphicsLayer { alpha = doneAlpha },
                            style = if (!allTasksMode && index == 0) {
                                MaterialTheme.typography.titleMedium
                            } else {
                                MaterialTheme.typography.bodyMedium
                            },
                            fontWeight = FontWeight.SemiBold,
                            textDecoration = if (task.state == "done") TextDecoration.LineThrough else null,
                        )
                        AiOriginMark(task.aiOrigin)
                        }
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                            ) {
                                TaskThemeLabel(task.themeId, themes)
                                if (task.conflict != null || requiresWorkReceipt) {
                                val conflict = task.conflict != null
                                Surface(
                                    color = if (conflict) {
                                        MaterialTheme.colorScheme.errorContainer
                                    } else {
                                        MaterialTheme.colorScheme.tertiaryContainer
                                    },
                                    shape = RoundedCornerShape(7.dp),
                                ) {
                                    Text(
                                        if (conflict) "競合" else "要確認",
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                        color = if (conflict) {
                                            MaterialTheme.colorScheme.onErrorContainer
                                        } else {
                                            MaterialTheme.colorScheme.onTertiaryContainer
                                        },
                                        fontSize = 11.sp,
                                    )
                                }
                            }
                            if (task.pending) {
                                Surface(
                                    color = MaterialTheme.colorScheme.secondaryContainer,
                                    shape = RoundedCornerShape(7.dp),
                                ) {
                                    Text(
                                        "送信待ち",
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                        fontSize = 11.sp,
                                    )
                                }
                            }
                            if (task.state !in setOf("todo", "done")) {
                                Surface(
                                    color = MaterialTheme.colorScheme.surfaceVariant,
                                    shape = RoundedCornerShape(7.dp),
                                ) {
                                    Text(
                                        taskStateLabel(task.state),
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        style = MaterialTheme.typography.labelMedium,
                                    )
                                }
                            }
                        }
                    }
                    if (onTodayDateUpdate != null && task.state !in setOf("done", "cancelled") &&
                        task.todayDate != LocalDate.now().toString()
                    ) {
                        IconButton(
                            onClick = { onTodayDateUpdate(task, LocalDate.now()) },
                            enabled = (!task.pending || task.canEditPendingCreate || task.canEditPendingTask) &&
                                task.conflict == null && actionState !is TaskActionUiState.Saving,
                            modifier = Modifier.testTag("task-today-quick-${task.id}"),
                        ) {
                            Icon(painterResource(R.drawable.ic_tabler_sun), contentDescription = "今日の予定に追加")
                        }
                    }
                    TaskCompletionControl(
                        checked = task.state == "done",
                        onCheckedChange = { onTaskStateAction(task) },
                        enabled = stateActionEnabled,
                        modifier = Modifier
                            .testTag("task-state-action-${task.id}")
                            .semantics { contentDescription = stateActionDescription },
                        feedbackEventId = completionFeedback
                            ?.takeIf { it.taskId == task.id }
                            ?.eventId,
                    )
                }
                if (task.checklistItems.isNotEmpty()) {
                    FlowRow(
                        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 12.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        task.checklistItems.sortedBy { it.sortOrder }.take(3).forEach { item ->
                            InlineChecklistControl(
                                item = item,
                                onToggle = {
                                    onChecklistUpdate(task, task.checklistItems.map { current ->
                                        if (current.id == item.id) current.copy(
                                            done = !current.done,
                                            completedAt = if (current.done) null else Instant.now().toString(),
                                        ) else current
                                    })
                                },
                                enabled = (!task.pending || task.canEditPendingChecklist || task.canEditPendingCreate || task.canEditPendingTask) &&
                                    task.conflict == null && actionState !is TaskActionUiState.Saving,
                                modifier = Modifier.widthIn(max = 160.dp)
                                    .testTag("task-list-checklist-${task.id}-${item.id}")
                                    .semantics { contentDescription = "${item.title}を${if (item.done) "未完了に戻す" else "完了する"}" },
                            )
                        }
                        if (task.checklistItems.size > 3) {
                            TextButton(
                                onClick = { onTaskSelected(task.id) },
                                modifier = Modifier.heightIn(min = 44.dp),
                                contentPadding = PaddingValues(horizontal = 4.dp),
                            ) { Text("ほか${task.checklistItems.size - 3}項目") }
                        }
                    }
                }
              }
            }
            }
        }
        if (!allTasksMode && routines != null && !routines.isEmpty) {
            item(key = "today-routines") {
                TodayRoutinesSection(routines, routineSavingId, onRecordHabit, onRecordMaintenance)
            }
        }
    }
}

@Composable
private fun TaskThemeLabel(themeId: String?, themes: List<MobileTheme>) {
    val theme = themes.firstOrNull { it.id == themeId } ?: return
    InlineThemeLabel(theme)
}

@Composable
internal fun ThemeColorDot(theme: MobileTheme) {
    Box(Modifier.size(8.dp).background(
        taskenThemeColor(theme.color, MaterialTheme.colorScheme.surface.luminance() < 0.5f),
        CircleShape,
    ))
}

@Composable
internal fun TodayDetailPane(
    task: MobileTask?,
    actionState: TaskActionUiState,
    onRecordWorkLog: ((MobileTask) -> Unit)? = null,
    onReadRelatedDocuments: ((MobileTask) -> Unit)? = null,
    onReadThemeContext: ((String) -> Unit)? = null,
    workReceiptDetailState: WorkReceiptDetailUiState = WorkReceiptDetailUiState.Idle,
    taskWorkProposals: List<MobileTaskWorkProposal> = emptyList(),
    proposalReviewOnline: Boolean = false,
    proposalReviewState: ProposalReviewUiState = ProposalReviewUiState.Idle,
    humanReviewOnline: Boolean = false,
    humanReviewRequiresRePairing: Boolean = false,
    humanReviewState: HumanReviewUiState = HumanReviewUiState.Idle,
    aiReadyState: AiReadyUiState = AiReadyUiState.Idle,
    themes: List<MobileTheme> = emptyList(),
    themeCatalogState: MobileThemeCatalogState = if (themes.isEmpty()) {
        MobileThemeCatalogState.Loading()
    } else {
        MobileThemeCatalogState.Available(themes, "local", 0, "")
    },
    onStateAction: (MobileTask) -> Unit,
    onTitleUpdate: (MobileTask, String) -> Unit = { _, _ -> },
    onTodayDateUpdate: (MobileTask, LocalDate?) -> Unit = { _, _ -> },
    onThemeUpdate: (MobileTask, String?) -> Unit = { _, _ -> },
    onScheduleUpdate: (MobileTask, MobileTaskScheduleDraft) -> Unit = { _, _ -> },
    onChecklistUpdate: (MobileTask, List<MobileChecklistItem>) -> Unit = { _, _ -> },
    onRejectedThemeDiscard: (MobileTask) -> Unit = {},
    onConflictResolution: (MobileTask, Boolean) -> Unit = { _, _ -> },
    onWorkReceiptRetry: (MobileTask, String) -> Unit = { _, _ -> },
    onProposalDecision: (MobileTaskWorkProposal, String) -> Unit = { _, _ -> },
    onHumanReview: (MobileTask, String, String?) -> Unit = { _, _, _ -> },
    onTaskAiReady: (MobileTask, Boolean) -> Unit = { _, _ -> },
    onNavigateBack: (() -> Unit)? = null,
    displayZoneId: ZoneId = ZoneId.systemDefault(),
    completionFeedbackEventId: Long? = null,
) {
    if (task == null) {
        CenteredState {
            Icon(
                painterResource(R.drawable.ic_tabler_checklist),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(40.dp),
            )
            Text("Taskを選んでください", style = MaterialTheme.typography.titleMedium)
            Text(
                "左の一覧から選ぶと、ここに詳細が開きます",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }
    val completionFeedbackScale = rememberTaskCompletionFeedbackScale(completionFeedbackEventId)
    var titleDraft by rememberSaveable(task.id) { mutableStateOf(task.title) }
    var titleBase by rememberSaveable(task.id) { mutableStateOf(task.title) }
    var titleEditing by rememberSaveable(task.id) { mutableStateOf(false) }
    val titleFocusRequester = remember(task.id) { FocusRequester() }
    val titleEditable = (!task.pending || task.canEditPendingCreate || task.canEditPendingTask) && task.conflict == null && actionState !is TaskActionUiState.Saving
    LaunchedEffect(titleEditing) {
        if (titleEditing) titleFocusRequester.requestFocus()
    }
    var descriptionExpanded by rememberSaveable(task.id) { mutableStateOf(false) }
    var aiOptionsOpen by rememberSaveable(task.id) { mutableStateOf(false) }
    var themePickerOpenRequest by rememberSaveable(task.id) { mutableStateOf(0) }
    val canReselectTheme = themes.isNotEmpty() &&
        (themeCatalogState is MobileThemeCatalogState.Available ||
            themeCatalogState is MobileThemeCatalogState.Stale)
    LaunchedEffect(task.id, task.title, actionState, titleEditing) {
        val resolution = actionState as? TaskActionUiState.ConflictResolved
        if (titleDraft == titleBase || resolution?.taskId == task.id) {
            titleDraft = task.title
            titleBase = task.title
        } else if (titleDraft.trim() == task.title) {
            titleBase = task.title
            titleEditing = false
        }
    }
    val today = LocalDate.now()
    onNavigateBack?.let { back -> BackHandler { back() } }
    Surface(
        modifier = Modifier.fillMaxSize().pointerInput(task?.id, onNavigateBack) {
            if (onNavigateBack == null) return@pointerInput
            var dragTotal = 0f
            detectHorizontalDragGestures(
                onDragStart = { dragTotal = 0f },
                onHorizontalDrag = { _, dragAmount -> dragTotal += dragAmount },
                onDragEnd = { if (dragTotal > 120f) onNavigateBack() },
            )
        },
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
        onNavigateBack?.let { back ->
            Row(
                modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = back, modifier = Modifier.testTag("task-detail-back")) {
                    Icon(painterResource(R.drawable.ic_tabler_arrow_left), contentDescription = "一覧へ戻る")
                }
                Text(
                    task.title,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        Column(
            modifier = Modifier.weight(1f).fillMaxWidth().testTag("task-detail-content")
                .verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (titleEditing) {
                    OutlinedTextField(
                        value = titleDraft,
                        onValueChange = { if (it.length <= 500) titleDraft = it },
                        modifier = Modifier.weight(1f).testTag("task-title").focusRequester(titleFocusRequester),
                        label = { Text("Task名") },
                        isError = actionState is TaskActionUiState.Error && actionState.taskId == task.id,
                        supportingText = (actionState as? TaskActionUiState.Error)
                            ?.takeIf { it.taskId == task.id }?.let { error -> { Text(error.message) } },
                        maxLines = 4,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = {
                            if (titleEditable && titleDraft.trim().isNotEmpty() && titleDraft.trim() != task.title) {
                                onTitleUpdate(task, titleDraft)
                            }
                        }),
                        enabled = titleEditable,
                    )
                } else {
                    Text(
                        task.title,
                        fontSize = 24.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f).testTag("task-title-display")
                            .clickable(enabled = titleEditable, onClickLabel = "Task名を編集") { titleEditing = true },
                    )
                }
                AiOriginMark(task.aiOrigin)
                IconButton(
                    onClick = { titleEditing = !titleEditing },
                    enabled = titleEditing || titleEditable,
                    modifier = Modifier.testTag("task-title-edit-toggle"),
                ) {
                    Icon(painterResource(if (titleEditing) R.drawable.ic_tabler_x else R.drawable.ic_tabler_pencil),
                        contentDescription = if (titleEditing) "名前の編集を閉じる" else "Task名を編集")
                }
            }
            if (titleEditing) {
                TextButton(
                    onClick = { onTitleUpdate(task, titleDraft) },
                    enabled = titleEditable && titleDraft.trim().isNotEmpty() && titleDraft.trim() != task.title,
                    modifier = Modifier.align(Alignment.End),
                ) { Text("Task名を保存") }
            }
            // いまの状態を一目で。状態・日付・Theme・予定を同じ形の札で並べる。
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.testTag("task-detail-chips"),
            ) {
                TaskDetailChip(
                    text = taskStateLabel(task.state),
                    icon = if (task.state == "done") R.drawable.ic_tabler_circle_check else R.drawable.ic_tabler_circle,
                    emphasized = task.state == "done",
                )
                TaskDetailChip(
                    text = taskTodayDateLabel(task.todayDate, today.toString()),
                    icon = R.drawable.ic_tabler_calendar,
                    modifier = Modifier.testTag("task-date-chip"),
                )
                themes.firstOrNull { it.id == task.themeId }?.let { theme ->
                    TaskDetailChip(text = theme.title, icon = R.drawable.ic_tabler_target)
                }
                task.schedule?.let { schedule ->
                    schedule.startDate?.let { start ->
                        TaskDetailChip(
                            text = listOfNotNull(start, schedule.endDate?.takeIf { it != start }).joinToString("〜"),
                            icon = R.drawable.ic_tabler_clock,
                        )
                    }
                }
            }
            val aiOptionsAvailable = task.workState in setOf("not_delegated", "ready_for_agent")
            val needsAiVisibility = aiOptionsAvailable && (task.workState == "ready_for_agent" || when (aiReadyState) {
                is AiReadyUiState.Updating -> aiReadyState.taskId == task.id
                is AiReadyUiState.Conflict -> aiReadyState.taskId == task.id
                is AiReadyUiState.Rejected -> aiReadyState.taskId == task.id
                is AiReadyUiState.Unavailable -> aiReadyState.taskId == task.id
                else -> false
            })
            // よく使う操作は同じ大きさのボタンで横に並べる。文で説明せず、絵と短い語で示す。
            Row(
                modifier = Modifier.fillMaxWidth().testTag("task-quick-actions"),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                onRecordWorkLog?.let { record ->
                    TaskQuickAction(R.drawable.ic_tabler_pencil, "記録する", { record(task) }, Modifier.weight(1f).testTag("task-record-work-log"))
                }
                onReadRelatedDocuments?.let { read ->
                    TaskQuickAction(R.drawable.ic_tabler_file_text, "資料", { read(task) }, Modifier.weight(1f).testTag("task-related-documents"))
                }
                if (task.themeId != null && onReadThemeContext != null) {
                    TaskQuickAction(R.drawable.ic_tabler_target, "Theme", { onReadThemeContext(task.themeId) }, Modifier.weight(1f).testTag("task-theme-context"))
                }
                if (aiOptionsAvailable && !needsAiVisibility) {
                    TaskQuickAction(
                        R.drawable.ic_tabler_sparkles,
                        if (aiOptionsOpen) "AIを閉じる" else "AIに任せる",
                        { aiOptionsOpen = !aiOptionsOpen },
                        Modifier.weight(1f).testTag("task-ai-options-toggle"),
                        selected = aiOptionsOpen,
                    )
                }
            }
            if (aiOptionsOpen || needsAiVisibility) {
                TaskAiReadyToggle(
                    task = task,
                    state = aiReadyState,
                    onChange = onTaskAiReady,
                )
            }
            if (task.pending) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            if (task.heldChanges.isNotEmpty()) "変更の確認が必要" else "送信待ち",
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            if (task.heldChanges.isNotEmpty()) "保持している変更を確認してください。" else "Desktopへの送信を待っています。",
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
            task.description?.takeIf(String::isNotBlank)?.let { description ->
                TextButton(
                    onClick = { descriptionExpanded = !descriptionExpanded },
                    modifier = Modifier.align(Alignment.End).testTag("task-description-toggle"),
                ) { Text(if (descriptionExpanded) "補足・元の入力を閉じる" else "補足・元の入力") }
                if (descriptionExpanded) {
                    SelectionContainer {
                        Text(
                            description,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.fillMaxWidth().testTag("task-description"),
                        )
                    }
                }
            }
            task.conflict?.let { conflict ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("同期できなかった変更", fontWeight = FontWeight.Bold)
                        if (conflict.intendedAction == "UpdateTask") {
                            if (conflict.localThemeIdChanged) {
                                Text("Desktop  Theme ${themeTitleForDisplay(themes, conflict.serverThemeId)}")
                                Text("この端末  Theme ${themeTitleForDisplay(themes, conflict.localThemeId)}")
                            } else if (conflict.localChecklistItemsChanged) {
                                Text("Desktop  Checklist ${checklistConflictLabel(conflict.serverChecklistItems)}")
                                Text("この端末  Checklist ${checklistConflictLabel(conflict.localChecklistItems)}")
                            } else if (conflict.localScheduleChanged) {
                                Text("Desktop  予定 ${scheduleConflictLabel(conflict.serverSchedule)}")
                                Text("この端末  予定 ${scheduleConflictLabel(conflict.localSchedule)}")
                            } else if (conflict.localTodayDateChanged) {
                                Text("Desktop  日付 ${taskTodayDateLabel(conflict.serverTodayDate)}")
                                Text("この端末  日付 ${taskTodayDateLabel(conflict.localTodayDate)}")
                            } else if (!conflict.localPlannedScheduleChanged) {
                                Text("Desktop  ${task.title}")
                                Text("この端末  ${conflict.localTitle}")
                            }
                            if (conflict.localPlannedScheduleChanged) {
                                Text("Desktop  時刻 ${conflict.serverPlannedStartTime ?: "未指定"}・所要時間 ${conflict.serverPlannedDurationMinutes?.let { "${it}分" } ?: "未指定"}")
                                Text("この端末  時刻 ${conflict.localPlannedStartTime ?: "未指定"}・所要時間 ${conflict.localPlannedDurationMinutes?.let { "${it}分" } ?: "未指定"}")
                            }
                        } else {
                            Text("Desktop  ${taskStateLabel(conflict.serverState)}  v${conflict.serverVersion}")
                            val localAction = when (conflict.intendedAction) {
                                "CompleteTask" -> "完了"
                                "ReopenTask" -> "未完了に戻す"
                                "DeleteTask" -> "削除"
                                else -> "変更"
                            }
                            Text(
                                "この端末  $localAction  " +
                                    "(v${conflict.expectedVersion}から)",
                            )
                        }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { onConflictResolution(task, true) },
                                enabled = actionState !is TaskActionUiState.Saving,
                            ) { Text(if (task.heldChanges.isEmpty()) "この端末を採用" else "この端末と後続変更を再送") }
                            TextButton(
                                onClick = { onConflictResolution(task, false) },
                                enabled = actionState !is TaskActionUiState.Saving,
                                colors = androidx.compose.material3.ButtonDefaults.textButtonColors(
                                    contentColor = if (task.heldChanges.isEmpty()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error),
                            ) { Text(if (task.heldChanges.isEmpty()) "Desktopを採用" else "Desktopを採用・後続変更を破棄") }
                        }
                    }
                }
            }
            if (task.heldChanges.isNotEmpty()) {
                Card(modifier = Modifier.fillMaxWidth().testTag("task-held-changes")) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("保持中の変更 ${task.heldChanges.size}件", style = MaterialTheme.typography.titleSmall)
                        SelectionContainer {
                            Text(task.heldChanges.joinToString("\n\n") { it.description })
                        }
                        if (task.conflict == null) {
                            Text(task.heldChanges.filter { it.rejected }.map { it.reason }.distinct().joinToString("\n"))
                            Text("内容は端末に残っています。")
                            TextButton(onClick = { onConflictResolution(task, true) }, enabled = actionState !is TaskActionUiState.Saving) {
                                Text("同じ変更を再試行")
                            }
                            TextButton(onClick = { onConflictResolution(task, false) }, enabled = actionState !is TaskActionUiState.Saving,
                                colors = androidx.compose.material3.ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                                Text("保持中の変更を破棄")
                            }
                        }
                    }
                }
            }
            task.rejectedThemeUpdate?.takeIf { task.heldChanges.isEmpty() }?.let { rejection ->
                Card(
                    modifier = Modifier.fillMaxWidth().testTag("theme-rejection"),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Theme変更を送信できませんでした", fontWeight = FontWeight.Bold)
                        Text(rejection.message)
                        Text("Themeを選び直すか、この変更を取り下げてください。")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = { themePickerOpenRequest += 1 },
                                enabled = canReselectTheme && actionState !is TaskActionUiState.Saving,
                                modifier = Modifier.testTag("theme-rejection-reselect"),
                            ) { Text("選び直す") }
                            TextButton(
                                onClick = { onRejectedThemeDiscard(task) },
                                enabled = actionState !is TaskActionUiState.Saving,
                                modifier = Modifier.testTag("theme-rejection-discard"),
                            ) { Text("取り下げる") }
                        }
                    }
                }
            }
            TaskChecklistEditor(
                task = task,
                enabled = (!task.pending || task.canEditPendingChecklist || task.canEditPendingCreate || task.canEditPendingTask) && task.conflict == null &&
                    actionState !is TaskActionUiState.Saving,
                stateDescription = when {
                    task.canEditPendingCreate -> "この端末に保存してから送信します"
                    task.pending && (task.canEditPendingChecklist || task.canEditPendingTask) -> "送信待ちの変更へ追記できます"
                    task.pending -> "同期後に変更"
                    task.conflict != null -> "競合を解決してから変更"
                    actionState is TaskActionUiState.Saving -> "保存中"
                    else -> null
                },
                onSave = { onChecklistUpdate(task, it) },
            )
            TaskThemePicker(
                taskId = task.id,
                themeId = task.themeId,
                themes = themes,
                catalogState = themeCatalogState,
                openRequest = themePickerOpenRequest,
                allowUnassigned = task.canEditPendingCreate || task.canEditPendingTask,
                enabled = (!task.pending || task.canEditPendingCreate || task.canEditPendingTask) && task.conflict == null && actionState !is TaskActionUiState.Saving,
                stateDescription = when {
                    task.canEditPendingCreate -> "この端末に保存してから送信します"
                    task.canEditPendingTask -> "送信待ちの変更へ追記できます"
                    task.pending -> "同期後に変更"
                    task.conflict != null -> "競合を解決してから変更"
                    actionState is TaskActionUiState.Saving -> "保存中"
                    themeCatalogState is MobileThemeCatalogState.Loading -> {
                        if (themes.isEmpty()) "Theme一覧を読み込み中" else "Theme一覧を更新中"
                    }
                    themeCatalogState is MobileThemeCatalogState.Stale -> "オフラインのTheme一覧を使用中"
                    themeCatalogState is MobileThemeCatalogState.Unsupported -> "このDesktopではTheme編集を利用できません"
                    themeCatalogState is MobileThemeCatalogState.Error -> "Theme一覧を取得できません"
                    themes.isEmpty() -> "利用できるThemeがありません"
                    else -> null
                },
                onThemeSelected = { onThemeUpdate(task, it) },
            )
            TaskScheduleEditor(
                task = task,
                enabled = (!task.pending || task.canEditPendingCreate || task.canEditPendingTask) && task.conflict == null &&
                    actionState !is TaskActionUiState.Saving,
                stateDescription = when {
                    task.canEditPendingCreate -> "この端末に保存してから送信します"
                    task.canEditPendingTask -> "送信待ちの変更へ追記できます"
                    task.pending -> "同期後に変更"
                    task.conflict != null -> "競合を解決してから変更"
                    actionState is TaskActionUiState.Saving -> "保存中"
                    else -> null
                },
                onSave = { onScheduleUpdate(task, it) },
            )
            taskWorkProposals.forEach { proposal ->
                TaskWorkProposalReviewCard(
                    proposal = proposal,
                    online = proposalReviewOnline,
                    reviewState = proposalReviewState,
                    onDecision = onProposalDecision,
                )
            }
            task.latestWorkReceipt?.let { receipt ->
                Card(
                    modifier = Modifier.fillMaxWidth().testTag("work-receipt-summary"),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("最新のWork Receipt", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(
                            "${receipt.executorLabel}  ${formatLocalTimestamp(receipt.reportedAt, displayZoneId)}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(receipt.summary)
                        when (val detailState = workReceiptDetailState) {
                            is WorkReceiptDetailUiState.Loading -> if (detailState.receiptId == receipt.id) {
                                Row(
                                    modifier = Modifier.testTag("work-receipt-loading"),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    CircularProgressIndicator()
                                    Text("詳細を読み込んでいます")
                                }
                            }
                            is WorkReceiptDetailUiState.Available -> if (detailState.detail.id == receipt.id) {
                                WorkReceiptDetailContent(
                                    detail = detailState.detail,
                                    fromCache = detailState.fromCache,
                                    warning = detailState.warning,
                                )
                            }
                            is WorkReceiptDetailUiState.Error -> if (detailState.receiptId == receipt.id) {
                                Column(
                                    modifier = Modifier.testTag("work-receipt-error"),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text(detailState.message, color = MaterialTheme.colorScheme.error)
                                    TextButton(onClick = { onWorkReceiptRetry(task, receipt.id) }) {
                                        Text("詳細を再読み込み")
                                    }
                                }
                            }
                            WorkReceiptDetailUiState.Idle -> Unit
                        }
                        if (task.workState in setOf("needs_human_review", "reported_done", "blocked")) {
                            TaskWorkHumanReviewCard(
                                task = task,
                                receipt = receipt,
                                detailState = workReceiptDetailState,
                                online = humanReviewOnline,
                                requiresRePairing = humanReviewRequiresRePairing,
                                reviewState = humanReviewState,
                                onReview = onHumanReview,
                            )
                        }
                    }
                }
            }
            Text(
                "更新  ${formatLocalTimestamp(task.updatedAt, displayZoneId)}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("task-updated-at"),
            )
        }
        Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(12.dp).testTag("task-detail-actions"),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedButton(
                    onClick = { onTodayDateUpdate(task, if (task.todayDate == today.toString()) null else today) },
                    enabled = (!task.pending || task.canEditPendingCreate || task.canEditPendingTask) && task.conflict == null && actionState !is TaskActionUiState.Saving,
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("task-today-action"),
                ) {
                    Icon(painterResource(R.drawable.ic_tabler_sun), contentDescription = null)
                    Text(
                        if (task.todayDate == today.toString()) "今日の予定から外す" else "今日の予定に追加",
                        modifier = Modifier.padding(start = 8.dp),
                        maxLines = 2,
                    )
                }
                Button(
                    onClick = { onStateAction(task) },
                    enabled = (!task.pending || task.canChangePendingState) &&
                        task.conflict == null && actionState !is TaskActionUiState.Saving &&
                        task.workState !in setOf("needs_human_review", "reported_done", "blocked"),
                    modifier = Modifier
                        .graphicsLayer {
                            scaleX = completionFeedbackScale
                            scaleY = completionFeedbackScale
                        }
                        .weight(1f)
                        .heightIn(min = 52.dp)
                        .testTag("task-primary-action"),
                ) {
                    Text(when {
                        actionState is TaskActionUiState.Saving && actionState.taskId == task.id -> "保存中"
                        task.conflict != null -> "競合を解決してから操作"
                        task.pending && !task.canChangePendingState -> "同期後に操作"
                        task.workState in setOf("needs_human_review", "reported_done", "blocked") -> "Work Receiptを確認"
                        task.pending && task.state == "done" -> "未完了に変更"
                        task.pending -> "完了に変更"
                        task.state == "done" -> "未完了に戻す"
                        else -> "完了する"
                    })
                }
            }
        }
        }
    }
}

/** 詳細の頭に並べる札。変更は下の各欄で行い、ここは読むだけにする。 */
@Composable
private fun TaskDetailChip(
    text: String,
    icon: Int,
    modifier: Modifier = Modifier,
    emphasized: Boolean = false,
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = if (emphasized) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(16.dp))
            Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** 詳細の操作ボタン。絵と短い語を縦に置き、どれも同じ大きさで押せる。 */
@Composable
private fun TaskQuickAction(
    icon: Int,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
) {
    val interaction = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        interactionSource = interaction,
        modifier = modifier.heightIn(min = 64.dp).pressScale(interaction, pressed = 0.94f),
    ) {
        Column(
            modifier = Modifier.padding(vertical = 10.dp, horizontal = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(painterResource(icon), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

private val localTimestampFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy/M/d H:mm z")

internal fun formatLocalTimestamp(value: String, zoneId: ZoneId = ZoneId.systemDefault()): String =
    runCatching { Instant.parse(value).atZone(zoneId).format(localTimestampFormatter) }
        .getOrDefault(value)

@Composable
private fun TaskAiReadyToggle(
    task: MobileTask,
    state: AiReadyUiState,
    onChange: (MobileTask, Boolean) -> Unit,
) {
    val isReady = task.workState == "ready_for_agent"
    val updating = when (state) {
        is AiReadyUiState.Updating -> state.taskId == task.id
        else -> false
    }
    val message = when (state) {
        is AiReadyUiState.Conflict -> state.takeIf { it.taskId == task.id }?.message
        is AiReadyUiState.Rejected -> state.takeIf { it.taskId == task.id }?.message
        is AiReadyUiState.Unavailable -> state.takeIf { it.taskId == task.id }?.message
        else -> null
    }
    Card(
        modifier = Modifier.fillMaxWidth().testTag("task-ai-ready-${task.id}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("AI Ready", fontWeight = FontWeight.Bold)
                    Text("AIに渡せる状態", color = MaterialTheme.colorScheme.onSecondaryContainer)
                }
                val actionLabel = if (isReady) "AI Readyを解除" else "AI Readyにする"
                Button(
                    onClick = { onChange(task, !isReady) },
                    enabled = !updating && !task.pending && task.conflict == null &&
                        task.state !in setOf("done", "cancelled"),
                    modifier = Modifier
                        .heightIn(min = 48.dp)
                        .semantics {
                            contentDescription = actionLabel
                            stateDescription = if (isReady) "AIが対応可能" else "自分が対応"
                        }
                        .testTag("task-ai-ready-toggle-${task.id}"),
                ) { Text(actionLabel) }
            }
            when {
                updating -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(modifier = Modifier.padding(2.dp))
                    Text("AI Readyを変更中")
                }
                message != null -> Text(message, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun TaskWorkHumanReviewCard(
    task: MobileTask,
    receipt: MobileWorkReceiptSummary,
    detailState: WorkReceiptDetailUiState,
    online: Boolean,
    requiresRePairing: Boolean,
    reviewState: HumanReviewUiState,
    onReview: (MobileTask, String, String?) -> Unit,
) {
    var reviewNote by rememberSaveable(task.id) { mutableStateOf("") }
    val reviewing = reviewState is HumanReviewUiState.Reviewing && reviewState.pending.taskId == task.id
    val liveDetail = detailState as? WorkReceiptDetailUiState.Available
    val verifiedLatest = liveDetail?.detail?.id == receipt.id && !liveDetail.fromCache
    val blocked = task.workState == "blocked"
    val canReview = online && verifiedLatest && task.version > 0 && !task.pending && task.conflict == null && !reviewing
    Card(
        modifier = Modifier.fillMaxWidth().testTag("human-review-${task.id}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(if (blocked) "AIへ情報を返す" else "作業結果を確認", fontWeight = FontWeight.Bold)
            when {
                requiresRePairing -> Text(
                    "この権限では判断できません。Desktopで新しいコードを発行して再ペアリングしてください。",
                    color = MaterialTheme.colorScheme.secondary,
                )
                !online -> Text("Offline cache · Desktop接続時に判断できます", color = MaterialTheme.colorScheme.secondary)
                !verifiedLatest -> Text("最新のWork Receipt詳細を読み込んでから判断してください。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                task.pending -> Text("送信待ちの変更を同期してから判断してください。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                task.conflict != null -> Text("Task競合を解決してから判断してください。", color = MaterialTheme.colorScheme.error)
            }
            OutlinedTextField(
                value = reviewNote,
                onValueChange = { if (it.length <= 2_000) reviewNote = it },
                modifier = Modifier.fillMaxWidth().testTag("human-review-note-${task.id}"),
                label = { Text(if (blocked) "必要な情報" else "差し戻し理由") },
                enabled = canReview,
                minLines = 2,
                maxLines = 5,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!blocked) {
                    Button(
                        onClick = { onReview(task, "accept", null) },
                        enabled = canReview,
                        modifier = Modifier.testTag("human-review-accept-${task.id}"),
                    ) {
                        Text(if (reviewing && reviewState.pending.action == "accept") "承認中" else "承認して完了")
                    }
                }
                TextButton(
                    onClick = { onReview(task, "return", reviewNote) },
                    enabled = canReview && reviewNote.trim().isNotEmpty(),
                    modifier = Modifier.testTag("human-review-return-${task.id}"),
                ) {
                    Text(
                        if (reviewing && reviewState.pending.action == "return") {
                            "送信中"
                        } else if (blocked) {
                            "返信する"
                        } else {
                            "差し戻す"
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun TaskWorkProposalReviewCard(
    proposal: MobileTaskWorkProposal,
    online: Boolean,
    reviewState: ProposalReviewUiState,
    onDecision: (MobileTaskWorkProposal, String) -> Unit,
) {
    val reviewing = reviewState is ProposalReviewUiState.Reviewing && reviewState.proposalId == proposal.id
    val uriHandler = LocalUriHandler.current
    Card(
        modifier = Modifier.fillMaxWidth().testTag("proposal-detail-${proposal.id}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("AI Proposal", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(taskWorkProposalActionLabel(proposal.action), color = MaterialTheme.colorScheme.tertiary)
            }
            Text(
                "${proposal.caller} · ${proposal.sourceApp}",
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
            proposal.executorLabel?.let { Text("実行  $it") }
            proposal.summary?.let { Text(it) }
            WorkReceiptItemSection("完了", proposal.completedItems)
            WorkReceiptItemSection("変更 / 作成", proposal.changedOrCreatedItems)
            WorkReceiptItemSection("確認", proposal.verification)
            WorkReceiptItemSection("残り", proposal.remainingWork)
            if (proposal.externalReferences.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("関連リンク", fontWeight = FontWeight.SemiBold)
                    proposal.externalReferences.forEach { reference ->
                        TextButton(
                            onClick = { uriHandler.openUri(reference.url) },
                            modifier = Modifier.testTag("proposal-link-${reference.kind}"),
                        ) {
                            Text(reference.displayLabel)
                        }
                    }
                }
            }
            when {
                proposal.stale -> Text(
                    "Taskが更新されています。承認せず、AIへ再報告を依頼してください。",
                    color = MaterialTheme.colorScheme.error,
                )
                !online -> Text(
                    "Offline cache · Desktop接続時に承認できます",
                    color = MaterialTheme.colorScheme.secondary,
                )
                proposal.truncated -> Text(
                    "長いProposalの一部を省略しています。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { onDecision(proposal, "accept") },
                    enabled = online && !proposal.stale && !reviewing,
                    modifier = Modifier.testTag("proposal-approve-${proposal.id}"),
                ) {
                    Text(if (reviewing && reviewState.decision == "accept") "承認中" else "承認")
                }
                TextButton(
                    onClick = { onDecision(proposal, "reject") },
                    enabled = online && !reviewing,
                    modifier = Modifier.testTag("proposal-reject-${proposal.id}"),
                ) {
                    Text(if (reviewing && reviewState.decision == "reject") "却下中" else "却下")
                }
            }
        }
    }
}

internal fun taskWorkProposalActionLabel(action: String): String = when (action) {
    "start" -> "作業開始"
    "append_receipt" -> "進捗追記"
    "report_done" -> "完了報告"
    "report_blocked" -> "Blocked"
    else -> "Proposal"
}

@Composable
private fun WorkReceiptDetailContent(
    detail: MobileWorkReceiptDetail,
    fromCache: Boolean,
    warning: String?,
) {
    val uriHandler = LocalUriHandler.current
    Column(
        modifier = Modifier.fillMaxWidth().testTag("work-receipt-detail"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (detail.startedAt != null) {
            Text("開始  ${detail.startedAt}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (fromCache) Text("Offline cache", color = MaterialTheme.colorScheme.secondary)
        warning?.let { Text(it, color = MaterialTheme.colorScheme.secondary) }
        WorkReceiptItemSection("完了", detail.completedItems)
        WorkReceiptItemSection("変更 / 作成", detail.changedOrCreatedItems)
        WorkReceiptItemSection("確認", detail.verification)
        WorkReceiptItemSection("残り", detail.remainingWork)
        if (detail.externalReferences.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("関連リンク", fontWeight = FontWeight.SemiBold)
                detail.externalReferences.forEach { reference ->
                    TextButton(
                        onClick = { uriHandler.openUri(reference.url) },
                        modifier = Modifier.testTag("work-receipt-link-${reference.kind}"),
                    ) {
                        Text(reference.displayLabel)
                    }
                }
            }
        }
        if (detail.truncated) {
            Text(
                "長いReceiptの一部を省略しています。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun WorkReceiptItemSection(label: String, items: List<String>) {
    if (items.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, fontWeight = FontWeight.SemiBold)
        items.forEach { item -> Text("• $item") }
    }
}

private fun checklistConflictLabel(items: List<MobileChecklistItem>): String {
    val completed = items.count { it.done }
    return "${completed}/${items.size} 完了"
}

@Composable
private fun TaskChecklistEditor(
    task: MobileTask,
    enabled: Boolean,
    stateDescription: String?,
    onSave: (List<MobileChecklistItem>) -> Unit,
) {
    var addDraft by rememberSaveable(task.id) { mutableStateOf("") }
    var submittedAddId by rememberSaveable(task.id) { mutableStateOf<String?>(null) }
    var submittedAddTitle by rememberSaveable(task.id) { mutableStateOf("") }
    LaunchedEffect(task.checklistItems) {
        if (submittedAddId != null && task.checklistItems.any { it.id == submittedAddId }) {
            if (addDraft.trim() == submittedAddTitle) addDraft = ""
            submittedAddId = null
        }
    }
    fun addItem() {
        val title = addDraft.trim()
        if (!enabled || title.isEmpty() || task.checklistItems.size >= 100) return
        val id = submittedAddId.takeIf { submittedAddTitle == title } ?: UUID.randomUUID().toString()
        submittedAddId = id
        submittedAddTitle = title
        onSave(task.checklistItems + MobileChecklistItem(
            id = id, title = title, done = false, sortOrder = task.checklistItems.size.toDouble(),
        ))
    }
    Card(
        modifier = Modifier.fillMaxWidth().testTag("task-checklist"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Checklist", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "${task.checklistItems.count { it.done }}/${task.checklistItems.size}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            stateDescription?.let {
                Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            task.checklistItems.forEach { item ->
                ChecklistItemEditor(
                    taskId = task.id,
                    item = item,
                    enabled = enabled,
                    onToggle = {
                        onSave(task.checklistItems.map { current ->
                            if (current.id == item.id) {
                                current.copy(
                                    done = !current.done,
                                    completedAt = if (current.done) null else Instant.now().toString(),
                                )
                            } else {
                                current
                            }
                        })
                    },
                    onRename = { title ->
                        onSave(task.checklistItems.map { current ->
                            if (current.id == item.id) current.copy(title = title) else current
                        })
                    },
                    onDelete = {
                        onSave(task.checklistItems.filterNot { current -> current.id == item.id })
                    },
                )
            }
            if (task.checklistItems.isEmpty()) {
                Text("項目はまだありません", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = addDraft,
                    onValueChange = { if (it.length <= 200) addDraft = it },
                    modifier = Modifier.weight(1f).testTag("checklist-add-title"),
                    label = { Text("項目を追加") },
                    singleLine = true,
                    enabled = enabled && task.checklistItems.size < 100,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { addItem() }),
                )
                Button(
                    onClick = { addItem() },
                    enabled = enabled && addDraft.trim().isNotEmpty() && task.checklistItems.size < 100,
                    modifier = Modifier.testTag("checklist-add"),
                ) { Text("追加") }
            }
        }
    }
}

@Composable
private fun ChecklistItemEditor(
    taskId: String,
    item: MobileChecklistItem,
    enabled: Boolean,
    onToggle: () -> Unit,
    onRename: (String) -> Unit,
    onDelete: () -> Unit,
) {
    var titleDraft by rememberSaveable(taskId, item.id, item.title) { mutableStateOf(item.title) }
    var editing by rememberSaveable(taskId, item.id) { mutableStateOf(false) }
    val focusRequester = remember(taskId, item.id) { FocusRequester() }
    LaunchedEffect(editing) {
        if (editing) focusRequester.requestFocus()
    }
    LaunchedEffect(item.title) { editing = false }
    Column(
        modifier = Modifier.fillMaxWidth().testTag("checklist-item-${item.id}"),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (editing) OutlinedTextField(
                value = titleDraft,
                onValueChange = { if (it.length <= 200) titleDraft = it },
                modifier = Modifier.weight(1f).focusRequester(focusRequester),
                maxLines = 4,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = {
                    if (enabled && titleDraft.trim().isNotEmpty() && titleDraft.trim() != item.title) onRename(titleDraft)
                }),
            ) else Text(
                item.title,
                modifier = Modifier.weight(1f).testTag("checklist-label-${item.id}")
                    .clickable(enabled = enabled, onClickLabel = "項目名を編集") { editing = true },
                color = if (item.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            IconButton(
                onClick = { editing = !editing },
                enabled = editing || enabled,
                modifier = Modifier.testTag("checklist-edit-${item.id}"),
            ) {
                Icon(painterResource(if (editing) R.drawable.ic_tabler_x else R.drawable.ic_tabler_pencil),
                    contentDescription = if (editing) "項目名の編集を閉じる" else "${item.title}を編集")
            }
            TaskCompletionControl(
                checked = item.done,
                onCheckedChange = { onToggle() },
                enabled = enabled,
                modifier = Modifier.testTag("checklist-toggle-${item.id}")
                    .semantics { contentDescription = "${item.title}を${if (item.done) "未完了に戻す" else "完了する"}" },
            )
        }
        if (editing) Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End),
        ) {
            TextButton(
                onClick = { onRename(titleDraft) },
                enabled = enabled && titleDraft.trim().isNotEmpty() && titleDraft.trim() != item.title,
            ) { Text("保存") }
            TextButton(onClick = onDelete, enabled = enabled) { Text("削除") }
        }
    }
}

private enum class ScheduleDateTarget {
    Start,
    End,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskScheduleEditor(
    task: MobileTask,
    enabled: Boolean,
    stateDescription: String?,
    onSave: (MobileTaskScheduleDraft) -> Unit,
) {
    val schedule = task.schedule
    val scheduleFingerprint = listOf(
        schedule?.id,
        schedule?.version,
        schedule?.startDate,
        schedule?.endDate,
        schedule?.rangeSemantics,
        task.plannedStartTime,
        task.plannedDurationMinutes,
    ).joinToString("|")
    var startDraft by rememberSaveable(task.id, scheduleFingerprint) {
        mutableStateOf(schedule?.startDate.orEmpty())
    }
    var endDraft by rememberSaveable(task.id, scheduleFingerprint) {
        mutableStateOf(schedule?.endDate.orEmpty())
    }
    var rangeSemanticsDraft by rememberSaveable(task.id, scheduleFingerprint) {
        mutableStateOf(schedule?.rangeSemantics.orEmpty())
    }
    var dateTarget by rememberSaveable(task.id) { mutableStateOf<ScheduleDateTarget?>(null) }
    var timeDraft by rememberSaveable(task.id, scheduleFingerprint) { mutableStateOf(task.plannedStartTime.orEmpty()) }
    var durationDraft by rememberSaveable(task.id, scheduleFingerprint) { mutableStateOf(task.plannedDurationMinutes?.toString().orEmpty()) }
    var editing by rememberSaveable(task.id) { mutableStateOf(false) }

    val startDate = startDraft.toLocalDateOrNull()
    val endDate = endDraft.toLocalDateOrNull()
    val datesValid = startDate == null || endDate == null || !endDate.isBefore(startDate)
    val timeValid = timeDraft.isBlank() || isPlannedStartTime(timeDraft)
    val durationValid = durationDraft.isBlank() || durationDraft.toIntOrNull()?.let(::isPlannedDurationMinutes) == true
    val isValid = datesValid && timeValid && durationValid
    val isTrueRange = isTrueScheduleRange(startDate, endDate)
    val draft = MobileTaskScheduleDraft(
        startDate = startDate?.toString(),
        endDate = endDate?.toString(),
        rangeSemantics = rangeSemanticsDraft.takeIf { isTrueRange && it.isNotEmpty() },
        plannedStartTime = timeDraft.takeIf { it.isNotBlank() },
        plannedDurationMinutes = durationDraft.toIntOrNull(),
    )
    val original = MobileTaskScheduleDraft(
        startDate = schedule?.startDate,
        endDate = schedule?.endDate,
        rangeSemantics = schedule?.rangeSemantics,
        plannedStartTime = task.plannedStartTime,
        plannedDurationMinutes = task.plannedDurationMinutes,
    )
    val hasChanges = draft != original

    fun updateDates(newStart: LocalDate?, newEnd: LocalDate?) {
        val wasTrueRange = isTrueScheduleRange(startDate, endDate)
        val becomesTrueRange = isTrueScheduleRange(newStart, newEnd)
        startDraft = newStart?.toString().orEmpty()
        endDraft = newEnd?.toString().orEmpty()
        rangeSemanticsDraft = when {
            !becomesTrueRange -> ""
            wasTrueRange -> rangeSemanticsDraft
            else -> "once_within_window"
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth().testTag("task-schedule-editor"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("予定", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            IconButton(
                onClick = { editing = !editing },
                enabled = editing || enabled,
                modifier = Modifier.testTag("schedule-edit-toggle"),
            ) {
                Icon(painterResource(if (editing) R.drawable.ic_tabler_x else R.drawable.ic_tabler_pencil),
                    contentDescription = if (editing) "予定の編集を閉じる" else "予定を編集")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                scheduleDraftLabel(startDate, endDate, rangeSemanticsDraft),
                modifier = Modifier.testTag("schedule-kind")
                    .clickable(enabled = enabled, onClickLabel = "予定を編集") { editing = true },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (!editing) {
            Text(
                listOfNotNull(startDraft.takeIf { it.isNotEmpty() }?.let { "開始 $it" },
                    endDraft.takeIf { it.isNotEmpty() }?.let { "期限 $it" },
                    timeDraft.takeIf { it.isNotEmpty() }?.let { "時刻 $it" },
                    durationDraft.takeIf { it.isNotEmpty() }?.let { "所要 ${it}分" }).joinToString(" / ")
                    .ifEmpty { "予定なし" },
                modifier = Modifier.testTag("schedule-summary")
                    .clickable(enabled = enabled, onClickLabel = "予定を編集") { editing = true },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (hasChanges) Text("未保存の予定があります", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (editing) {
        ScheduleDateField(
            label = "開始",
            value = startDate,
            enabled = enabled,
            stateDescription = stateDescription,
            fieldTag = "schedule-start-date",
            clearTag = "schedule-start-clear",
            onOpen = { dateTarget = ScheduleDateTarget.Start },
            onClear = { updateDates(null, endDate) },
        )
        ScheduleDateField(
            label = "期限",
            value = endDate,
            enabled = enabled,
            stateDescription = stateDescription,
            fieldTag = "schedule-end-date",
            clearTag = "schedule-end-clear",
            onOpen = { dateTarget = ScheduleDateTarget.End },
            onClear = { updateDates(startDate, null) },
        )
        if (!datesValid) {
            Text(
                "期限は開始以降を選んでください。",
                modifier = Modifier.testTag("schedule-date-error"),
                color = MaterialTheme.colorScheme.error,
            )
        }
        OutlinedTextField(
            value = timeDraft, onValueChange = { timeDraft = it }, enabled = enabled,
            label = { Text("予定開始時刻 (HH:mm)") }, singleLine = true, isError = !timeValid,
            modifier = Modifier.fillMaxWidth().testTag("schedule-start-time"),
        )
        OutlinedTextField(
            value = durationDraft, onValueChange = { durationDraft = it }, enabled = enabled,
            label = { Text("所要時間（分）") }, singleLine = true, isError = !durationValid,
            modifier = Modifier.fillMaxWidth().testTag("schedule-duration"),
        )
        if (!timeValid || !durationValid) Text("時刻は HH:mm、所要時間は1〜10080分で入力してください。", color = MaterialTheme.colorScheme.error)
        if (isTrueRange) {
            Text("この期間の意味", fontWeight = FontWeight.SemiBold)
            if (rangeSemanticsDraft.isEmpty()) {
                Text(
                    "期間未分類",
                    modifier = Modifier.testTag("schedule-range-unspecified"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth().testTag("schedule-range-semantics"),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = rangeSemanticsDraft == "once_within_window",
                    onClick = { rangeSemanticsDraft = "once_within_window" },
                    enabled = enabled,
                    label = { Text("期間内に一度") },
                    modifier = Modifier.testTag("schedule-range-once"),
                )
                FilterChip(
                    selected = rangeSemanticsDraft == "ongoing",
                    onClick = { rangeSemanticsDraft = "ongoing" },
                    enabled = enabled,
                    label = { Text("期間中継続") },
                    modifier = Modifier.testTag("schedule-range-ongoing"),
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = { updateDates(null, null); timeDraft = ""; durationDraft = "" },
                enabled = enabled && (startDate != null || endDate != null || rangeSemanticsDraft.isNotEmpty() || timeDraft.isNotEmpty() || durationDraft.isNotEmpty()),
                modifier = Modifier.testTag("schedule-clear"),
            ) { Text("予定をクリア") }
            Button(
                onClick = { onSave(draft) },
                enabled = enabled && isValid && hasChanges,
                modifier = Modifier.testTag("schedule-save"),
            ) { Text("予定を保存") }
        }
        }
    }

    dateTarget?.let { target ->
        val currentDate = if (target == ScheduleDateTarget.Start) startDate else endDate
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = currentDate?.toPickerMillis(),
        )
        DatePickerDialog(
            onDismissRequest = { dateTarget = null },
            confirmButton = {
                TextButton(
                    onClick = {
                        pickerState.selectedDateMillis?.toPickerLocalDate()?.let { selectedDate ->
                            if (target == ScheduleDateTarget.Start) {
                                updateDates(selectedDate, endDate)
                            } else {
                                updateDates(startDate, selectedDate)
                            }
                        }
                        dateTarget = null
                    },
                    enabled = pickerState.selectedDateMillis != null,
                ) { Text("決定") }
            },
            dismissButton = {
                TextButton(onClick = { dateTarget = null }) { Text("キャンセル") }
            },
        ) {
            DatePicker(
                state = pickerState,
                title = {
                    Text(
                        if (target == ScheduleDateTarget.Start) "開始を選択" else "期限を選択",
                        modifier = Modifier.padding(start = 24.dp, top = 16.dp),
                    )
                },
            )
        }
    }
}

@Composable
private fun ScheduleDateField(
    label: String,
    value: LocalDate?,
    enabled: Boolean,
    stateDescription: String?,
    fieldTag: String,
    clearTag: String,
    onOpen: () -> Unit,
    onClear: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(
            onClick = onOpen,
            enabled = enabled,
            modifier = Modifier
                .weight(1f)
                .testTag(fieldTag)
                .semantics {
                    this.stateDescription = stateDescription ?: "$label: ${value ?: "未設定"}"
                },
        ) {
            Text("$label  ${value ?: "未設定"}")
        }
        TextButton(
            onClick = onClear,
            enabled = enabled && value != null,
            modifier = Modifier.testTag(clearTag),
        ) { Text("解除") }
    }
}

private fun String.toLocalDateOrNull(): LocalDate? = takeIf(String::isNotEmpty)?.let(LocalDate::parse)

private fun isTrueScheduleRange(startDate: LocalDate?, endDate: LocalDate?): Boolean =
    startDate != null && endDate != null && endDate.isAfter(startDate)

private fun scheduleDraftLabel(
    startDate: LocalDate?,
    endDate: LocalDate?,
    rangeSemantics: String,
): String = when {
    startDate == null && endDate == null -> "未設定"
    startDate == null -> "期限"
    endDate == null || startDate == endDate -> "実施日"
    rangeSemantics == "once_within_window" -> "期間内に一度"
    rangeSemantics == "ongoing" -> "期間中継続"
    else -> "期間未分類"
}

private fun scheduleConflictLabel(schedule: MobileTaskSchedule?): String = scheduleConflictLabel(
    startDate = schedule?.startDate,
    endDate = schedule?.endDate,
    rangeSemantics = schedule?.rangeSemantics,
)

private fun scheduleConflictLabel(schedule: MobileTaskScheduleDraft?): String = scheduleConflictLabel(
    startDate = schedule?.startDate,
    endDate = schedule?.endDate,
    rangeSemantics = schedule?.rangeSemantics,
)

private fun scheduleConflictLabel(
    startDate: String?,
    endDate: String?,
    rangeSemantics: String?,
): String {
    if (startDate == null && endDate == null) return "未設定"
    return buildList {
        startDate?.let { add("開始 $it") }
        endDate?.let { add("期限 $it") }
        if (startDate != null && endDate != null && endDate > startDate) {
            add(
                when (rangeSemantics) {
                    "once_within_window" -> "期間内に一度"
                    "ongoing" -> "期間中継続"
                    else -> "期間未分類"
                },
            )
        }
    }.joinToString(" / ")
}

private const val MillisPerDay = 86_400_000L

private fun LocalDate.toPickerMillis(): Long = toEpochDay() * MillisPerDay

private fun Long.toPickerLocalDate(): LocalDate = LocalDate.ofEpochDay(Math.floorDiv(this, MillisPerDay))

@Composable
private fun TaskThemePicker(
    taskId: String,
    themeId: String?,
    themes: List<MobileTheme>,
    catalogState: MobileThemeCatalogState,
    openRequest: Int = 0,
    allowUnassigned: Boolean = false,
    enabled: Boolean,
    stateDescription: String?,
    onThemeSelected: (String?) -> Unit,
) {
    val selectedTheme = themes.firstOrNull { it.id == themeId }
    val catalogAllowsSelection = catalogState is MobileThemeCatalogState.Available ||
        catalogState is MobileThemeCatalogState.Stale
    val pickerEnabled = enabled && catalogAllowsSelection && (themes.isNotEmpty() || allowUnassigned)
    val displayedState = stateDescription ?: selectedTheme?.let { "現在のTheme: ${it.title}" }
        ?: "現在のTheme情報なし"
    val emptyValue = when (catalogState) {
        is MobileThemeCatalogState.Loading -> "読み込み中"
        is MobileThemeCatalogState.Unsupported -> "未対応"
        is MobileThemeCatalogState.Error -> "取得できません"
        is MobileThemeCatalogState.Available,
        is MobileThemeCatalogState.Stale -> "Theme情報なし"
    }

    Column(
        modifier = Modifier.fillMaxWidth()
            .testTag("task-theme-picker")
            .semantics { this.stateDescription = displayedState },
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            "Theme${selectedTheme?.let { ": ${it.title}" } ?: ": $emptyValue"}",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(end = 20.dp),
        ) {
            if (allowUnassigned) {
                item(key = "theme-unassigned") {
                    FilterChip(
                        selected = themeId == null,
                        onClick = { if (themeId != null) onThemeSelected(null) },
                        label = { Text("Theme未指定") },
                        enabled = pickerEnabled,
                        modifier = Modifier.heightIn(min = 44.dp).testTag("task-theme-unassigned")
                            .semantics { selected = themeId == null },
                    )
                }
            }
            items(themes, key = { it.id }) { theme ->
                val isSelected = theme.id == themeId
                FilterChip(
                    selected = isSelected,
                    onClick = { if (!isSelected) onThemeSelected(theme.id) },
                    label = { Text(theme.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    leadingIcon = { ThemeColorDot(theme) },
                    trailingIcon = { if (isSelected) Text("選択中") },
                    enabled = pickerEnabled,
                    modifier = Modifier.heightIn(min = 44.dp).widthIn(max = 220.dp)
                        .semantics { selected = isSelected },
                )
            }
        }
    }
    val helperText = when (catalogState) {
        is MobileThemeCatalogState.Loading -> null
        is MobileThemeCatalogState.Available -> if (themes.isEmpty()) "利用できるThemeがありません。" else null
        is MobileThemeCatalogState.Stale -> "Theme一覧はオフラインです。変更は送信待ちになります。"
        is MobileThemeCatalogState.Unsupported -> "Desktopを更新するとThemeを変更できます。"
        is MobileThemeCatalogState.Error -> "接続を確認して再試行してください。"
    }
    if (helperText != null) {
        Text(
            helperText,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun themeTitleForDisplay(themes: List<MobileTheme>, themeId: String?): String =
    themes.firstOrNull { it.id == themeId }?.title ?: "Theme情報なし"

@Composable
private fun CenteredState(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) { content() }
}

private val TodayPaneStateSaver = Saver<TodayPaneState, List<Any?>>(
    save = { it.save() },
    restore = { TodayPaneState.restore(it) },
)

private suspend fun showCreateUndoSnackbar(
    snackbarHostState: SnackbarHostState,
    todayViewModel: TodayViewModel,
    captureDraftStore: MobileCaptureDraftStore,
    target: MobileCaptureUndoTarget,
    message: String,
    duration: SnackbarDuration = SnackbarDuration.Long,
) {
    val result = snackbarHostState.showSnackbar(
        message = message,
        actionLabel = "元に戻す",
        withDismissAction = true,
        duration = duration,
    )
    if (result == SnackbarResult.ActionPerformed) {
        todayViewModel.undoCreatedCapture(target.entityId, target.kind)
    }
    withContext(Dispatchers.IO) { captureDraftStore.clearUndoTarget() }
}

@Composable
internal fun rememberTodayPaneState(restoredCapture: MobileCaptureDraftSnapshot?): TodayPaneState =
    rememberSaveable(saver = TodayPaneStateSaver) {
        TodayPaneState(
            captureDraft = restoredCapture?.draft ?: MobileCaptureDraft.fresh(),
            captureOpen = restoredCapture?.captureOpen ?: false,
        )
    }
