import { z } from "zod";
import { normalizeAiVisibility, resolveAiVisibility } from "../../shared/aiMetadata.mjs";
import { canonicalThemeId } from "../../shared/themeRef.mjs";
import type { CommandEnvelope, CommandReceipt } from "../../shared/applicationCommand";
import type { Entity } from "../../shared/types/workspace";
import {
  savedCaptureOrganizationBatchSchema,
  savedCaptureOrganizationRequestSchema,
  savedCaptureOrganizationSubmissionSchema,
  type SavedCaptureOrganizationSource,
} from "../../shared/savedCaptureOrganization";
import type { CaptureOrganizerBatch, CaptureOrganizerInput } from "../gateway/mobile/public";

interface Options {
  repository: {
    get(type: string, id: string, includeDeleted?: boolean): Entity | null;
    list(type: string, includeDeleted?: boolean): Entity[];
    getPreference(key: string): unknown;
  };
  organize(input: CaptureOrganizerInput): Promise<CaptureOrganizerBatch>;
  executeCommands(commands: CommandEnvelope[]): CommandReceipt[];
}

/** Saved Capture is the source. Neither proposing nor adopting edits its text or lifecycle. */
export class SavedCaptureOrganizer {
  constructor(private readonly options: Options) {}

  private capture(id: string, version: number) {
    const entry = this.options.repository.get("capture_entry", id);
    if (!entry || entry.deleted_at)
      throw new Error("元のCaptureが削除されています。候補は保存していません。");
    if (Number(entry.version) !== version)
      throw new Error("元のCaptureが更新されています。開き直して整理してください。");
    if (entry.state !== "untriaged") throw new Error("未整理のCaptureを選んでください。");
    return entry;
  }

  private allowed(entity: Entity) {
    const theme = entity.project_id
      ? this.options.repository.get("theme", String(entity.project_id))
      : null;
    return resolveAiVisibility({
      entity,
      theme,
      workspaceDefault: normalizeAiVisibility(
        this.options.repository.getPreference("aiVisibilityDefault"),
      ),
    }).audiences.includes("external_ai");
  }

  source(id: string, version: number): SavedCaptureOrganizationSource {
    const entry = this.capture(
      z.string().min(1).max(200).parse(id),
      z.number().int().min(1).parse(version),
    );
    const properties = entry.properties_json as Record<string, unknown> | undefined;
    const capturedAt = String(entry.captured_at || "");
    const storedZone = properties?.capture_timezone;
    return {
      id,
      version,
      text: String(entry.text || ""),
      capturedAt,
      timeZone: typeof storedZone === "string" ? storedZone : "",
      themeId: typeof entry.project_id === "string" ? entry.project_id : null,
      canOrganize: this.allowed(entry),
    };
  }

  async organize(value: unknown) {
    const input = savedCaptureOrganizationRequestSchema.parse(value);
    const capture = this.capture(input.captureId, input.captureVersion);
    if (!this.allowed(capture))
      throw new Error("CaptureのAI公開範囲で「外部AI」を許可してから整理してください。");
    const theme = capture.project_id
      ? this.options.repository.get("theme", String(capture.project_id))
      : null;
    const themes =
      theme && this.allowed(theme)
        ? [{ id: theme.id, title: String(theme.name || theme.title || "Theme") }]
        : [];
    const result = savedCaptureOrganizationBatchSchema.parse(
      await this.options.organize({
        mode: "saved_capture",
        text: String(capture.text || ""),
        capturedAt: String(capture.captured_at || ""),
        timeZone: input.timeZone,
        themeId: themes[0]?.id || null,
        themes,
        maxTasks: 8,
        includePlannedTime: true,
      }),
    );
    if (!this.allowed(this.capture(input.captureId, input.captureVersion)))
      throw new Error("CaptureのAI公開範囲が変わりました。開き直してください。");
    if (
      themes.some((sentTheme) => {
        const current = this.options.repository.get("theme", sentTheme.id);
        return !current || !this.allowed(current);
      })
    )
      throw new Error("ThemeのAI公開範囲が変わりました。開き直してください。");
    if (
      result.tasks.some(
        (task) => task.themeId !== null && !themes.some((theme) => theme.id === task.themeId),
      )
    )
      throw new Error("AIのTheme候補が不正です。原文は保持されています。");
    return result;
  }

  save(value: unknown) {
    const submission = savedCaptureOrganizationSubmissionSchema.parse(value);
    const { submissionId, issuedAt, captureId, captureVersion, tasks, warnings } = submission;
    const existing = new Set(
      this.options.repository
        .list("change_event", true)
        .map((event) => String(event.command_id || ""))
        .filter((id) => id.startsWith(`${submissionId}-command-`)),
    );
    if (
      existing.size &&
      (existing.size !== tasks.length ||
        tasks.some((_, index) => !existing.has(`${submissionId}-command-${index}`)))
    )
      throw new Error("保存済みの候補集合を変更せずに再試行してください。");
    if (!existing.size) {
      try {
        if (!this.allowed(this.capture(captureId, captureVersion)))
          throw new Error("CaptureのAI公開範囲が変わりました。開き直してください。");
      } catch (error) {
        return { status: "not_saved" as const, message: (error as Error).message };
      }
    }
    // The command receipt owns replay: do not recheck a changed/deleted source before a committed replay.
    const commands: CommandEnvelope[] = tasks.map((proposal, index) => {
      const taskId = `${submissionId}-task-${index}`;
      const allWarnings = [...new Set([...warnings, ...proposal.warnings])];
      return {
        commandId: `${submissionId}-command-${index}`,
        name: "CreateTaskFromCapture",
        source: "inbox",
        actor: { kind: "user" },
        sessionId: submissionId,
        issuedAt,
        expectedVersions: [{ type: "capture_entry", id: captureId, version: captureVersion }],
        payload: {
          captureId,
          captureVersion,
          transition: "extract_task",
          task: {
            id: taskId,
            title: proposal.title,
            project_id: canonicalThemeId(proposal.themeId, { defaultPersonal: true }),
            state: "todo",
            priority: "normal",
            today_date: null,
            created_at: issuedAt,
            description:
              [
                proposal.supplement && `# 補足\n${proposal.supplement}`,
                allWarnings.length && `# 確認事項\n${allWarnings.join("\n")}`,
              ]
                .filter(Boolean)
                .join("\n\n") || null,
            planned_start_time: proposal.plannedStartTime,
            planned_duration_minutes: proposal.plannedDurationMinutes,
            checklist_items: proposal.checklist.map((title, itemIndex) => ({
              id: `${taskId}-check-${itemIndex}`,
              title,
              done: false,
              sort_order: itemIndex,
              completed_at: null,
            })),
          },
          ...(proposal.startDate || proposal.endDate
            ? {
                schedule: {
                  id: `${submissionId}-schedule-${index}`,
                  owner_type: "task",
                  owner_id: taskId,
                  start_date: proposal.startDate,
                  end_date: proposal.endDate,
                  date_kind:
                    proposal.startDate &&
                    proposal.endDate &&
                    proposal.startDate !== proposal.endDate
                      ? "range"
                      : proposal.endDate && !proposal.startDate
                        ? "deadline"
                        : "point",
                  range_semantics: proposal.rangeSemantics,
                  confidence: "fixed",
                  granularity: "day",
                },
              }
            : {}),
        },
      };
    });
    return this.options.executeCommands(commands);
  }
}
