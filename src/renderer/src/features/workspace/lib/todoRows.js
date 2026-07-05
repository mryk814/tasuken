export function scheduledDate(schedule) {
  return String(schedule?.end_date || schedule?.start_date || "");
}

export function isTodayRow(row, today) {
  return row.schedule?.start_date === today || row.schedule?.end_date === today;
}

export function compareTodoRows(today) {
  return (a, b) => {
    const aDate = scheduledDate(a.schedule) || "9999-12-31";
    const bDate = scheduledDate(b.schedule) || "9999-12-31";
    return aDate.localeCompare(bDate);
  };
}
