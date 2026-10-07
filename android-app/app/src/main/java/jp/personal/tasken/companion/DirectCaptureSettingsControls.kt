package jp.personal.tasken.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DirectAiSettingsSheet(
    store: DirectCaptureSettingsStore,
    onChanged: (DirectCaptureSettings) -> Unit,
    onDismiss: () -> Unit,
) {
    var settings by remember(store) { mutableStateOf(store.settings()) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        contentWindowInsets = { WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top) },
    ) {
        Column(
            Modifier.fillMaxWidth().fillMaxHeight(0.9f)
                .verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("PCなしで整理する設定", style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("direct-ai-settings-title"))
            // 説明は1文に絞る。送るもの・キーの扱いは下の欄の近くで1度だけ伝える。
            Text(
                "PCがオフでも、この端末から選んだAIへ直接送って整理できます。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            DirectCaptureSettingsControls(settings, store, true, initiallyOpen = true, showToggle = false) { settings = it; onChanged(it) }
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.End).testTag("direct-ai-settings-close"),
            ) { Text("閉じる") }
        }
    }
}

@Composable
internal fun DirectCaptureSettingsControls(
    settings: DirectCaptureSettings,
    store: DirectCaptureSettingsStore,
    enabled: Boolean,
    initiallyOpen: Boolean = false,
    showToggle: Boolean = true,
    onChanged: (DirectCaptureSettings) -> Unit,
) {
    var open by remember(initiallyOpen) { mutableStateOf(initiallyOpen) }
    var editing by remember(settings) { mutableStateOf(settings) }
    // API keys must not enter saved-instance state or Draft persistence.
    var apiKey by remember { mutableStateOf("") }
    var consent by remember(settings) { mutableStateOf(settings.enabled) }
    var menuOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var probing by remember { mutableStateOf(false) }
    var probeMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun update(action: () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) { action() }
                onChanged(store.settings())
                apiKey = ""
                open = false
            } catch (_: Exception) {
                error = "AI設定を保存できません。サービス・対応モデル・接続先・APIキーを確認してください。入力は保持しています。"
            } finally { busy = false }
        }
    }
    fun probe() {
        probeMessage = null
        val target = editing.copy(enabled = true)
        if (runCatching { target.destination() }.isFailure) {
            probeMessage = "Structured Outputs対応のモデルと接続先を指定してください。"
            return
        }
        val entered = apiKey.trim()
        val reuseStored = settings.hasApiKey && settings.provider == editing.provider && settings.endpoint == editing.endpoint
        if (entered.isEmpty() && !reuseStored) {
            probeMessage = "APIキーを入力してください。"
            return
        }
        probing = true
        scope.launch {
            try {
                val key: () -> String = { if (entered.isNotEmpty()) entered else store.apiKey(editing) }
                probeMessage = withContext(Dispatchers.IO) { testDirectCaptureConnection(target, key) }
            } catch (_: Exception) {
                probeMessage = "APIキーを入力してください。"
            } finally { probing = false }
        }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (showToggle) {
            TextButton(onClick = { open = !open; if (!open) apiKey = "" }, enabled = enabled && !busy,
                modifier = Modifier.align(Alignment.End).testTag("capture-direct-ai-settings")) {
                Text(if (open) "AndroidのAI設定を閉じる" else "PCなしで整理する設定")
            }
        }
        if (open) {
            // いまどちらへ送っているかを先に1行で示す。
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth().testTag("capture-ai-destination"),
            ) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("いまの送信先", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        if (settings.enabled) "${settings.provider.label}（この端末から直接・PCオフでも使えます）" else "Desktopで設定したAI（PCオフでは使えません）",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            if (showToggle) Text("Android専用のAI設定", style = MaterialTheme.typography.titleSmall)
            Text(
                "送るもの: 文字・録音時刻・Theme名・添付写真。API利用料がかかる場合があります。キーはこの端末だけに暗号化して保存します。Desktopのキーが転送されることはなく、同期やExportにも含めません。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text("サービス", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 4.dp))
            Box {
                OutlinedButton(onClick = { menuOpen = true }, enabled = !busy,
                    modifier = Modifier.testTag("direct-ai-provider")) { Text("${editing.provider.label}  ▾") }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    CaptureAiProvider.entries.forEach { provider -> DropdownMenuItem(text = { Text(provider.label) }, onClick = {
                        editing = editing.copy(provider = provider, model = "", endpoint = "")
                        apiKey = ""
                        menuOpen = false
                    }) }
                }
            }
            val destination = runCatching { editing.destination() }.getOrNull()
            // 補足は欄の直下（supportingText）に置き、欄と説明の対応を崩さない。
            OutlinedTextField(editing.model, { editing = editing.copy(model = it.trim()) },
                label = { Text(if (editing.provider == CaptureAiProvider.Azure) "デプロイ名" else "モデルID") },
                supportingText = {
                    Text(
                        directCaptureChatModels[editing.provider]?.let { "例: ${it.joinToString("、")}" }
                            ?: "Structured Outputs対応のモデルを指定してください。",
                    )
                },
                singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("direct-ai-model"))
            if (editing.provider == CaptureAiProvider.Azure) OutlinedTextField(editing.endpoint,
                { editing = editing.copy(endpoint = it.trim()) }, label = { Text("Azure HTTPS接続先") },
                placeholder = { Text("https://YOUR-RESOURCE.openai.azure.com/") },
                singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("direct-ai-endpoint"))
            if (destination != null) {
                Text("接続先: $destination", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (editing.model.isNotEmpty()) {
                Text("Structured Outputs対応のモデルを指定してください。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            OutlinedTextField(apiKey, { apiKey = it }, label = { Text("APIキー") },
                placeholder = { Text(if (settings.hasApiKey && settings.provider == editing.provider && settings.endpoint == editing.endpoint) "空欄で保存済みキーを使用" else "この端末用のキーを入力") },
                visualTransformation = PasswordVisualTransformation(), singleLine = true, enabled = !busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth().testTag("direct-ai-key"))
            OutlinedTextField(editing.vocabulary, { if (it.length <= 4000) editing = editing.copy(vocabulary = it) },
                label = { Text("音声・固有語辞書（任意）") }, minLines = 2, maxLines = 4, enabled = !busy,
                modifier = Modifier.fillMaxWidth().testTag("direct-ai-vocabulary"))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(consent, { consent = it }, enabled = !busy && !probing, modifier = Modifier.testTag("direct-ai-consent"))
                Text("この端末から選んだAIへ送信して整理する", style = MaterialTheme.typography.bodyMedium)
            }
            TextButton(
                onClick = { probe() },
                enabled = !busy && !probing && destination != null,
                modifier = Modifier.testTag("direct-ai-test"),
            ) { Text(if (probing) "確認中…" else "接続を確認") }
            probeMessage?.let {
                Text(
                    it,
                    color = if (it == "接続を確認しました。") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("direct-ai-test-result"),
                )
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("direct-ai-error")) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                if (settings.hasApiKey) TextButton(onClick = { update { store.clear() } }, enabled = !busy && !probing,
                    modifier = Modifier.testTag("direct-ai-delete")) { Text("設定を削除") }
                if (settings.enabled) TextButton(onClick = { update { store.disable() } }, enabled = !busy && !probing,
                    modifier = Modifier.testTag("direct-ai-disable")) { Text("Desktop経由へ戻す") }
                Button(onClick = { update { store.save(editing.copy(enabled = consent), apiKey) } },
                    enabled = !busy && !probing && destination != null, modifier = Modifier.testTag("direct-ai-save")) {
                    Text(if (busy) "保存中" else "設定を保存")
                }
            }
        }
    }
}
