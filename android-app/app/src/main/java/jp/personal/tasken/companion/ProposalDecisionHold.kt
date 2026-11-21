package jp.personal.tasken.companion

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicLong

/**
 * 押してから送るまで端末に持っている採否（#774）。`key` は押した 1 回ごとの番号。
 * decision は "accept"（採る）か "reject"（見送る）。
 */
data class HeldProposalDecision(
    val key: Long,
    val proposalId: String,
    val decision: String,
    val pressedAtMillis: Long,
)

const val PROPOSAL_DECISION_HOLD_MILLIS = 5_000L

/**
 * 採る・見送るを、押してから [holdMillis] の間は送らずに持ち、その後で押した順に 1 件ずつ送る（#774）。
 *
 * - 持っている間は帯（[band]）に出し、[undo] で止められる。止めたら何も送らない。
 * - 送るのは 1 件ずつ、押した順。1 件ごとに「前の 1 件が終わった」印を待ってから送る（前の答えが来るまで次を送らない）。
 *   錠（Mutex）の順番待ちにすると、同じ頃に押した 2 件の待ちが別のスレッドで明けた時に順が入れ替わる（試験で見えた）。
 * - 送って届かなかった（断られた・切れた）1 件は、カードを戻して（[decided] から外して）知らせる。後ろの物は続ける。
 * - 持っている間につながりが切れたら、送らずにカードを戻して知らせる。
 *
 * 採否は Proposal と Task の版を Desktop で突き合わせるので、つながらない間は持たない（呼び出し側が押させない）。
 * 持っている決定は端末に書かない。5 秒の間にアプリが閉じれば決定は無かったことになり、提案は未決のまま残る。
 */
class ProposalDecisionHold(
    private val scope: CoroutineScope,
    private val online: StateFlow<Boolean>,
    private val onNotSent: (HeldProposalDecision, String) -> Unit,
    private val holdMillis: Long = PROPOSAL_DECISION_HOLD_MILLIS,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutableHeld = MutableStateFlow<List<HeldProposalDecision>>(emptyList())
    /** 押した後、まだ送り終えていない採否（押した順）。 */
    val held: StateFlow<List<HeldProposalDecision>> = mutableHeld.asStateFlow()
    private val mutableDecided = MutableStateFlow<Map<String, String>>(emptyMap())
    /** 一覧から外して見せる提案と、その決定（持っている間と、届いた後）。 */
    val decided: StateFlow<Map<String, String>> = mutableDecided.asStateFlow()
    private val mutableBand = MutableStateFlow<HeldProposalDecision?>(null)
    /** 帯に出す決定（押してから holdMillis の間だけ）。 */
    val band: StateFlow<HeldProposalDecision?> = mutableBand.asStateFlow()

    private val keys = AtomicLong()
    private val lock = Any()
    private val jobs = mutableMapOf<Long, Job>()
    private val sending = mutableSetOf<Long>()
    /** いちばん最後に押した 1 件が終わった印。次に押した物はこれを待つ。 */
    private var tail: CompletableDeferred<Unit> = CompletableDeferred(Unit)

    /**
     * 押した 1 件を持つ。[send] は届いたら true、届かなかったら false を返す（理由は send が知らせる）。
     * 同じ提案がもう決められていれば何もしない（null）。
     */
    fun hold(proposalId: String, decision: String, send: suspend () -> Boolean): HeldProposalDecision? {
        val done = CompletableDeferred<Unit>()
        val (held, before) = synchronized(lock) {
            if (proposalId in mutableDecided.value) return null
            val held = HeldProposalDecision(keys.incrementAndGet(), proposalId, decision, now())
            mutableHeld.update { it + held }
            mutableDecided.update { it + (proposalId to decision) }
            mutableBand.value = held
            val before = tail
            tail = done
            held to before
        }
        val job = scope.launch {
            try {
                val disconnected = withTimeoutOrNull(holdMillis) { online.first { !it } } != null
                mutableBand.update { if (it?.key == held.key) null else it }
                if (disconnected) {
                    release(held, comeBack = true)
                    onNotSent(held, "つながりが切れたので送りませんでした。つながってから、もう一度決めてください。")
                    return@launch
                }
                before.await()
                synchronized(lock) {
                    if (mutableHeld.value.none { it.key == held.key }) return@launch
                    sending += held.key
                }
                val delivered = try {
                    send()
                } finally {
                    synchronized(lock) { sending -= held.key }
                }
                release(held, comeBack = !delivered)
            } finally {
                // 取り消して早く終わった時も、前の 1 件が終わるまでは「終わった」にしない（後ろが追い越さない）。
                before.invokeOnCompletion { done.complete(Unit) }
            }
        }
        synchronized(lock) {
            // 押した直後に取り消された時は、もう外れている。
            if (mutableHeld.value.any { it.key == held.key }) jobs[held.key] = job else job.cancel()
        }
        return held
    }

    /** 帯の「取り消す」。まだ送り始めていなければ何も送らず、カードを戻す。外せたら true。 */
    fun undo(key: Long): Boolean {
        val held = synchronized(lock) {
            if (key in sending) return false
            mutableHeld.value.firstOrNull { it.key == key } ?: return false
        }
        synchronized(lock) { jobs[key] }?.cancel()
        mutableBand.update { if (it?.key == key) null else it }
        release(held, comeBack = true)
        return true
    }

    private fun release(held: HeldProposalDecision, comeBack: Boolean) {
        synchronized(lock) {
            jobs.remove(held.key)
            mutableHeld.update { list -> list.filterNot { it.key == held.key } }
            if (comeBack) mutableDecided.update { it - held.proposalId }
        }
    }
}
