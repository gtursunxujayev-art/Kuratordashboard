import { describe, expect, it } from 'vitest';
import {
  classWeekdaysForRun,
  computeEndDate,
  isClassDayForRun,
  normalizeCourseCategory,
  requiredStartDayForCategory,
  requiredStartDayLabel,
} from './course-schedule';

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
