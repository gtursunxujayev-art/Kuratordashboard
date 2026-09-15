// Offline/intensiv class days moved from Saturday-Sunday to Friday-Saturday for any
// course run whose own startDate is on/after this cutover. The cutover is per-run
// (keyed off that run's startDate), not a single global "today" check, so runs that
// started before the cutover keep their original Sat-Sun schedule for their lifetime.
export const OFFLINE_SCHEDULE_CUTOVER_DATE = new Date(2026, 8, 1); // 2026-09-01, local

export type CourseCategory = 'online' | 'intensiv' | 'offline' | 'additional_service';

export function normalizeCourseCategory(value: string): CourseCategory {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.includes('additional')
    || normalized.includes("qo'shimcha")
    || normalized.includes('qo‘shimcha')
    || normalized.includes('xizmat')
    || normalized.includes('servis')
    || normalized.includes('service')
  ) {
    return 'additional_service';
  }
  if (normalized.includes('intens')) return 'intensiv';
  if (normalized.includes('online') || normalized.includes('onlayn')) return 'online';
  return 'offline';
}

export function isOfflineLikeCategory(category: string): boolean {
  const normalized = normalizeCourseCategory(category);
  return normalized === 'offline' || normalized === 'intensiv';
}

// The two weekday numbers (0=Sun..6=Sat) used as class days for an offline/intensiv
// run with the given startDate. Returns null for online/additional_service, which
// have no fixed weekend-style class-day pair.
export function classWeekdaysForRun(category: string, runStartDate: Date): [number, number] | null {
  if (!isOfflineLikeCategory(category)) return null;
  return runStartDate.getTime() >= OFFLINE_SCHEDULE_CUTOVER_DATE.getTime()
    ? [5, 6] // Friday + Saturday
    : [6, 0]; // Saturday + Sunday
}

export function isClassDayForRun(date: Date, category: string, runStartDate: Date): boolean {
  const pair = classWeekdaysForRun(category, runStartDate);
  if (!pair) return false;
  const day = date.getDay();
  return day === pair[0] || day === pair[1];
}

// Required start weekday (1=Mon, 5=Fri, 6=Sat) for a *candidate* startDate being
// validated when creating/editing a course run. Online is always Monday. Offline/
// intensiv is Friday if the candidate date is on/after the cutover, else Saturday
// (matching whatever rule was in force on that date).
export function requiredStartDayForCategory(category: string, candidateStartDate: Date): 1 | 5 | 6 | null {
  const normalized = normalizeCourseCategory(category);
  if (normalized === 'additional_service') return null;
  if (normalized === 'online') return 1;
  return candidateStartDate.getTime() >= OFFLINE_SCHEDULE_CUTOVER_DATE.getTime() ? 5 : 6;
}

export function requiredStartDayLabel(day: 1 | 5 | 6): string {
  if (day === 1) return 'dushanba';
  if (day === 5) return 'juma';
  return 'shanba';
}

// Online starts Monday, Offline/Intensiv starts Friday (>= cutover) or Saturday
// (< cutover). Additional-service courses can start any day and span full calendar
// weeks from that day. The day-offset arithmetic only branches on "Monday-start" vs
// everything else, so Friday-start and Saturday-start share the same formula —
// verified by hand: start + (weeks*7-6) days always lands one weekday after start,
// so a Friday-start run ends on the Saturday of its final week, exactly analogous to
// a Saturday-start run ending on the Sunday of its final week.
export function computeEndDate(startDate: Date, durationWeeks: number, courseCategory: string): Date {
  const requiredDay = requiredStartDayForCategory(courseCategory, startDate);
  const dayOffset =
    requiredDay === null
      ? (durationWeeks * 7 - 1)
      : (requiredDay === 1 ? (durationWeeks * 7 - 1) : (durationWeeks * 7 - 6));
  const end = new Date(startDate);
  end.setDate(end.getDate() + dayOffset);
  return end;
}
