package jp.personal.tasken.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
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

@Composable
internal fun DirectCaptureSettingsControls(
    settings: DirectCaptureSettings,
    store: DirectCaptureSettingsStore,
    enabled: Boolean,
    onChanged: (DirectCaptureSettings) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    var editing by remember(settings) { mutableStateOf(settings) }
    // API keys must not enter saved-instance state or Draft persistence.
    var apiKey by remember { mutableStateOf("") }
    var consent by remember(settings) { mutableStateOf(settings.enabled) }
    var menuOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
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
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            if (settings.enabled) "送信先: ${settings.provider.label}（Androidから直接）" else "送信先: Desktopで設定したAI",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("capture-ai-destination"),
        )
        TextButton(onClick = { open = !open; if (!open) apiKey = "" }, enabled = enabled && !busy,
            modifier = Modifier.align(Alignment.End).testTag("capture-direct-ai-settings")) {
            Text(if (open) "AndroidのAI設定を閉じる" else "PCなしで整理する設定")
        }
        if (open) {
            Text("Android専用のAI設定", style = MaterialTheme.typography.titleSmall)
            Text("PCがオフラインでも、Androidから選んだサービスへ通信して整理できます。文字・録音時刻・Theme名・添付写真を送信します。API利用料が発生する場合があります。",
                style = MaterialTheme.typography.bodySmall)
            Text("Desktopのキーはコピーされません。この端末に暗号化して保存し、同期・Exportには含めません。",
                style = MaterialTheme.typography.bodySmall)
            Box {
                OutlinedButton(onClick = { menuOpen = true }, enabled = !busy,
                    modifier = Modifier.testTag("direct-ai-provider")) { Text(editing.provider.label) }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    CaptureAiProvider.entries.forEach { provider -> DropdownMenuItem(text = { Text(provider.label) }, onClick = {
                        editing = editing.copy(provider = provider, model = "", endpoint = "")
                        apiKey = ""
                        menuOpen = false
                    }) }
                }
            }
            OutlinedTextField(editing.model, { editing = editing.copy(model = it.trim()) },
                label = { Text(if (editing.provider == CaptureAiProvider.Azure) "デプロイ名" else "モデルID") },
                singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("direct-ai-model"))
            directCaptureChatModels[editing.provider]?.let { models ->
                Text("Chat Completions対応: ${models.joinToString("、")}", style = MaterialTheme.typography.bodySmall)
            }
            if (editing.provider == CaptureAiProvider.Azure) OutlinedTextField(editing.endpoint,
                { editing = editing.copy(endpoint = it.trim()) }, label = { Text("Azure HTTPS接続先") },
                placeholder = { Text("https://YOUR-RESOURCE.openai.azure.com/") },
                singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("direct-ai-endpoint"))
            val destination = runCatching { editing.destination() }.getOrNull()
            if (destination != null) Text("接続先: $destination", style = MaterialTheme.typography.bodySmall)
            else Text("Structured Outputs対応のモデルを指定してください。", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(apiKey, { apiKey = it }, label = { Text("APIキー") },
                placeholder = { Text(if (settings.hasApiKey && settings.provider == editing.provider && settings.endpoint == editing.endpoint) "空欄で保存済みキーを使用" else "この端末用のキーを入力") },
                visualTransformation = PasswordVisualTransformation(), singleLine = true, enabled = !busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth().testTag("direct-ai-key"))
            OutlinedTextField(editing.vocabulary, { if (it.length <= 4000) editing = editing.copy(vocabulary = it) },
                label = { Text("音声・固有語辞書（任意）") }, minLines = 2, maxLines = 4, enabled = !busy,
                modifier = Modifier.fillMaxWidth().testTag("direct-ai-vocabulary"))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(consent, { consent = it }, enabled = !busy, modifier = Modifier.testTag("direct-ai-consent"))
                Text("この端末から選んだAIへ送信して整理する", style = MaterialTheme.typography.bodyMedium)
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("direct-ai-error")) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                if (settings.hasApiKey) TextButton(onClick = { update { store.clear() } }, enabled = !busy,
                    modifier = Modifier.testTag("direct-ai-delete")) { Text("設定を削除") }
                if (settings.enabled) TextButton(onClick = { update { store.disable() } }, enabled = !busy,
                    modifier = Modifier.testTag("direct-ai-disable")) { Text("Desktop経由へ戻す") }
                Button(onClick = { update { store.save(editing.copy(enabled = consent), apiKey) } },
                    enabled = !busy && destination != null, modifier = Modifier.testTag("direct-ai-save")) {
                    Text(if (busy) "保存中" else "設定を保存")
                }
            }
        }
    }
}
