# AI Provider Adapter boundary

Issue #281 のAI経路は、Rendererがprovider名やcredentialを扱わず、Mainのprofile resolver → adapter → provider APIという一方向の経路を通る。

## Profileとcredential

- `AiProviderProfile` と `AiModelProfile` は別エンティティとして保存する。
- defaultの正本は `defaultProviderProfileId` と `defaultModelProfileId` だけである。
- `ai-provider.json` は schema version 2。旧 `{ provider, model, encryptedApiKey }`（versionなし／既知の旧version）は最初の読み込み時にOpenAI profile/modelへ一方向移行する。将来versionは明示拒否し、既存ファイルを上書きしない。provider/model IDの重複も読み込み時に拒否する。
- credential本体はMainのElectron `safeStorage` で暗号化し、Renderer projectionは `credentialConfigured` だけを返す。RendererからMainへの保存commandに限り入力中の値を一方向に渡し、保存後のIPC応答、JSON、log、export、clipboardへ平文credentialを出さない。
- endpointはcredential-free URLだけを許可する。通常はHTTPS、Ollama等のlocal endpointだけlocalhost/loopbackのHTTPを許可する。
- generation timeoutはprofileごとに30〜600秒（既定120秒）、接続testは30秒で別管理する。local/private endpointはSettingsで明示する。

## Adapterの実装境界

現在実装するsurfaceはOpenAI Responses APIだけである。

| adapter kind | auth | surface | 状態 |
| --- | --- | --- | --- |
| `openai-native` | API key | Responses | 実装済み |
| `openai-compatible` | API key / bearer token | Responses | 実装済み |
| `azure-openai` | API key / bearer token | Responses | 実装済み |
| 上記3種 | 許可されたauth | `chat_completions` | profile表現のみ。未実装/unsupported |
| `anthropic` | API key | `native` (Messages) | profile表現のみ。未実装/unsupported |
| `gemini` | API key / bearer token | `native` (generateContent) | profile表現のみ。未実装/unsupported |
| `bedrock` | bearer token | `native` (Converse) | profile表現のみ。未実装/unsupported |
| `ollama` | none | Chat Completions | profile表現のみ。未実装/unsupported |

`model` はadapterへ渡すcanonical model identifierである。Azure OpenAI / Foundry v1ではAPI仕様上、これは基盤model名ではなくdeployment名として扱われる。provider profileの `deployment` は組織・resource metadataであり、モデル利用可否をそれだけで成功扱いにしない。

`native` はprovider固有のwire APIをadapter内部で実装するためのprofile surfaceであり、OpenAI Responsesとして送信する意味ではない。Settingsはadapter変更時に許容されるsurface/authへ正規化する。

capabilityは `adapter registry ∩ model profile申告` の結果だけをfeatureへ渡す。未実装surface・unavailable model・capability不足・credential未設定・接続失敗は別状態で返し、別providerへsilent fallbackしない。

## Canonical contract

`AiCanonicalRequest` はsystem/developer/user/assistant/tool message、text/image/file content parts、tools、tool choice、structured output schema、stream flagを持つ。provider固有wire objectはadapter内へ閉じる。

streamは `message_start`, `text_delta`, `tool_call_*`, `citation`, `usage`, `message_end`, `error` のprojectionへ正規化する。usage・request/response id・model/statusだけをraw metadataとして保持し、hidden reasoningやcredentialは保持しない。

## 公式一次資料

- [OpenAI API OpenAPI specification](https://github.com/openai/openai-openapi)
- [OpenAI Responses streaming events](https://platform.openai.com/docs/api-reference/responses-streaming/response/output_item/added)
- [OpenAI function-call argument streaming](https://platform.openai.com/docs/api-reference/responses-streaming/response/function_call_arguments)
- [OpenAI API quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request)
- [Azure OpenAI in Microsoft Foundry Models v1 API](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle)
- [How to switch between OpenAI and Azure OpenAI endpoints](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/switching-endpoints)
- [Microsoft Foundry model endpoints](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/endpoints)
