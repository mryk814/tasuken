package jp.personal.tasken.companion

internal fun themeContextFixture() = MobileThemeContext(
    id = "theme-context-fixture", title = "測定方法を見直す", version = 3, updatedAt = "2026-09-06T07:00:00Z",
    charter = MobileThemeCharter("tasken-theme-charter/v1", "少量の試料でも再現性のある測定を行う。", "測定条件と誤差の関係を説明できる。",
        listOf("生データを残す", "条件を一つずつ変える"), "試料調製と測定条件の比較", listOf("装置の新規開発"),
        listOf("微量成分を安定して検出できるか"), listOf("誤差の伝播")),
    currentState = MobileThemeCurrentState("tasken-theme-state/v1", "温度を固定して希釈条件を比較する。", listOf("希釈倍率でばらつきが変わるか"),
        listOf("前処理を揃えると誤差が減る"), listOf("比較用試料の到着待ち"), listOf("繰り返し数を決める"), "別の測定法と比較する。", "2026-09-06T06:00:00Z"),
)
