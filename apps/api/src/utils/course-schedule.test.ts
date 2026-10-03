import { describe, expect, it } from 'vitest';
import {
  classWeekdaysForRun,
  computeEndDate,
  courseWeekRange,
  courseWeekStartDay,
  isClassDayForRun,
  isExerciseEligibleOnDate,
  normalizeCourseCategory,
  requiredStartDayForCategory,
  requiredStartDayLabel,
} from './course-schedule';

describe('isExerciseEligibleOnDate — mashq days', () => {
  const postCutoverRun = new Date(2026, 8, 4); // Fri 2026-09-04 → Fri/Sat classes
  const preCutoverRun = new Date(2026, 7, 22); // Sat 2026-08-22 → Sat/Sun classes
  const friday = new Date(2026, 8, 11);
  const saturday = new Date(2026, 8, 5);
  const sunday = new Date(2026, 8, 6);
  const monday = new Date(2026, 8, 7);

  it('Fri/Sat oqim: daily mashq Sun–Thu, class mashq Fri/Sat', () => {
    expect(isExerciseEligibleOnDate('homework', sunday, 'offline', postCutoverRun)).toBe(true);
    expect(isExerciseEligibleOnDate('extra', monday, 'offline', postCutoverRun)).toBe(true);
    expect(isExerciseEligibleOnDate('homework', friday, 'offline', postCutoverRun)).toBe(false);
    expect(isExerciseEligibleOnDate('class', friday, 'offline', postCutoverRun)).toBe(true);
    expect(isExerciseEligibleOnDate('class', sunday, 'offline', postCutoverRun)).toBe(false);
  });

  it('older Sat/Sun oqim keeps Mon–Fri daily mashq after the cutover date', () => {
    expect(isExerciseEligibleOnDate('homework', sunday, 'offline', preCutoverRun)).toBe(false);
    expect(isExerciseEligibleOnDate('class', sunday, 'offline', preCutoverRun)).toBe(true);
    expect(isExerciseEligibleOnDate('homework', friday, 'offline', preCutoverRun)).toBe(true);
  });

  it('never offers a class and a daily mashq on the same day for offline', () => {
    for (let offset = 0; offset < 14; offset += 1) {
      const date = new Date(2026, 8, 4 + offset);
      const classOk = isExerciseEligibleOnDate('class', date, 'offline', postCutoverRun);
      const dailyOk = isExerciseEligibleOnDate('homework', date, 'offline', postCutoverRun);
      expect(classOk).toBe(!dailyOk);
    }
  });

  it('online: daily mashq Mon–Fri, no class days', () => {
    expect(isExerciseEligibleOnDate('homework', monday, 'online', postCutoverRun)).toBe(true);
    expect(isExerciseEligibleOnDate('homework', saturday, 'online', postCutoverRun)).toBe(false);
    expect(isExerciseEligibleOnDate('homework', sunday, 'online', postCutoverRun)).toBe(false);
    expect(isExerciseEligibleOnDate('class', monday, 'online', postCutoverRun)).toBe(false);
  });
});

describe('normalizeCourseCategory', () => {
  it('classifies known categories', () => {
    expect(normalizeCourseCategory('Offline')).toBe('offline');
    expect(normalizeCourseCategory('Intensiv')).toBe('intensiv');
    expect(normalizeCourseCategory('Online')).toBe('online');
    expect(normalizeCourseCategory('Onlayn')).toBe('online');
    expect(normalizeCourseCategory("Qo'shimcha xizmat")).toBe('additional_service');
    expect(normalizeCourseCategory('Random course name')).toBe('offline');
  });
});

describe('classWeekdaysForRun / isClassDayForRun — Friday/Saturday cutover', () => {
  it('uses Saturday+Sunday for offline runs starting before the cutover', () => {
    const preCutoverStart = new Date(2026, 7, 22); // 2026-08-22, a Saturday
    expect(classWeekdaysForRun('offline', preCutoverStart)).toEqual([6, 0]);
    expect(isClassDayForRun(new Date(2026, 7, 22), 'offline', preCutoverStart)).toBe(true); // Sat
    expect(isClassDayForRun(new Date(2026, 7, 23), 'offline', preCutoverStart)).toBe(true); // Sun
    expect(isClassDayForRun(new Date(2026, 7, 21), 'offline', preCutoverStart)).toBe(false); // Fri
  });

  it('uses Friday+Saturday for offline/intensiv runs starting on/after the cutover', () => {
    const postCutoverStart = new Date(2026, 8, 4); // 2026-09-04, a Friday
    expect(classWeekdaysForRun('offline', postCutoverStart)).toEqual([5, 6]);
    expect(isClassDayForRun(new Date(2026, 8, 4), 'intensiv', postCutoverStart)).toBe(true); // Fri
    expect(isClassDayForRun(new Date(2026, 8, 5), 'intensiv', postCutoverStart)).toBe(true); // Sat
    expect(isClassDayForRun(new Date(2026, 8, 6), 'intensiv', postCutoverStart)).toBe(false); // Sun
  });

  it('keeps a pre-cutover run on Sat/Sun even for class dates that fall after the cutover', () => {
    // A run that started before the cutover keeps its own schedule for its whole duration.
    const preCutoverStart = new Date(2026, 7, 15); // 2026-08-15, a Saturday
    const dateAfterCutover = new Date(2026, 8, 6); // 2026-09-06, a Sunday
    expect(isClassDayForRun(dateAfterCutover, 'offline', preCutoverStart)).toBe(true);
  });

  it('returns null / false for online and additional_service categories', () => {
    const anyDate = new Date(2026, 8, 5);
    expect(classWeekdaysForRun('online', anyDate)).toBeNull();
    expect(isClassDayForRun(anyDate, 'online', anyDate)).toBe(false);
    expect(classWeekdaysForRun('additional_service', anyDate)).toBeNull();
  });
});

describe('requiredStartDayForCategory / requiredStartDayLabel', () => {
  it('requires Monday for online regardless of date', () => {
    expect(requiredStartDayForCategory('online', new Date(2026, 8, 1))).toBe(1);
    expect(requiredStartDayForCategory('online', new Date(2026, 7, 1))).toBe(1);
  });

  it('requires Saturday before the cutover and Friday on/after it for offline/intensiv', () => {
    expect(requiredStartDayForCategory('offline', new Date(2026, 7, 22))).toBe(6); // pre-cutover
    expect(requiredStartDayForCategory('offline', new Date(2026, 8, 4))).toBe(5); // post-cutover
    expect(requiredStartDayForCategory('intensiv', new Date(2026, 8, 1))).toBe(5); // exactly on cutover
  });

  it('has no required day for additional_service', () => {
    expect(requiredStartDayForCategory('additional_service', new Date(2026, 8, 1))).toBeNull();
  });

  it('labels each required day correctly', () => {
    expect(requiredStartDayLabel(1)).toBe('dushanba');
    expect(requiredStartDayLabel(5)).toBe('juma');
    expect(requiredStartDayLabel(6)).toBe('shanba');
  });
});

describe('computeEndDate', () => {
  it('lands a Saturday-start pre-cutover run on the Sunday of its final week', () => {
    const start = new Date(2026, 7, 22); // Saturday
    const end = computeEndDate(start, 6, 'offline');
    expect(end.getDay()).toBe(0); // Sunday
  });

  it('lands a Friday-start post-cutover run on the Saturday of its final week', () => {
    const start = new Date(2026, 8, 4); // Friday
    const end = computeEndDate(start, 6, 'offline');
    expect(end.getDay()).toBe(6); // Saturday
  });

  it('lands a Monday-start online run on the Sunday of its final week', () => {
    const start = new Date(2026, 8, 7); // Monday
    const end = computeEndDate(start, 6, 'online');
    expect(end.getDay()).toBe(0); // Sunday
  });
});

describe('course weeks — Sunday start for Fri/Sat oqims', () => {
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Inclusive last day of a range whose `to` is exclusive.
  const lastDay = (to: Date) => {
    const d = new Date(to);
    d.setDate(d.getDate() - 1);
    return key(d);
  };

  it('picks Sunday only for Fri/Sat oqims', () => {
    expect(courseWeekStartDay('offline', new Date(2026, 8, 4))).toBe(0);
    expect(courseWeekStartDay('intensiv', new Date(2026, 8, 4))).toBe(0);
    expect(courseWeekStartDay('offline', new Date(2026, 7, 22))).toBe(1);
    expect(courseWeekStartDay('online', new Date(2026, 8, 7))).toBe(1);
  });

  it('Friday-start oqim: week 1 = Fri-Sat, then Sun-Sat weeks to the run end', () => {
    const runStart = new Date(2026, 8, 4); // Friday
    const runEnd = computeEndDate(runStart, 6, 'offline'); // Saturday
    const runEndExclusive = new Date(runEnd);
    runEndExclusive.setDate(runEndExclusive.getDate() + 1);
    const week = (n: number) => courseWeekRange({ weekNumber: n, runStart, runEndExclusive, weekStartDay: 0 });

    expect(key(week(1).from)).toBe('2026-09-04');
    expect(lastDay(week(1).to)).toBe('2026-09-05');
    expect(key(week(2).from)).toBe('2026-09-06');
    expect(week(2).from.getDay()).toBe(0);
    expect(lastDay(week(2).to)).toBe('2026-09-12');
    expect(lastDay(week(6).to)).toBe(key(runEnd));
  });

  it('older Saturday-start oqim keeps Monday weeks', () => {
    const runStart = new Date(2026, 7, 22); // Saturday, pre-cutover
    const runEndExclusive = new Date(2026, 9, 5);
    const week = (n: number) => courseWeekRange({ weekNumber: n, runStart, runEndExclusive, weekStartDay: 1 });

    expect(lastDay(week(1).to)).toBe('2026-08-23');
    expect(key(week(2).from)).toBe('2026-08-24');
    expect(week(2).from.getDay()).toBe(1);
  });
});
