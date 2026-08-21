export function stableProposalEntityId(proposalId, type, index) {
  const input = `${proposalId}\0${type}\0${index}`;
  let state = 0x811c9dc5;
  let hex = "";
  for (let round = 0; round < 4; round += 1) {
    for (let offset = 0; offset < input.length; offset += 1) {
      state ^= input.charCodeAt(offset) + round;
      state = Math.imul(state, 0x01000193);
    }
    hex += (state >>> 0).toString(16).padStart(8, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function rawMarkdownDiff(before, after) {
  const oldLines = String(before).replace(/\r\n?/g, "\n").split("\n");
  const newLines = String(after).replace(/\r\n?/g, "\n").split("\n");
  if (oldLines.length * newLines.length > 1_500_000) {
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
      && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix += 1;
    return [
      ...oldLines.slice(0, prefix).map((text) => ({ kind: "same", text })),
      ...oldLines.slice(prefix, oldLines.length - suffix).map((text) => ({ kind: "removed", text })),
      ...newLines.slice(prefix, newLines.length - suffix).map((text) => ({ kind: "added", text })),
      ...oldLines.slice(oldLines.length - suffix).map((text) => ({ kind: "same", text })),
    ];
  }
  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }
  const result = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      result.push({ kind: "same", text: oldLines[oldIndex++] });
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      result.push({ kind: "removed", text: oldLines[oldIndex++] });
    } else {
      result.push({ kind: "added", text: newLines[newIndex++] });
    }
  }
  while (oldIndex < oldLines.length) result.push({ kind: "removed", text: oldLines[oldIndex++] });
  while (newIndex < newLines.length) result.push({ kind: "added", text: newLines[newIndex++] });
  return result;
}

export function markdownProposalHunkCount(before, after) {
  let count = 0;
  let inChange = false;
  for (const line of rawMarkdownDiff(before, after)) {
    if (line.kind === "same") inChange = false;
    else if (!inChange) {
      count += 1;
      inChange = true;
    }
  }
  return count;
}

export function applyProposalMarkdownHunks(before, after, acceptedHunks) {
  const accepted = new Set(acceptedHunks);
  const output = [];
  let hunkIndex = -1;
  let inChange = false;
  for (const line of rawMarkdownDiff(before, after)) {
    if (line.kind === "same") {
      inChange = false;
      output.push(line.text);
      continue;
    }
    if (!inChange) {
      hunkIndex += 1;
      inChange = true;
    }
    if (accepted.has(hunkIndex) ? line.kind === "added" : line.kind === "removed") output.push(line.text);
  }
  return output.join("\n");
}
