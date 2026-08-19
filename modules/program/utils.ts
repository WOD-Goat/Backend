/**
 * Shared day-number <-> calendar-date helpers for Programs.
 * A program's workouts are keyed by a relative dayNumber (1-based); these convert
 * to/from a real calendar date given a member's own startDate. Used by both
 * modules/program/controller.ts and modules/workout/controller.ts (home feed merge).
 */

/**
 * 1-based day number for `onDate` (default: now) relative to `startDate`,
 * normalized to `timezone` — mirrors StreakService.normalizeToUserDate.
 */
export function dayNumberForDate(startDate: Date, timezone: string, onDate: Date = new Date()): number {
    const normalize = (d: Date): Date => {
        const localized = new Date(d.toLocaleString('en-US', { timeZone: timezone }));
        return new Date(localized.getFullYear(), localized.getMonth(), localized.getDate());
    };
    const startDay = normalize(new Date(startDate));
    const targetDay = normalize(onDate);
    const diffDays = Math.round((targetDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays + 1;
}

/**
 * Real calendar date for a given program dayNumber, relative to a member's startDate.
 */
export function dateForDayNumber(startDate: Date, dayNumber: number): Date {
    return new Date(new Date(startDate).getTime() + (dayNumber - 1) * 24 * 60 * 60 * 1000);
}
