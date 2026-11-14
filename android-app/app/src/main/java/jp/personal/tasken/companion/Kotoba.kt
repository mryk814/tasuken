package jp.personal.tasken.companion

import java.text.Normalizer

/**
 * 共通の辞書（写しはリポジトリの src/shared/searchdict/kotoba）を Kotlin で読む。
 *
 * 写しは一般の表記ゆれ（dict/alias.tsv）だけで、辞書を読む側の決まりはここに持つ: 照合のキー（NFKC にしてから
 * 小文字）、行の決まり、語を丸ごと広げる expand、文の中の書き方を読み出す find。Desktop の
 * src/shared/searchdict/kotoba.ts と同じ形にしてある。片方を直したら、もう片方も読み合わせて直す。
 * 決まりは KotobaTest と Desktop の tests/search-dictionary.test.mjs が、同じ例で確かめる。
 *
 * 辞書の形には、種類の列に alias のほかに asr（音声認識の崩れ）がある。その表は公開のこのリポジトリには
 * 写さないので、探すのには使わない。行としては読めて、誤りにはしない（同じ形の辞書のファイルを読んでも
 * 壊れないように）。
 */

/** 照合のキー: NFKC にしてから小文字。 */
internal fun kotobaKey(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC).lowercase()

internal data class KotobaLine(val file: String, val num: Int, val kind: String, val forms: List<String>) {
    val at get() = "$file:$num"
}

/** 文の中で見つけた書き方。[at] と [length] はキーの code point で数える。 */
internal data class KotobaLocated(val at: Int, val length: Int, val form: String)

internal class KotobaDictionary private constructor(lines: List<KotobaLine>) {
    private val spellings = mutableMapOf<String, List<String>>()
    private val forms: List<Pair<String, IntArray>>

    init {
        val all = mutableListOf<Pair<String, IntArray>>()
        // asr の行は探すのに使わない（このファイルの頭の説明）。
        for (line in lines.filter { it.kind == "alias" }) {
            for (form in line.forms) {
                val key = kotobaKey(form)
                spellings[key] = line.forms
                all += form to key.codePoints().toArray()
            }
        }
        // find は長い書き方から見る（sortedByDescending は安定）。
        forms = all.sortedByDescending { it.second.size }
    }

    /** 問いの語のほかの書き方（その語自身は含めない）。語が辞書の書き方そのものでなければ空。 */
    fun expand(term: String): List<String> {
        val own = kotobaKey(term)
        return spellings[own].orEmpty().filter { kotobaKey(it) != own }
    }

    /** 文の中の書き方を、長い方から重ならないように見つけ、書いてある順に返す。 */
    fun locate(text: String): List<KotobaLocated> {
        val key = kotobaKey(text).codePoints().toArray()
        val used = BooleanArray(key.size)
        val found = mutableListOf<KotobaLocated>()
        for ((form, formKey) in forms) {
            val size = formKey.size
            var index = 0
            while (index + size <= key.size) {
                val same = (0 until size).all { key[index + it] == formKey[it] && !used[index + it] }
                // 英字・数字の書き方は、語の丸ごとのときだけ数える（wifi6・mywifi の中の wifi は数えない）。
                val edge = (index > 0 && isLatin(formKey[0]) && isLatin(key[index - 1])) ||
                    (index + size < key.size && isLatin(formKey[size - 1]) && isLatin(key[index + size]))
                if (same && !edge) {
                    for (offset in 0 until size) used[index + offset] = true
                    found += KotobaLocated(index, size, form)
                }
                index++
            }
        }
        return found.sortedBy { it.at }
    }

    fun find(text: String): List<String> = locate(text).map { it.form }.distinct()

    companion object {
        /** 写しの dict の中身（ファイル名 → 中身）をまとめて読み、確かめてから辞書を作る。 */
        fun load(files: Map<String, String>): KotobaDictionary {
            require(files.isNotEmpty()) { "dict/*.tsv がありません" }
            val lines = mutableListOf<KotobaLine>()
            val errors = mutableListOf<String>()
            for (name in files.keys.sorted()) {
                try {
                    lines += parse(name, files.getValue(name))
                } catch (error: IllegalArgumentException) {
                    errors += error.message.orEmpty()
                }
            }
            require(errors.isEmpty()) { errors.joinToString("\n") }
            check(lines)
            return KotobaDictionary(lines)
        }

        /** 辞書のファイルを一つ読む。誤りの行があれば、見つけた誤りをすべて載せて投げる。 */
        fun parse(file: String, text: String): List<KotobaLine> {
            val lines = mutableListOf<KotobaLine>()
            val errors = mutableListOf<String>()
            text.split("\n").forEachIndexed { index, row ->
                var value = row.removeSuffix("\r")
                if (index == 0) value = value.removePrefix("﻿")
                if (value.isBlank() || value.startsWith("#")) return@forEachIndexed
                val fields = value.split("\t")
                val line = KotobaLine(file, index + 1, fields[0], fields.drop(1))
                when {
                    line.kind != "alias" && line.kind != "asr" -> errors += "${line.at}: 種類は alias か asr です（${line.kind}）"
                    line.forms.size < 2 -> errors += "${line.at}: 書き方が2つ以上要ります"
                    line.forms.any { form -> form.isEmpty() || form.codePoints().anyMatch(::isSpace) } ->
                        errors += "${line.at}: 空の書き方か、空白を含む書き方があります"
                    line.forms.any(::isShortKana) -> errors += "${line.at}: かなだけで2文字以下の書き方は、ほかの語の一部に当たるので置きません"
                    else -> lines += line
                }
            }
            require(errors.isEmpty()) { errors.joinToString("\n") }
            return lines
        }

        /** どの書き方も一つの組にしか行かないことを確かめる: 同じ行に同じ書き方は一度だけ、一つのキーは alias の一行にだけ。 */
        fun check(lines: List<KotobaLine>) {
            val errors = mutableListOf<String>()
            val aliasAt = mutableMapOf<String, String>()
            for (line in lines) {
                val seen = mutableSetOf<String>()
                line.forms.forEach { if (!seen.add(kotobaKey(it))) errors += "${line.at}: \"$it\" が同じ行に2回あります" }
                if (line.kind != "alias") continue
                for (form in line.forms) {
                    val previous = aliasAt[kotobaKey(form)]
                    if (previous != null && previous != line.at) errors += "${line.at}: \"$form\" は $previous にもあります"
                    aliasAt[kotobaKey(form)] = line.at
                }
            }
            require(errors.isEmpty()) { errors.sorted().joinToString("\n") }
        }

        // 和文の空白は数で書く（見た目では半角の空白と区別できないため）。
        private fun isSpace(codePoint: Int) = codePoint == ' '.code || codePoint == 0x3000 || codePoint < 0x20

        // 短い書き方は部分一致で、ほかの語の一部に当たる（もち が もちろん・気持ち に）。
        private fun isShortKana(form: String): Boolean {
            val points = Normalizer.normalize(form, Normalizer.Form.NFKC).codePoints().toArray()
            return points.size <= 2 && points.all { point ->
                val script = Character.UnicodeScript.of(point)
                script == Character.UnicodeScript.HIRAGANA || script == Character.UnicodeScript.KATAKANA || point == 'ー'.code
            }
        }

        // 英字か数字（キーは全角を半角にするので、ASCII だけを見ればよい）。
        private fun isLatin(codePoint: Int) = codePoint < 0x80 && Character.isLetterOrDigit(codePoint)
    }
}
