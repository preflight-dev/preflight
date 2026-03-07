/**
 * Date range helpers for report period calculations.
 * Extracted from export-report for reuse and testability.
 */

export interface DateRange {
  since: string;
  until: string;
  label: string;
}

export type Period = "today" | "yesterday" | "week" | "sprint" | "month" | "custom";

export function getDateRange(
  period: Period | string,
  customSince?: string,
  customUntil?: string,
  now: Date = new Date(),
): DateRange {
  if (period === "custom" && customSince) {
    return {
      since: customSince,
      until: customUntil || now.toISOString(),
      label: `${customSince.slice(0, 10)} to ${(customUntil || now.toISOString()).slice(0, 10)}`,
    };
  }

  const end = new Date(now);
  const start = new Date(now);

  switch (period) {
    case "today":
      start.setHours(0, 0, 0, 0);
      return { since: start.toISOString(), until: end.toISOString(), label: start.toISOString().slice(0, 10) };
    case "yesterday": {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const endOfDay = new Date(start);
      endOfDay.setHours(23, 59, 59, 999);
      return { since: start.toISOString(), until: endOfDay.toISOString(), label: start.toISOString().slice(0, 10) };
    }
    case "week":
      start.setDate(start.getDate() - 7);
      return { since: start.toISOString(), until: end.toISOString(), label: `Week of ${start.toISOString().slice(0, 10)}` };
    case "month":
      start.setMonth(start.getMonth() - 1);
      return { since: start.toISOString(), until: end.toISOString(), label: `Past month (${start.toISOString().slice(0, 10)} – ${end.toISOString().slice(0, 10)})` };
    case "sprint":
      start.setDate(start.getDate() - 14);
      return { since: start.toISOString(), until: end.toISOString(), label: `Sprint (${start.toISOString().slice(0, 10)} – ${end.toISOString().slice(0, 10)})` };
    default:
      start.setDate(start.getDate() - 7);
      return { since: start.toISOString(), until: end.toISOString(), label: `Week of ${start.toISOString().slice(0, 10)}` };
  }
}
