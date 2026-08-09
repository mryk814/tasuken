const MAX_HISTORY = 40;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

export function noteAiConversationId(noteId) {
  const id = stringValue(noteId).trim();
  return id ? `note-ai:${id}` : "";
}

export function markdownHeadingAt(markdownValue, offsetValue) {
  const markdown = stringValue(markdownValue).replace(/\r\n?/g, "\n");
  const offset = Math.max(0, Math.min(markdown.length, Number.isInteger(offsetValue) ? offsetValue : markdown.length));
  const prefix = markdown.slice(0, offset);
  let heading = "";
  for (const line of prefix.split("\n")) {
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) heading = match[2].trim();
  }
  return heading;
}

/** Rich editorのDOM heading indexをMarkdown上の安定したsection末尾へ写す。 */
export function markdownHeadingAnchor(markdownValue, headingIndexValue) {
  const markdown = stringValue(markdownValue).replace(/\r\n?/g, "\n");
  const headingIndex = Number.isInteger(headingIndexValue) ? headingIndexValue : -1;
  const matches = [...markdown.matchAll(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm)];
  const match = matches[headingIndex];
  if (!match) return { heading: "", offset: markdown.length };
  const level = match[1].length;
  const start = match.index || 0;
  const next = matches.slice(headingIndex + 1).find((candidate) => candidate[1].length <= level);
  const sectionEnd = next?.index ?? markdown.length;
  let offset = sectionEnd;
  while (offset > start && markdown[offset - 1] === "\n") offset -= 1;
  return { heading: match[2].trim(), offset };
}

/** Rich DOMの現在block内テキストを、同じMarkdown section内の実offsetへ写す。 */
export function markdownCaretAnchor(markdownValue, headingIndexValue, blockTextValue, prefixTextValue) {
  const markdown = stringValue(markdownValue).replace(/\r\n?/g, "\n");
  const headingIndex = Number.isInteger(headingIndexValue) ? headingIndexValue : -1;
  const headings = [...markdown.matchAll(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm)];
  const heading = headings[headingIndex];
  const level = heading?.[1]?.length || 0;
  const sectionStart = heading ? (heading.index || 0) + heading[0].length : 0;
  const next = heading
    ? headings.slice(headingIndex + 1).find((candidate) => candidate[1].length <= level)
    : headings[0];
  const sectionEnd = next?.index ?? markdown.length;
  const section = markdown.slice(sectionStart, sectionEnd);
  const blockText = stringValue(blockTextValue).replace(/\s+/g, " ").trim();
  const prefix = stringValue(prefixTextValue).replace(/\s+/g, " ");
  if (blockText) {
    const exact = section.indexOf(blockText);
    if (exact >= 0 && section.indexOf(blockText, exact + 1) < 0) {
      return { heading: heading?.[2]?.trim() || "", offset: sectionStart + exact + Math.min(prefix.length, blockText.length) };
    }
  }
  for (let length = Math.min(prefix.length, 80); length > 0; length -= 1) {
    const suffix = prefix.slice(-length);
    const found = section.indexOf(suffix);
    if (found >= 0 && section.indexOf(suffix, found + 1) < 0) {
      return { heading: heading?.[2]?.trim() || "", offset: sectionStart + found + suffix.length };
    }
  }
  return markdownHeadingAnchor(markdown, headingIndex);
}

export function proposalNoteId(proposalValue) {
  const proposal = objectValue(proposalValue);
  const request = objectValue(proposal.request);
  const target = objectValue(request.target);
  if (target.type === "note") return stringValue(target.id);
  const payload = objectValue(proposal.payload);
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  return stringValue(objectValue(notes[0]).target_id);
}

export function proposalResponseText(proposalValue) {
  const proposal = objectValue(proposalValue);
  const response = objectValue(proposal.response);
  if (stringValue(response.text)) return stringValue(response.text);
  const payload = objectValue(proposal.payload);
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  return stringValue(objectValue(notes[0]).body);
}

export function buildNoteAiHistory(noteValue, proposalsValue) {
  const note = objectValue(noteValue);
  const proposals = Array.isArray(proposalsValue) ? proposalsValue : [];
  const proposalEntries = proposals
    .filter((proposal) => !objectValue(proposal).deleted_at && proposalNoteId(proposal) === note.id)
    .map((proposalValue) => {
      const proposal = objectValue(proposalValue);
      const request = objectValue(proposal.request);
      const provenance = objectValue(request.provenance);
      const response = objectValue(proposal.response);
      return {
        id: stringValue(proposal.id),
        kind: "proposal",
        prompt: stringValue(request.instruction) || stringValue(objectValue(objectValue(proposal.payload).notes?.[0]).reason),
        response: proposalResponseText(proposal),
        status: stringValue(proposal.status) || "pending",
        created_at: stringValue(response.generated_at) || stringValue(proposal.created_at),
        provider: stringValue(provenance.providerLabel) || stringValue(proposal.source_app),
        model: stringValue(provenance.model),
        proposal,
      };
    });
  const properties = objectValue(note.properties_json);
  const workspace = objectValue(properties.draft_workspace);
  const sources = Array.isArray(workspace.sources) ? workspace.sources : [];
  const legacyEntries = sources.map((sourceValue, index) => {
    const source = objectValue(sourceValue);
    return {
      id: stringValue(source.id) || `legacy-${index}`,
      kind: "legacy_draft",
      prompt: stringValue(source.instruction),
      response: stringValue(source.body),
      status: "historical",
      created_at: stringValue(source.created_at),
      provider: stringValue(source.ai_service) || "AI Draft",
      model: "",
      proposal: null,
    };
  });
  return [...legacyEntries, ...proposalEntries]
    .filter((entry) => entry.response)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(-MAX_HISTORY);
}

export function buildNoteAiProposal({ id, note, instruction, request, result, generatedAt }) {
  const noteValue = objectValue(note);
  return {
    id: stringValue(id),
    source: "embedded_llm",
    source_app: `${stringValue(result.providerLabel)}:${stringValue(result.model)}`,
    payload_type: "notes",
    status: "pending",
    payload: {
      notes: [{
        action: "merge",
        target_id: stringValue(noteValue.id),
        base_version: Number(noteValue.version) || 1,
        title: stringValue(noteValue.title) || "無題",
        body: stringValue(result.proposedBody),
        reason: stringValue(instruction).trim(),
      }],
    },
    request: {
      conversation_id: noteAiConversationId(noteValue.id),
    instruction: stringValue(instruction).trim(),
      scope: request.scope,
      context: request.context,
      target: { type: "note", id: stringValue(noteValue.id), base_version: Number(noteValue.version) || 1 },
      provenance: {
        providerProfileId: result.providerProfileId,
        providerLabel: result.providerLabel,
        adapterKind: result.adapterKind,
        modelProfileId: result.modelProfileId,
        model: result.model,
        capabilityPath: result.capabilityPath,
      },
    },
    response: {
      text: stringValue(result.responseText),
      generated_at: stringValue(generatedAt),
      usage: result.usage || null,
    },
  };
}

export function noteAiSecretWarning(value) {
  const text = stringValue(value);
  if (!text) return "";
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return "秘密鍵らしき文字列が含まれています。送信対象を確認してください。";
  if (/(api[-_]?key|authorization|password|secret|token)\s*[:=]\s*\S+/i.test(text)) return "credentialらしき文字列が含まれています。送信対象を確認してください。";
  return "";
}
