package jp.personal.tasken.companion

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 作業記録の AI 整理の案（#755 束9a でスマホから外した）。
 *
 * Room の表は残す（使わなくするだけで、表を落とすのは後）。前の版が送信待ちに残した採用の命令
 * （AdoptWorkLogOrganization）が届いたときだけ、その結果（adopted・discarded）をここへ書く。
 */
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
)
