package jp.personal.tasken.companion

import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 共通の辞書（写しはリポジトリの src/shared/searchdict/kotoba）を Kotlin で読む所と、端末の中の検索への効かせ方。
 * 写しそのもの（MANIFEST と dict）は試験の資源として、build で APK に入る dict は main の資源として読む。
 * 照合のキー・expand・find の例は、Desktop の tests/search-dictionary.test.mjs と同じ物を持つ
 * （片方を変えたら、もう片方も）。
 */
class KotobaTest {
    private fun copy(name: String): ByteArray =
        requireNotNull(javaClass.classLoader!!.getResourceAsStream("kotoba/$name")) { "写しに $name がありません" }.use { it.readBytes() }

    private fun copyText(name: String) = copy(name).toString(Charsets.UTF_8)

    @Test fun keyIsNfkcThenLowercase() {
        val examples = mapOf(
            "ＷｉＦｉ" to "wifi",
            "Wi-Fi" to "wi-fi",
            "ＡＢＣ１２３" to "abc123",
            "ｶﾞｲﾄﾞ" to "ガイド",
            "ガイド" to "ガイド",
            "①" to "1",
            "㈱" to "(株)",
            "ｷﾛ" to "キロ",
            "㌔" to "キロ",
            "引っ越し" to "引っ越し",
            "ひらがな カタカナ" to "ひらがな カタカナ",
            "全角　空白" to "全角 空白",
            "Ｓｔｒａßｅ" to "straße",
            "ÀÉ" to "àé",
        )
        for ((input, key) in examples) assertEquals("key($input)", key, kotobaKey(input))
        assertNotEquals("かなとカナは分けたまま", kotobaKey("かな"), kotobaKey("カナ"))
    }

    @Test fun theAppCarriesExactlyTheDictionaryOfTheCopy() {
        val files = copyText("MANIFEST").lines().map { it.split("\t") }.filter { it.size == 3 && it[0] == "file" }
        // このリポジトリは公開なので、写しに置いてよいのは一般の表記ゆれの表だけ。
        assertEquals(listOf("dict/alias.tsv"), files.map { it[1] })
        for ((_, name, sha256) in files) {
            val digest = MessageDigest.getInstance("SHA-256").digest(copy(name)).joinToString("") { "%02x".format(it) }
            assertEquals("$name が MANIFEST と合いません（写しは手で直さない）", sha256, digest)
            val bundled = requireNotNull(LocalSearchDictionary::class.java.getResourceAsStream("kotoba/${name.removePrefix("dict/")}")) {
                "build の資源に $name がありません（kotobaDictionaryResources）"
            }.use { it.readBytes().toString(Charsets.UTF_8) }
            assertEquals(name, copyText(name), bundled)
        }
        LocalSearchDictionary.load()
    }

    @Test fun expandWidensWholeTermsAndFindReadsFormsLongestFirst() {
        val sample = KotobaDictionary.load(mapOf("x.tsv" to listOf(
            "alias\t献立\tこんだて\tメニュー", "alias\tWi-Fi\tWiFi\t無線LAN",
        ).joinToString("\n")))
        val expansions = mapOf(
            "献立" to listOf("こんだて", "メニュー"),
            "こんだて" to listOf("献立", "メニュー"),
            "ﾒﾆｭｰ" to listOf("献立", "こんだて"),
            "ＷＩＦＩ" to listOf("Wi-Fi", "無線LAN"),
            "無線ｌａｎ" to listOf("Wi-Fi", "WiFi"),
            "旅行" to emptyList(),
            "献立表" to emptyList(),
        )
        for ((term, expected) in expansions) assertEquals("expand($term)", expected, sample.expand(term))
        val finds = mapOf(
            "献立とwifiとまた献立" to listOf("献立", "WiFi"),
            "ＷＩ－ＦＩのこんだて" to listOf("Wi-Fi", "こんだて"),
            "旅行の話" to emptyList(),
            "wifi6 と mywifi" to emptyList(),
            "(wifi)と献立表" to listOf("WiFi", "献立"),
        )
        for ((text, expected) in finds) assertEquals("find($text)", expected, sample.find(text))
        assertEquals(listOf(KotobaLocated(2, 2, "献立"), KotobaLocated(5, 4, "WiFi")), sample.locate("夜の献立とwifi"))
        val long = KotobaDictionary.load(mapOf("x.tsv" to "alias\t引っ越し\t引越し\nalias\t越し\t超し\n"))
        assertEquals(listOf("引っ越し"), long.find("引っ越しの日"))
    }

    @Test fun badLinesAndFormsLeadingToTwoGroupsAreFound() {
        val error = assertThrows(IllegalArgumentException::class.java) {
            KotobaDictionary.parse("x.tsv",
                "﻿# 説明\n\nsame\tA\tB\nalias\tA\nalias\tA\t\nalias\tA\tB C\nalias\t献立\tこんだて\r\nalias\t餅\tもち\nalias\tご飯\tごはん\n")
        }
        for (place in listOf("x.tsv:3", "x.tsv:4", "x.tsv:5", "x.tsv:6", "x.tsv:8")) assertTrue(place, error.message!!.contains(place))
        for (place in listOf("x.tsv:1:", "x.tsv:7", "x.tsv:9")) assertTrue(place, !error.message!!.contains(place))
        assertEquals(1, KotobaDictionary.parse("x.tsv", "alias\t献立\tこんだて\r\n").size)
        for ((name, text) in mapOf(
            "同じ行に2回" to "alias\tWiFi\twifi\n",
            "二つの alias" to "alias\t引越し\t引越\nalias\t引っ越し\t引越\n",
        )) {
            assertThrows(name, IllegalArgumentException::class.java) { KotobaDictionary.check(KotobaDictionary.parse("x.tsv", text)) }
        }
    }

    /** 辞書の形には asr（音声認識の崩れ）の行もある。その表はここには写さないが、同じ形のファイルを読んでも壊れない。 */
    @Test fun asrLinesAreReadButNotSearched() {
        val text = "alias\t議事録\tぎじろく\nasr\t議事録\t技術録\t記事録\n"
        assertEquals(listOf("alias", "asr"), KotobaDictionary.parse("x.tsv", text).map { it.kind })
        val sample = KotobaDictionary.load(mapOf("x.tsv" to text))
        assertEquals(listOf("ぎじろく"),sample.expand("議事録"))
        assertEquals(emptyList<String>(), sample.expand("技術録"))
        assertEquals(listOf("議事録"), sample.find("技術録と議事録"))
    }

    @Test fun localSearchFindsOtherSpellingsAfterTheWrittenOnes() {
        val dictionary = LocalSearchDictionary.load()
        assertEquals(listOf("引っ越し", "引越"), localSearchSpellings("引越し", dictionary))
        assertEquals(listOf("打ち合わせ", "打ち合せ"), localSearchSpellings("打合せ", dictionary))
        assertEquals(listOf("引っ越しの段取り", "引越の段取り"), localSearchSpellings("引越しの段取り", dictionary))
        assertEquals(emptyList<String>(), localSearchSpellings("宇宙", dictionary))

        val query = localSearchQuery("引越し", dictionary)
        assertEquals(LocalSearchMatch.Direct, query.match("引越しの段取りを決める"))
        assertEquals(LocalSearchMatch.Alias, query.match("来週の引っ越しの準備"))
        assertNull(query.match("献立を決める"))
        assertEquals(listOf("引越し", "引っ越し", "引越"), query.excerptTerms)
        assertEquals(LocalSearchMatch.Alias, localSearchQuery("打合せ", dictionary).match("来週の打ち合わせ"))

        val two = localSearchQuery("引越し 段取り", dictionary)
        assertEquals(LocalSearchMatch.Alias, two.match("引っ越しの段取り"))
        assertNull(two.match("引っ越しの準備"))
        assertEquals(LocalSearchMatch.Direct, localSearchQuery("ＷｉＦｉ", dictionary).match("ＷｉＦｉ"))
        assertEquals(LocalSearchMatch.Direct, localSearchQuery("ＷｉＦｉ", dictionary).match("WiFi の設定"))
        assertEquals(LocalSearchMatch.Alias, localSearchQuery("ＷｉＦｉ", dictionary).match("Wi-Fi の設定"))
        assertEquals(LocalSearchMatch.Direct, localSearchQuery("  ", dictionary).match("何でも"))
        assertNull("辞書が無ければ書いたままの語だけ", localSearchQuery("引越し", null).match("来週の引っ越し"))
        assertTrue(LocalSearchMatch.Direct < LocalSearchMatch.Alias)
    }
}
