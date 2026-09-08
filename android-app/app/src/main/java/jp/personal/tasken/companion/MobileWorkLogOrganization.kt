package jp.personal.tasken.companion

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

@Serializable
data class MobileWorkLogOrganization(
    val done: List<String>, val observations: List<String>, val unresolved: List<String>, val nextActions: List<String>,
) {
    fun validate(source: String) {
        require(done.size <= 10 && observations.size <= 10 && unresolved.size <= 10 && nextActions.size <= 3)
        require(nextActions.all { it.length <= 500 })
        val sentences = source.split(Regex("(?<=[。！？])\\s*|\\r?\\n")).map(String::trim).filter(String::isNotBlank)
        val quotes = done + observations + unresolved + nextActions
        require(quotes.isNotEmpty() && quotes.all { it.isNotBlank() && it.length <= 12000 && it in sentences })
    }
}

@Serializable
data class MobileWorkLogOrganizationResponse(val ok: Boolean, val meta: MobileResponseMetaDto, val data: MobileWorkLogOrganizationData)
@Serializable
data class MobileWorkLogOrganizationData(val sourceId: String, val sourceVersion: Int, val proposal: MobileWorkLogOrganization, val providerLabel: String)

@Entity(tableName = "work_log_organization")
data class WorkLogOrganizationEntity(
    @PrimaryKey val sourceId: String,
    val serverId: String,
    val sourceVersion: Int,
    val generationId: String,
    val issuedAt: String,
    val state: String,
    val proposalJson: String?,
    val createdTaskIndices: String = "",
) {
    fun proposal(): MobileWorkLogOrganization? = proposalJson?.let { MobileWorkLogContract.json.decodeFromString<MobileWorkLogOrganization>(it) }
}

interface MobileWorkLogOrganizationRepository {
    suspend fun organizeWorkLog(id: String)
    suspend fun discardWorkLogOrganization(id: String)
    suspend fun adoptWorkLogOrganization(id: String)
    suspend fun createWorkLogNextAction(id: String, index: Int)
}
