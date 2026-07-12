export function todayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function dateKeyFromDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, "0")}-${String(safeDate.getDate()).padStart(2, "0")}`;
}

export function dateKeyFromRecording(recording) {
  return dateKeyFromDate(recording?.createdAt || recording?.uploadedAt || recording?.updatedAt || Date.now());
}


export function displayDateFromDateKey(dateKey) {
  const [, month = "", day = ""] = String(dateKey || "").split("-");
  return month && day ? `${month}/${day}` : todayDisplayDateFallback();
}

export function todayDisplayDateFallback() {
  const now = new Date();
  return String(now.getMonth() + 1).padStart(2, "0") + "/" + String(now.getDate()).padStart(2, "0");
}
