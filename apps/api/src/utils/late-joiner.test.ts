import { describe, expect, it } from 'vitest';
import { resolveLateJoin } from './late-joiner';

const start = new Date('2026-10-01T00:00:00+05:00');
const now = new Date('2026-10-07T12:00:00+05:00');

describe('resolveLateJoin', () => {
  it('is not late when the student joined before or on the start day', () => {
    expect(resolveLateJoin({ joinedAt: new Date('2026-09-25T10:00:00+05:00'), startDate: start, now }))
      .toEqual({ joinedAfterStart: false, isNewLateJoiner: false });
    expect(resolveLateJoin({ joinedAt: new Date('2026-10-01T18:00:00+05:00'), startDate: start, now }))
      .toEqual({ joinedAfterStart: false, isNewLateJoiner: false });
  });

  it('marks a student who joined after the start within the last 7 days', () => {
    expect(resolveLateJoin({ joinedAt: new Date('2026-10-05T00:00:00+05:00'), startDate: start, now }))
      .toEqual({ joinedAfterStart: true, isNewLateJoiner: true });
  });

  it('keeps the late flag but drops the red dot after 7 days', () => {
    const later = new Date('2026-10-20T12:00:00+05:00');
    expect(resolveLateJoin({ joinedAt: new Date('2026-10-05T00:00:00+05:00'), startDate: start, now: later }))
      .toEqual({ joinedAfterStart: true, isNewLateJoiner: false });
  });

  it('compares Tashkent calendar days, not UTC', () => {
    // 2 Oct 00:30 Tashkent is still 1 Oct in UTC, but it is the day after the start.
    expect(resolveLateJoin({ joinedAt: new Date('2026-10-02T00:30:00+05:00'), startDate: start, now }).joinedAfterStart)
      .toBe(true);
  });

  it('never flags without a start date or join date', () => {
    expect(resolveLateJoin({ joinedAt: now, startDate: null, now })).toEqual({ joinedAfterStart: false, isNewLateJoiner: false });
    expect(resolveLateJoin({ joinedAt: null, startDate: start, now })).toEqual({ joinedAfterStart: false, isNewLateJoiner: false });
  });
});
