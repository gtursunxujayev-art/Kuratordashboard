export type StudentExportCourseType = 'online' | 'offline' | 'intensiv' | 'additional_service' | 'all';

export type StudentExportRow = {
  name: string;
  customerNumber: string;
  telegramUsername: string | null;
  region: string | null;
  courseName: string | null;
  tariffName: string | null;
  joinedAt: Date | string | null;
  joinedAfterStart: boolean;
};

export const STUDENT_EXPORT_HEADERS = [
  '№', 'Ism', 'Raqam', 'Telegram', 'Viloyat', 'Kurs', 'Tarif', "Qo'shilgan sana", "Kech qo'shilgan",
] as const;
export const STUDENT_EXPORT_COLUMN_WIDTHS = [6, 32, 16, 22, 18, 26, 16, 16, 16] as const;

export const STUDENT_EXPORT_TYPE_LABELS: Record<StudentExportCourseType, string> = {
  online: 'Online',
  offline: 'Offline',
  intensiv: 'Intensiv',
  additional_service: "Qo'shimcha xizmat",
  all: 'Hammasi',
};

const FILE_SLUG: Record<StudentExportCourseType, string> = {
  online: 'online',
  offline: 'offline',
  intensiv: 'intensiv',
  additional_service: 'qoshimcha-xizmat',
  all: 'hammasi',
};

/** Prevents Excel from treating a cell that starts with = + - @ as a formula. */
export function sanitizeSpreadsheetText(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

/** Tashkent calendar date as YYYY-MM-DD. */
export function formatTashkentDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

export function buildStudentExportRows(rows: StudentExportRow[]): Array<Array<string | number>> {
  return rows.map((row, index) => [
    index + 1,
    sanitizeSpreadsheetText(row.name),
    sanitizeSpreadsheetText(row.customerNumber),
    row.telegramUsername ? sanitizeSpreadsheetText(`@${row.telegramUsername.replace(/^@+/, '')}`) : '',
    sanitizeSpreadsheetText(row.region ?? ''),
    sanitizeSpreadsheetText(row.courseName ?? ''),
    sanitizeSpreadsheetText(row.tariffName ?? ''),
    formatTashkentDate(row.joinedAt),
    row.joinedAfterStart ? 'ha' : "yo'q",
  ]);
}

export function getStudentExportFilename(courseType: StudentExportCourseType, now = new Date()): string {
  return `oquvchilar_${FILE_SLUG[courseType]}_${formatTashkentDate(now)}.xlsx`;
}
