export type DatePreset =
  | 'today'
  | 'week1'
  | 'week2'
  | 'week3'
  | 'week4'
  | 'week5'
  | 'week6'
  | 'all';

export type WeekKey = 'week1' | 'week2' | 'week3' | 'week4' | 'week5' | 'week6';

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Bugun',
  week1: '1-hafta',
  week2: '2-hafta',
  week3: '3-hafta',
  week4: '4-hafta',
  week5: '5-hafta',
  week6: '6-hafta',
  all: 'Hammasi',
};

export const WEEK_KEYS: WeekKey[] = ['week1', 'week2', 'week3', 'week4', 'week5', 'week6'];

type DayColumn = { key: string; label: string };

const DATE_PRESET_VALUES = Object.keys(DATE_PRESET_LABELS) as DatePreset[];

function buildDayColumns(dateFrom?: string, dateToInclusive?: string | null): DayColumn[] {
  if (!dateFrom || !dateToInclusive) return [];

  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateToInclusive}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) return [];

  const dayLabels = ['Yak', 'Du', 'Se', 'Chor', 'Pay', 'Ju', 'Shan'] as const;
  const columns: DayColumn[] = [];
  const cursor = new Date(from);

  while (cursor.getTime() <= to.getTime()) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    columns.push({ key: `${y}-${m}-${d}`, label: dayLabels[cursor.getDay()] });
    cursor.setDate(cursor.getDate() + 1);
  }

  return columns;
}

// Which days are class vs daily depends on the oqim (Fri/Sat after the 2026-09-01
// cutover, Sat/Sun before), so the server decides and sends the applicable days.
function filterDayColumnsByApplicability(dayColumns: DayColumn[], applicableDayKeys?: string[]): DayColumn[] {
  if (!applicableDayKeys) return dayColumns;
  const allowed = new Set(applicableDayKeys);
  return dayColumns.filter((column) => allowed.has(column.key));
}

export function parseDatePreset(value?: string | null): DatePreset {
  if (value && DATE_PRESET_VALUES.includes(value as DatePreset)) {
    return value as DatePreset;
  }

  return 'today';
}

export function isWeekDatePreset(datePreset: DatePreset): boolean {
  return WEEK_KEYS.includes(datePreset as WeekKey);
}

export function getReportTableLayout(params: {
  datePreset: DatePreset;
  dateFrom?: string;
  dateToInclusive?: string | null;
  applicableDayKeys?: string[];
  practiceCount: number;
}) {
  const { datePreset, dateFrom, dateToInclusive, applicableDayKeys, practiceCount } = params;
  const isTodayPreset = datePreset === 'today';
  const isWeekPreset = isWeekDatePreset(datePreset);
  const dayColumns = filterDayColumnsByApplicability(
    buildDayColumns(dateFrom, dateToInclusive),
    applicableDayKeys,
  );
  const subColumns = isTodayPreset
    ? [] as DayColumn[]
    : isWeekPreset
      ? dayColumns
      : WEEK_KEYS.map((weekKey) => ({ key: weekKey, label: DATE_PRESET_LABELS[weekKey] }));
  const hasSubColumns = subColumns.length > 0;
  const perPracticeColumnCount = isTodayPreset ? 1 : Math.max(subColumns.length, 1);

  return {
    isTodayPreset,
    isWeekPreset,
    hasSubColumns,
    isEmptyWeek: isWeekPreset && !hasSubColumns,
    subColumns,
    perPracticeColumnCount,
    tableMinWidth: isTodayPreset ? 'min-w-[720px] md:min-w-[960px]' : 'min-w-[840px] md:min-w-[1080px]',
    emptyColSpan: practiceCount * perPracticeColumnCount + 5,
  };
}
