/**
 * Normalizes a phone number for comparison (e.g. +971508354832 and 0508354832 are the same).
 * - Strips non-digits
 * - Removes UAE country code 971 from the start
 * - Removes leading 0
 * @param phone - Raw phone string (e.g. "+971 50 835 4832", "0508354832")
 * @returns Canonical 9-digit form for UAE mobile, or empty string if invalid
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return '';
  // UAE: 971 + 9 digits, or 0 + 9 digits
  if (digits.startsWith('971') && digits.length >= 12) {
    return digits.slice(3); // 971508354832 -> 508354832
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    return digits.slice(1); // 0508354832 -> 508354832
  }
  return digits;
}
