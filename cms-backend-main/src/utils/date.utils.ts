/**
 * Date utility functions for handling Dubai timezone (UTC+4) conversions
 * These utilities interpret YYYY-MM-DD date strings as Dubai local dates
 * and convert them to UTC date ranges for database queries.
 */

/**
 * Convert a Dubai local date string (YYYY-MM-DD) to UTC date range
 * Dubai is UTC+4, so:
 * - Dubai 00:00:00 = UTC 20:00:00 previous day
 * - Dubai 23:59:59 = UTC 19:59:59 same day
 * 
 * @param dateStr - Date string in YYYY-MM-DD format (interpreted as Dubai local time)
 * @returns Object with start and end Date objects in UTC for the full day
 */
export function getDubaiDayUtcRange(dateStr: string): { start: Date; end: Date } {
  const dateParts = dateStr.split('-');
  if (dateParts.length !== 3) {
    throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
  }

  const year = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10);
  const day = parseInt(dateParts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    throw new Error(`Invalid date values in: ${dateStr}`);
  }

  // Dubai 00:00:00 = UTC 20:00:00 previous day
  const start = new Date(Date.UTC(
    year,
    month - 1,
    day - 1,  // Previous day in UTC
    20, 0, 0, 0  // 20:00 UTC = 00:00 Dubai (UTC+4)
  ));

  // Dubai 23:59:59 = UTC 19:59:59 same day
  const end = new Date(Date.UTC(
    year,
    month - 1,
    day,
    19, 59, 59, 999  // 19:59:59 UTC = 23:59:59 Dubai
  ));

  return { start, end };
}

/**
 * Get UTC date range from optional start and end date strings (Dubai timezone)
 * 
 * @param startDate - Optional start date string in YYYY-MM-DD format
 * @param endDate - Optional end date string in YYYY-MM-DD format
 * @param fallbackToMonth - If true and no dates provided, default to current month
 * @returns Object with optional start and end Date objects in UTC
 */
export function getDubaiRangeFromStrings(
  startDate?: string,
  endDate?: string,
  fallbackToMonth: boolean = false
): { start?: Date; end?: Date } {
  if (!startDate && !endDate) {
    if (fallbackToMonth) {
      // Default to current month
      const currentMonth = new Date();
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);
      
      // Convert to Dubai date strings and then to UTC ranges
      const startStr = startOfMonth.toISOString().split('T')[0];
      const endStr = endOfMonth.toISOString().split('T')[0];
      const startRange = getDubaiDayUtcRange(startStr);
      const endRange = getDubaiDayUtcRange(endStr);
      
      return {
        start: startRange.start,
        end: endRange.end
      };
    }
    return {};
  }

  const result: { start?: Date; end?: Date } = {};

  if (startDate) {
    const startRange = getDubaiDayUtcRange(startDate);
    result.start = startRange.start;
  }

  if (endDate) {
    const endRange = getDubaiDayUtcRange(endDate);
    result.end = endRange.end;
  }

  return result;
}
