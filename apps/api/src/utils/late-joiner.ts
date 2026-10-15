const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar day in Tashkent (GMT+5) as a sortable YYYY-MM-DD key. */
function tashkentDayKey(date: Date): string {
  return new Date(date.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * A student "joined late" when their enrollment (sale) date falls on a day after the course/oqim start day.
 * `isNewLateJoiner` limits that to the first `windowDays` days after joining, for the red dot on the list.
 */
export function resolveLateJoin(params: {
  joinedAt: Date | null | undefined;
  startDate: Date | null | undefined;
  now?: Date;
  windowDays?: number;
}): { joinedAfterStart: boolean; isNewLateJoiner: boolean } {
  const { joinedAt, startDate } = params;
  if (!joinedAt || !startDate) {
    return { joinedAfterStart: false, isNewLateJoiner: false };
  }
  const joinedAfterStart = tashkentDayKey(joinedAt) > tashkentDayKey(startDate);
  const now = params.now ?? new Date();
  const windowDays = params.windowDays ?? 7;
  const isNewLateJoiner = joinedAfterStart
    && now.getTime() - joinedAt.getTime() <= windowDays * DAY_MS;
  return { joinedAfterStart, isNewLateJoiner };
}
