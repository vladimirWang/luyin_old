import { formatCardDateParts, recordDateToneClass } from "../../../utils/index.js";

export function CalendarTag({ recording, isTrashView = false }) {
  const dateParts = formatCardDateParts(recording?.createdAt);

  return (
    <span className={`record-date-tile ${recordDateToneClass(recording, isTrashView)}`}>
      <em>{dateParts.month}</em>
      <span>{dateParts.day}</span>
    </span>
  );
}
