/** Snapshot only the selected rows in the current list; one failure must not discard the rest. */
export async function adoptSelectedProposals<T extends { id: string }>(
  selected: readonly string[],
  visible: readonly T[],
  adopt: (proposal: T) => Promise<unknown>,
) {
  const rows = [...new Set(selected)].flatMap((id) => {
    const row = visible.find((entry) => entry.id === id);
    return row ? [row] : [];
  });
  const accepted: string[] = [];
  const failed: { id: string; message: string }[] = [];
  for (const row of rows) {
    try {
      await adopt(row);
      accepted.push(row.id);
    } catch (error) {
      failed.push({ id: row.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { accepted, failed };
}
