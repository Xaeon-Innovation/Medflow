import { prisma } from '../utils/database.utils';
import { withDbRetry } from '../utils/database.utils';
import { CreateTransactionData } from './transaction.service';
import { normalizeNationalId } from '../utils/patientId.utils';

export interface ExcelTransactionRow {
  // Patient identification fields (various possible column names)
  nationalId?: string;
  patientName?: string;
  patientEnglishName?: string;
  patientArabicName?: string;
  mrn?: string;
  mrnNumber?: string;
  
  // Transaction amounts
  totalRevenue?: number | string;
  companyShare?: number | string;
  totalShare?: number | string; // Alternative name
  eligibleAmount?: number | string;
  referralShare?: number | string;
  
  // Optional: Visit dates for matching
  visitDate?: string | Date;
}

export interface ParsedTransaction {
  patientId: string;
  totalRevenue: number;
  companyShare: number;
  eligibleAmount: number;
  referralShare: number;
  visitSpecialityIds?: string[];
  matched: boolean;
  matchMethod?: 'nationalId' | 'name' | 'mrn';
  originalRow?: any;
  firstVisitDate?: Date | string;
  needsReview?: boolean;
  visitCount?: number;
  dateValidationWarning?: string;
  patientName?: string;
  nationalId?: string;
  mrn?: string;
}

export interface TransactionImportResult {
  parsed: ParsedTransaction[];
  matched: ParsedTransaction[];
  unmatched: ParsedTransaction[];
  errors: Array<{ row: number; error: string }>;
}

/**
 * Helper function to find value by multiple possible column names (case-insensitive)
 */
const findValue = (row: any, possibleNames: string[]): string => {
  const lowerRow: Record<string, any> = {};
  Object.keys(row).forEach(key => {
    lowerRow[key.toLowerCase().trim()] = row[key];
  });

  for (const name of possibleNames) {
    const value = lowerRow[name.toLowerCase().trim()];
    if (value !== undefined && value !== null && value !== '') {
      return String(value).trim();
    }
  }
  return '';
};

/**
 * Parse Excel file data and extract transaction information
 * Note: This expects the frontend to parse the Excel file and send the JSON data
 * For server-side Excel parsing, you would need to install 'xlsx' or 'exceljs' package
 */
export const parseTransactionExcel = async (
  excelData: any[],
  hospitalId: string,
  month: string,
  year: string
): Promise<TransactionImportResult> => {
  const result: TransactionImportResult = {
    parsed: [],
    matched: [],
    unmatched: [],
    errors: []
  };

  try {
    // Get all patients for matching
    const allPatients = await withDbRetry(async () => {
      return await prisma.patient.findMany({
        select: {
          id: true,
          nameEnglish: true,
          nameArabic: true,
          nationalId: true,
        }
      });
    });

    // Get MRNs for matching
    const allMRNs = await withDbRetry(async () => {
      return await prisma.patientHospitalMRN.findMany({
        where: {
          hospitalId: hospitalId
        },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
            }
          }
        }
      });
    });

    // Get all visits for patients in the specified hospital/month to link visit specialties
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthIndex = monthNames.indexOf(month);
    if (monthIndex === -1) {
      throw new Error(`Invalid month: ${month}`);
    }

    const yearNum = parseInt(year);
    const startDate = new Date(yearNum, monthIndex, 1);
    const endDate = new Date(yearNum, monthIndex + 1, 0, 23, 59, 59, 999);

    const visits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: {
          hospitalId: hospitalId,
          visitDate: {
            gte: startDate,
            lte: endDate,
          }
        },
        include: {
          visitSpecialities: {
            select: {
              id: true,
            }
          },
          patient: {
            select: {
              id: true,
              nationalId: true,
            }
          }
        }
      });
    });

    // Process each row
    excelData.forEach((row, index) => {
      try {
        // Extract patient identification - new column format (handling variations)
        const nationalId = findValue(row, ['I.D', 'I.D.', 'nationalId', 'National ID', 'ID Number', 'ID', 'NationalId', 'NationalIdNumber', 'national_id']);
        const patientName = findValue(row, ['Name', 'patientName', 'Patient Name', 'Full Name', 'Patient', 'nameEnglish', 'Name English', 'English Name']);
        const mrn = findValue(row, ['MRN', 'mrn', 'MRN Number', 'MRN NO', 'MRNNO', 'mrnNumber', 'patient_mrn', 'MRNN', 'MRN N']);
        const excelDateStr = findValue(row, ['Date', 'date', 'Visit Date', 'First Visit Date', 'visitDate']);

        // Extract transaction amounts - new column format (handling variations)
        const totalRevenueStr = findValue(row, ['Total Revenue', 'totalRevenue', 'Revenue', 'total_revenue', 'Total Reven']);
        const companyShareStr = findValue(row, ['Company Share', 'companyShare', 'Total Share', 'company_share', 'totalShare', 'Company Sha']);
        const eligibleAmountStr = findValue(row, ['Eligible Amount', 'eligibleAmount', 'Eligible', 'eligible_amount', 'Eligible Amou']);
        const referralShareStr = findValue(row, ['Referral Share', 'referralShare', 'Referral', 'referral_share', 'Referral Sha']);

        // Validate required fields
        if (!nationalId && !patientName && !mrn) {
          result.errors.push({
            row: index + 1,
            error: 'Missing patient identification (National ID, Name, or MRN)'
          });
          return;
        }

        // Parse Excel date (handle various formats)
        let excelDate: Date | null = null;
        if (excelDateStr) {
          try {
            // Try parsing as date string (handles DD/MM/YYYY, MM/DD/YYYY, etc.)
            const parsed = new Date(excelDateStr);
            if (!isNaN(parsed.getTime())) {
              excelDate = parsed;
            }
          } catch (e) {
            // Date parsing failed, will validate later
          }
        }

        // Parse amounts
        const totalRevenue = totalRevenueStr ? parseFloat(totalRevenueStr.replace(/[^0-9.-]/g, '')) : 0;
        const companyShare = companyShareStr ? parseFloat(companyShareStr.replace(/[^0-9.-]/g, '')) : 0;
        const eligibleAmount = eligibleAmountStr ? parseFloat(eligibleAmountStr.replace(/[^0-9.-]/g, '')) : 0;
        const referralShare = referralShareStr ? parseFloat(referralShareStr.replace(/[^0-9.-]/g, '')) : 0;

        // Check if MRN is missing - flag for review if amounts are zero
        const hasMRN = !!mrn && mrn.trim() !== '';
        const hasZeroAmounts = totalRevenue === 0 && companyShare === 0 && eligibleAmount === 0 && referralShare === 0;
        const needsReview = !hasMRN || hasZeroAmounts;

        // Allow zero amounts if all amounts are zero (regardless of MRN)
        if (hasZeroAmounts) {
          // This is okay - will create transaction with zeros for review
        } else if (!totalRevenue || totalRevenue < 0) {
          result.errors.push({
            row: index + 1,
            error: 'Invalid or missing total revenue'
          });
          return;
        }

        // Try to match patient
        let matchedPatient = null;
        let matchMethod: 'nationalId' | 'name' | 'mrn' | undefined;

        // Match by National ID first (most reliable)
        // Use normalized IDs to handle different dash formats
        if (nationalId) {
          const normalizedSearchId = normalizeNationalId(nationalId);
          matchedPatient = allPatients.find(p => {
            if (!p.nationalId) return false;
            const normalizedPatientId = normalizeNationalId(p.nationalId);
            return normalizedPatientId === normalizedSearchId;
          });
          if (matchedPatient) {
            matchMethod = 'nationalId';
          }
        }

        // Match by MRN if National ID didn't work
        if (!matchedPatient && mrn) {
          const mrnRecord = allMRNs.find(m => 
            m.mrn && m.mrn.toLowerCase().trim() === mrn.toLowerCase().trim()
          );
          if (mrnRecord) {
            matchedPatient = mrnRecord.patient;
            matchMethod = 'mrn';
          }
        }

        // Match by name if still not found (case-insensitive partial match)
        if (!matchedPatient && patientName) {
          const nameLower = patientName.toLowerCase().trim();
          matchedPatient = allPatients.find(p => {
            const englishName = p.nameEnglish?.toLowerCase().trim();
            const arabicName = p.nameArabic?.toLowerCase().trim();
            return (englishName && englishName.includes(nameLower)) || 
                   (arabicName && arabicName.includes(nameLower)) ||
                   (englishName && nameLower.includes(englishName)) ||
                   (arabicName && nameLower.includes(arabicName));
          });
          if (matchedPatient) {
            matchMethod = 'name';
          }
        }

        // Find visit specialties for this patient - get ALL visits in the month
        let visitSpecialityIds: string[] = [];
        let firstVisitDate: Date | null = null;
        let visitCount = 0;
        let dateValidationWarning: string | undefined = undefined;

        if (matchedPatient) {
          const patientVisits = visits.filter(v => v.patientId === matchedPatient!.id);
          visitCount = patientVisits.length;
          
          // Get ALL visit specialty IDs from ALL visits in the month
          visitSpecialityIds = patientVisits.flatMap(v => 
            v.visitSpecialities.map(vs => vs.id)
          );

          // Find first visit date for validation
          if (patientVisits.length > 0) {
            const sortedVisits = [...patientVisits].sort((a, b) => 
              new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime()
            );
            firstVisitDate = sortedVisits[0].visitDate;

            // Validate Excel date against first visit date
            if (excelDate && firstVisitDate) {
              const excelDateOnly = new Date(excelDate);
              excelDateOnly.setHours(0, 0, 0, 0);
              const firstVisitDateOnly = new Date(firstVisitDate);
              firstVisitDateOnly.setHours(0, 0, 0, 0);
              
              // Allow ±1 day variance for timezone/format differences
              const diffDays = Math.abs(
                (excelDateOnly.getTime() - firstVisitDateOnly.getTime()) / (1000 * 60 * 60 * 24)
              );
              
              if (diffDays > 1) {
                dateValidationWarning = `Date mismatch: Excel shows ${excelDate.toLocaleDateString('en-GB')}, but first visit is ${firstVisitDate.toLocaleDateString('en-GB')}`;
              }
            }
          }
        }

        const parsedTransaction: ParsedTransaction = {
          patientId: matchedPatient?.id || '',
          totalRevenue,
          companyShare,
          eligibleAmount,
          referralShare,
          visitSpecialityIds: visitSpecialityIds.length > 0 ? visitSpecialityIds : undefined,
          matched: !!matchedPatient,
          matchMethod,
          originalRow: row,
          firstVisitDate: firstVisitDate || excelDate || undefined,
          needsReview: needsReview || !matchedPatient,
          visitCount,
          dateValidationWarning,
          patientName: patientName || undefined,
          nationalId: nationalId || undefined,
          mrn: mrn || undefined,
        };

        result.parsed.push(parsedTransaction);

        if (matchedPatient) {
          result.matched.push(parsedTransaction);
        } else {
          result.unmatched.push(parsedTransaction);
        }
      } catch (error: any) {
        result.errors.push({
          row: index + 1,
          error: error.message || 'Unknown error processing row'
        });
      }
    });

    return result;
  } catch (error) {
    console.error('Error parsing transaction Excel:', error);
    throw error;
  }
};

/**
 * Convert parsed transactions to CreateTransactionData format
 */
export const convertToTransactionData = (
  parsedTransactions: ParsedTransaction[],
  hospitalId: string,
  month: string,
  year: string,
  recordedById: string
): CreateTransactionData[] => {
  return parsedTransactions
    .filter(t => t.matched && t.patientId)
    .map(t => ({
      patientId: t.patientId,
      hospitalId,
      month,
      year,
      totalRevenue: t.totalRevenue,
      companyShare: t.companyShare,
      eligibleAmount: t.eligibleAmount,
      referralShare: t.referralShare,
      recordedById,
      source: 'excel',
      status: 'active',
      visitSpecialityIds: t.visitSpecialityIds,
    }));
};

export default {
  parseTransactionExcel,
  convertToTransactionData,
};
