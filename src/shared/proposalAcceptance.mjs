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
