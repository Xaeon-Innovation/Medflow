import { Request, Response } from 'express';
import { withDbRetry, prisma } from '../utils/database.utils';
import { cache, cacheKeys } from '../utils/cache.utils';
import { determineAppointmentType, getVisitAppointmentTypeById, calculatePatientAge, getAgeCategory } from '../utils/appointment.utils';
import { getDubaiRangeFromStrings } from '../utils/date.utils';
import { log } from '../middleware/logger.middleware';
import '../middleware/auth.middleware'; // Import to extend Request interface

// Import helper functions for calculating actual new patient visits
import { getActualNewPatientVisitsCount, getActualNewPatientVisitsWithAge } from '../utils/newPatientVisits.utils';

// Get commission breakdown by employee
export const getCommissionBreakdown = async (req: Request, res: Response) => {
  try {
    const { employeeId, startDate, endDate, _t } = req.query;
    console.log(`\n[Commission API] Request received:`, {
      employeeId,
      startDate,
      endDate,
      timestamp: _t
    });
    // _t is cache busting parameter, ignore it for cache key

    // Create cache key based on parameters (excluding cache busting param)
    const cacheKey = `commission:breakdown:${employeeId || 'all'}:${startDate || 'all'}:${endDate || 'all'}`;
    
    // If cache busting parameter is present, skip cache
    if (!_t) {
      // Check cache first (only if no cache busting)
      const cachedResult = cache.get(cacheKey);
      if (cachedResult) {
        return res.status(200).json({
          success: true,
          data: cachedResult,
          cached: true
        });
      }
    }

    // Build where clause for main breakdown query
    const whereClause: any = {};
    
    if (employeeId) {
      whereClause.employeeId = employeeId as string;
    }

    // Track if date range was explicitly provided (check for truthy non-empty strings)
    const startDateStr = typeof startDate === 'string' ? startDate.trim() : '';
    const endDateStr = typeof endDate === 'string' ? endDate.trim() : '';
    const hasDateRange = !!(startDateStr) || !!(endDateStr);
    
    // Use period field for date filtering (when commission was earned), not createdAt (when record was created)
    // period is stored as string YYYY-MM-DD format
    if (hasDateRange) {
      whereClause.period = {};
      if (startDateStr) {
        // period is string, so we can do string comparison for YYYY-MM-DD format
        whereClause.period.gte = startDateStr;
      }
      if (endDateStr) {
        whereClause.period.lte = endDateStr;
      }
    } else {
      // Default to current month when no date range is specified
      // This ensures "My Achievement Breakdown" shows current month data by default
      const currentMonth = new Date();
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
      
      // Convert to YYYY-MM-DD format for period field comparison
      const startDateStr = startOfMonth.toISOString().split('T')[0];
      const endDateStr = endOfMonth.toISOString().split('T')[0];
      
      whereClause.period = {
        gte: startDateStr,
        lte: endDateStr
      };
    }
    
    // Debug logging
    console.log('Commission breakdown query params:', {
      employeeId,
      startDate,
      endDate,
      hasDateRange,
      whereClause: JSON.stringify(whereClause, null, 2)
    });

    // Debug: Check what commission records exist
    const allCommissions = await withDbRetry(async () => {
      return await prisma.commission.findMany({
        select: {
          id: true,
          employeeId: true,
          type: true,
          amount: true,
          description: true,
          createdAt: true
        }
      });
    });

    // Get commission breakdown grouped by type
    const commissionBreakdown = await withDbRetry(async () => {
      const result = await prisma.commission.groupBy({
        by: ['type', 'employeeId'],
        where: whereClause,
        _count: {
          id: true
        }
      });
      
      // Debug logging
      console.log('Commission breakdown query result:', {
        totalGroups: result.length,
        sampleGroups: result.slice(0, 5).map(r => ({
          type: r.type,
          employeeId: r.employeeId,
          count: r._count.id
        })),
        whereClause: JSON.stringify(whereClause, (key, value) => {
          if (value instanceof Date) {
            return value.toISOString();
          }
          return value;
        })
      });
      
      return result;
    });

    // Get commission-based age breakdown (for PATIENT_CREATION, FOLLOW_UP, NOMINATION_CONVERSION)
    // This ensures age breakdown matches commission counts exactly
    const commissionAgeBreakdown = await withDbRetry(async () => {
      const commissionsWithPatients = await prisma.commission.findMany({
        where: {
          ...whereClause,
          type: { in: ['PATIENT_CREATION', 'FOLLOW_UP', 'NOMINATION_CONVERSION'] },
          patientId: { not: null }
        },
        select: {
          id: true,
          type: true,
          employeeId: true,
          patientId: true,
          patient: {
            select: {
              id: true,
              dob: true,
              nationalId: true
            }
          }
        }
      });

      const ageCounts: Record<string, {
        newPatient: { total: number; adult: number; child: number };
        followUpTask: { total: number; adult: number; child: number };
        nominationsVisits: { total: number; adult: number; child: number };
      }> = {};

      for (const commission of commissionsWithPatients) {
        if (!commission.patientId || !commission.patient) continue;

        const employeeId = commission.employeeId;
        if (!ageCounts[employeeId]) {
          ageCounts[employeeId] = {
            newPatient: { total: 0, adult: 0, child: 0 },
            followUpTask: { total: 0, adult: 0, child: 0 },
            nominationsVisits: { total: 0, adult: 0, child: 0 }
          };
        }

        // Calculate patient age
        const age = calculatePatientAge(commission.patient.dob, commission.patient.nationalId);
        const ageCategory = getAgeCategory(age);

        // Count based on commission type
        if (commission.type === 'PATIENT_CREATION') {
          ageCounts[employeeId].newPatient.total += 1;
          if (ageCategory === 'adult') {
            ageCounts[employeeId].newPatient.adult += 1;
          } else if (ageCategory === 'child') {
            ageCounts[employeeId].newPatient.child += 1;
          }
        } else if (commission.type === 'FOLLOW_UP') {
          ageCounts[employeeId].followUpTask.total += 1;
          if (ageCategory === 'adult') {
            ageCounts[employeeId].followUpTask.adult += 1;
          } else if (ageCategory === 'child') {
            ageCounts[employeeId].followUpTask.child += 1;
          }
        } else if (commission.type === 'NOMINATION_CONVERSION') {
          ageCounts[employeeId].nominationsVisits.total += 1;
          if (ageCategory === 'adult') {
            ageCounts[employeeId].nominationsVisits.adult += 1;
          } else if (ageCategory === 'child') {
            ageCounts[employeeId].nominationsVisits.child += 1;
          }
        }
      }

      return ageCounts;
    });

    // Get employee details with roles
    const employees = await withDbRetry(async () => {
      return await prisma.employee.findMany({
        where: employeeId ? { id: employeeId as string } : {},
        select: {
          id: true,
          name: true,
          commissions: true,
          employeeRoles: {
            where: { isActive: true },
            select: {
              role: true
            }
          }
        }
      });
    });

    // Get current month data - use same calculation as whereClause for consistency
    const currentMonth = new Date();
    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999); // Set to end of day to match whereClause

    // Get previous month data
    const previousMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    const startOfPreviousMonth = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), 1);
    const endOfPreviousMonth = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0);
    endOfPreviousMonth.setHours(23, 59, 59, 999);

    // For "This Month" calculation, always use current month regardless of date range filter
    // But still respect employeeId filter if provided
    const currentMonthWhereClause: any = {};
    if (employeeId) {
      currentMonthWhereClause.employeeId = employeeId as string;
    }
    // Use period field (when commission was earned) instead of createdAt
    const currentMonthStartStr = startOfMonth.toISOString().split('T')[0];
    const currentMonthEndStr = endOfMonth.toISOString().split('T')[0];
    currentMonthWhereClause.period = {
      gte: currentMonthStartStr,
      lte: currentMonthEndStr
    };
    
    const currentMonthCommissions = await withDbRetry(async () => {
      return await prisma.commission.groupBy({
        by: ['employeeId'],
        where: currentMonthWhereClause,
        _count: {
          id: true
        }
      });
    });

    // Get previous month commission breakdown
    const previousMonthCommissions = await withDbRetry(async () => {
      const prevMonthStartStr = startOfPreviousMonth.toISOString().split('T')[0];
      const prevMonthEndStr = endOfPreviousMonth.toISOString().split('T')[0];
      return await prisma.commission.groupBy({
        by: ['type', 'employeeId'],
        where: {
          ...(employeeId ? { employeeId: employeeId as string } : {}),
          period: {
            gte: prevMonthStartStr,
            lte: prevMonthEndStr
          }
        },
        _count: {
          id: true
        }
      });
    });

    // Get previous month visit counts by type with age breakdown
    const previousMonthVisitCounts = await withDbRetry(async () => {
      const visits = await prisma.visit.findMany({
        where: {
          visitDate: {
            gte: startOfPreviousMonth,
            lte: endOfPreviousMonth
          }
        },
        select: {
          id: true,
          salesId: true,
          coordinatorId: true,
          visitDate: true, // Include visitDate for commission matching
          hospitalId: true, // Need hospitalId to check if first visit to hospital
          createdAt: true, // Need createdAt to check visit order
          visitSpecialities: {
            select: {
              id: true // Just check if specialties exist
            }
          },
          patient: {
            select: {
              id: true,
              dob: true,
              nationalId: true,
              salesPersonId: true, // Include patient's salesPersonId as fallback
            }
          }
        }
      });

      // Fetch commissions for visits to help determine type for unknown visits
      const commissions = await prisma.commission.findMany({
        where: {
          patientId: { in: visits.map(v => v.patient.id) },
          type: { in: ['PATIENT_CREATION', 'FOLLOW_UP'] }
        },
        select: {
          type: true,
          patientId: true,
          description: true
        }
      });

      // Fetch patients who were converted from nominations
      const convertedNominationPatients = await prisma.nomination.findMany({
        where: {
          convertedToPatientId: { not: null }
        },
        select: {
          convertedToPatientId: true,
          salesId: true,
        }
      });
      const convertedPatientIds = new Set(convertedNominationPatients.map(n => n.convertedToPatientId).filter(Boolean) as string[]);
      const nominationSalesMap = new Map<string, string>();
      convertedNominationPatients.forEach(n => {
        if (n.convertedToPatientId && n.salesId) {
          nominationSalesMap.set(n.convertedToPatientId, n.salesId);
        }
      });

      // Create a map of patient ID to commission type (prioritize PATIENT_CREATION over FOLLOW_UP)
      const patientCommissionMap = new Map<string, 'PATIENT_CREATION' | 'FOLLOW_UP'>();
      commissions.forEach(comm => {
        if (comm.patientId) {
          const existing = patientCommissionMap.get(comm.patientId);
          // PATIENT_CREATION takes priority
          if (!existing || comm.type === 'PATIENT_CREATION') {
            patientCommissionMap.set(comm.patientId, comm.type as 'PATIENT_CREATION' | 'FOLLOW_UP');
          }
        }
      });

      const counts: Record<string, {
        newPatient: { total: number; adult: number; child: number };
        existingPatient: { total: number; adult: number; child: number };
        followUpTask: { total: number; adult: number; child: number };
        nominationsVisits: { total: number; adult: number; child: number };
        notBookedVisits: number;
        total: number;
      }> = {};
      
      // Process each visit
      console.log(`[Visit Counting - Previous Month] Starting to process ${visits.length} visits for period ${startOfPreviousMonth.toISOString()} to ${endOfPreviousMonth.toISOString()}`);
      let processedCount = 0;
      let skippedCount = 0;
      let newPatientCount = 0;
      let existingPatientCount = 0;
      let followUpCount = 0;
      let noEmployeeCount = 0;
      const skipReasons: Record<string, number> = {};
      
      for (const visit of visits) {
        processedCount++;
        // Determine visit type
        let visitType = await getVisitAppointmentTypeById(visit.id);
        console.log(`[Visit Counting - Previous Month] Visit ${visit.id} (${processedCount}/${visits.length}): Initial type = ${visitType}, CoordinatorId = ${visit.coordinatorId || 'NONE'}, SalesId = ${visit.salesId || 'NONE'}, Patient SalesPersonId = ${visit.patient.salesPersonId || 'NONE'}`);
        
        // If visit type is unknown, check commissions
        if (visitType === 'unknown') {
          const commissionType = patientCommissionMap.get(visit.patient.id);
          if (commissionType === 'PATIENT_CREATION') {
            visitType = 'new_patient';
          } else if (commissionType === 'FOLLOW_UP') {
            visitType = 'follow_up_task';
          }
          // If still unknown and has salesId, treat as new patient (heuristic)
          if (visitType === 'unknown' && visit.salesId) {
            visitType = 'new_patient';
          }
          // CRITICAL FIX: If still unknown after all checks, default to existing_patient
          // This ensures visits without appointments are still counted
          // We'll verify it's truly existing in the existing_patient block below
          if (visitType === 'unknown') {
            visitType = 'existing_patient';
            console.log(`[Visit Counting] Visit ${visit.id}: Changed from unknown to existing_patient (default)`);
          }
        }
        
        console.log(`[Visit Counting] Visit ${visit.id}: Final type = ${visitType}`);
        
        // Calculate patient age
        const age = calculatePatientAge(visit.patient.dob, visit.patient.nationalId);
        const ageCategory = getAgeCategory(age);
        
        // Check if this visit is from a converted nomination
        const isFromNomination = convertedPatientIds.has(visit.patient.id);
        const nominationSalesId = nominationSalesMap.get(visit.patient.id);
        
        // Determine which employees to count for this visit
        const employeesToCount: Array<{ id: string; type: 'new_patient' | 'existing_patient' | 'follow_up_task' }> = [];
        
        if (visitType === 'new_patient') {
          // For new patients, count for sales person
          // Use visit.salesId first, fallback to patient.salesPersonId
          // Every patient should have a salesPersonId, so one of these should exist
          const salesId = visit.salesId || visit.patient.salesPersonId;
          
          if (salesId) {
            employeesToCount.push({ id: salesId, type: 'new_patient' });
          } else {
            // This should not happen - every patient should have a salesPersonId
            console.error(`[Visit Counting] CRITICAL: New patient visit ${visit.id} has NO sales person. Patient: ${visit.patient.id}, Patient SalesPersonId: ${visit.patient.salesPersonId}, Visit SalesId: ${visit.salesId}. Visit will NOT be counted.`);
          }
        } else if (visitType === 'follow_up_task') {
          // For follow-up visits, count for coordinator
          // Follow-up visits should always have a coordinatorId assigned
          if (visit.coordinatorId) {
            employeesToCount.push({ id: visit.coordinatorId, type: 'follow_up_task' });
          } else {
            // This should not happen - follow-up visits should have coordinators
            console.error(`[Visit Counting] CRITICAL: Follow-up visit ${visit.id} has NO coordinator. Patient: ${visit.patient.id}. Visit will NOT be counted.`);
          }
        } else if (visitType === 'existing_patient') {
          // For existing patients, we need to verify this is truly an existing patient visit:
          // 1. Must have specialties (already filtered in query)
          // 2. Must NOT be the first visit ever
          // 3. Must NOT be the first visit to this hospital
          // 4. Must NOT have a PATIENT_CREATION commission
          // 5. Must NOT be from a follow-up task
          
          const hasPatientCreationCommission = patientCommissionMap.get(visit.patient.id) === 'PATIENT_CREATION';
          
          if (hasPatientCreationCommission) {
            // Skip - this is a new patient visit (first visit ever or first to new hospital)
            continue;
          }
          
          // Check if visit is from a follow-up task FIRST (before checking previous visits)
          // Use a more flexible date range for appointment lookup (same day or within 1 day)
          const visitDateStart = new Date(visit.visitDate);
          visitDateStart.setHours(0, 0, 0, 0);
          const visitDateEnd = new Date(visit.visitDate);
          visitDateEnd.setHours(23, 59, 59, 999);
          
          const appointment = await withDbRetry(async () => {
            return await prisma.appointment.findFirst({
              where: {
                patientId: visit.patient.id,
                hospitalId: visit.hospitalId,
                scheduledDate: {
                  gte: visitDateStart,
                  lte: visitDateEnd
                }
              },
              select: {
                createdFromFollowUpTaskId: true,
                isNewPatientAtCreation: true, // CRITICAL: Check how appointment was booked
                createdById: true,
                salesPersonId: true
              }
            });
          });
          
          if (appointment?.createdFromFollowUpTaskId) {
            // This visit is from a follow-up task - skip (should be counted as follow-up)
            skippedCount++;
            skipReasons['existing_from_follow_up'] = (skipReasons['existing_from_follow_up'] || 0) + 1;
            console.log(`[Visit Counting - Previous Month] Visit ${visit.id}: SKIPPED - From follow-up task (should be counted as follow-up)`);
            continue;
          }
          
          // CRITICAL FIX: Check for previous visits WITHOUT date range restrictions
          // Include ALL visits (including legacy visits without specialties) to properly determine if this is first visit
          // This handles pagination issues and legacy visit detection
          // No filter on visitSpecialities - include legacy visits
          const previousVisits = await withDbRetry(async () => {
            return await prisma.visit.findFirst({
              where: {
                patientId: visit.patient.id,
                id: { not: visit.id },
                // No date restriction - check ALL previous visits regardless of date range
                OR: [
                  { visitDate: { lt: visit.visitDate } },
                  {
                    visitDate: visit.visitDate,
                    createdAt: { lt: visit.createdAt }
                  }
                ]
                // Include legacy visits (visits without specialties) - no filter on visitSpecialities
              },
              select: { id: true },
              orderBy: [
                { visitDate: 'desc' },
                { createdAt: 'desc' }
              ]
            });
          });
          
          // Check if this is the first visit to this hospital (including legacy visits, no date restriction)
          const previousVisitsToHospital = await withDbRetry(async () => {
            return await prisma.visit.findFirst({
              where: {
                patientId: visit.patient.id,
                hospitalId: visit.hospitalId,
                id: { not: visit.id },
                // No date restriction - check ALL previous visits to this hospital
                OR: [
                  { visitDate: { lt: visit.visitDate } },
                  {
                    visitDate: visit.visitDate,
                    createdAt: { lt: visit.createdAt }
                  }
                ]
                // Include legacy visits - no filter on visitSpecialities
              },
              select: { id: true },
              orderBy: [
                { visitDate: 'desc' },
                { createdAt: 'desc' }
              ]
            });
          });
          
          const isFirstVisitEver = !previousVisits;
          const isFirstVisitToHospital = !previousVisitsToHospital;
          
          // KEY LOGIC: If appointment was booked as "existing patient" but it's actually first visit,
          // it should count as NEW PATIENT (not existing patient)
          if (appointment && appointment.isNewPatientAtCreation === false) {
            // Appointment was booked as "existing patient"
            if (isFirstVisitEver || isFirstVisitToHospital) {
              // But it's actually first visit - this should count as NEW PATIENT, not existing
              // Skip from existing patient count (will be counted in new patient section)
              skippedCount++;
              skipReasons['existing_but_first_visit'] = (skipReasons['existing_but_first_visit'] || 0) + 1;
              console.log(`[Visit Counting - Previous Month] Visit ${visit.id}: SKIPPED - Booked as existing but is first visit (ever: ${isFirstVisitEver}, to hospital: ${isFirstVisitToHospital})`);
              continue;
            }
            // Otherwise, patient has previous visits, so it's truly an existing patient - continue counting
            console.log(`[Visit Counting - Previous Month] Visit ${visit.id}: Confirmed existing patient - has previous visits, booked as existing`);
          } else if (isFirstVisitEver || isFirstVisitToHospital) {
            // No appointment found or appointment was booked as new patient, and it's first visit
            // Skip from existing patient count (should be counted as new patient)
            skippedCount++;
            skipReasons['existing_but_first_visit_no_appt'] = (skipReasons['existing_but_first_visit_no_appt'] || 0) + 1;
            console.log(`[Visit Counting - Previous Month] Visit ${visit.id}: SKIPPED - No appointment or first visit (ever: ${isFirstVisitEver}, to hospital: ${isFirstVisitToHospital})`);
            continue;
          }
          
          // If we get here, it's a true existing patient visit:
          // - Patient has previous visits (both ever and to this hospital)
          // - Appointment was booked as "existing patient" OR no appointment found
          // - Not from follow-up task
          // Count it as existing patient
          
          // This is a true existing patient visit (not first visit, not first to hospital, not follow-up)
          // Logic: If visit has specialties, it should have coordinatorId. Otherwise, use salesId or patient.salesPersonId
          let employeeIdToCount: string | null = null;
          
          const hasSpecialties = visit.visitSpecialities && visit.visitSpecialities.length > 0;
          
          if (hasSpecialties) {
            // Visit has specialties - should have coordinatorId
            if (visit.coordinatorId) {
              employeeIdToCount = visit.coordinatorId;
            } else {
              // Data integrity issue - visit has specialties but no coordinator
              console.error(`[Visit Counting - Previous Month] CRITICAL: Visit ${visit.id} has specialties (${visit.visitSpecialities.length}) but NO coordinatorId. Patient: ${visit.patient.id}. This is a data integrity issue.`);
              // Fallback to sales person
              employeeIdToCount = visit.salesId || visit.patient.salesPersonId || null;
            }
          } else {
            // Visit has no specialties - use sales person
            employeeIdToCount = visit.salesId || visit.patient.salesPersonId || null;
          }
          
          // If we found an employee, count the visit
          if (employeeIdToCount) {
            employeesToCount.push({ id: employeeIdToCount, type: 'existing_patient' });
            existingPatientCount++;
            console.log(`[Visit Counting - Previous Month] Visit ${visit.id}: EXISTING PATIENT - Assigned to ${hasSpecialties ? 'coordinator' : 'sales'} ${employeeIdToCount} (hasSpecialties: ${hasSpecialties})`);
          } else {
            // This should not happen - every patient should have a salesPersonId
            noEmployeeCount++;
            skipReasons['existing_no_employee'] = (skipReasons['existing_no_employee'] || 0) + 1;
            console.error(`[Visit Counting - Previous Month] CRITICAL: Existing patient visit ${visit.id} has NO employee assignment. Patient: ${visit.patient.id}, Patient SalesPersonId: ${visit.patient.salesPersonId}, Visit SalesId: ${visit.salesId}, Visit CoordinatorId: ${visit.coordinatorId}, Has Specialties: ${hasSpecialties}. Visit will NOT be counted.`);
          }
        }
        
        // Count for each relevant employee
        for (const emp of employeesToCount) {
          if (!counts[emp.id]) {
            counts[emp.id] = {
              newPatient: { total: 0, adult: 0, child: 0 },
              existingPatient: { total: 0, adult: 0, child: 0 },
              followUpTask: { total: 0, adult: 0, child: 0 },
              nominationsVisits: { total: 0, adult: 0, child: 0 },
              notBookedVisits: 0,
              total: 0
            };
          }
          
          const visitTypeKey = emp.type === 'new_patient' ? 'newPatient' : 
                               emp.type === 'existing_patient' ? 'existingPatient' : 'followUpTask';
          
          counts[emp.id][visitTypeKey].total += 1;
          counts[emp.id].total += 1;
          
          if (ageCategory === 'adult') {
            counts[emp.id][visitTypeKey].adult += 1;
          } else if (ageCategory === 'child') {
            counts[emp.id][visitTypeKey].child += 1;
          }
          
          // If this visit is from a converted nomination and the sales person matches, count it
          if (isFromNomination && nominationSalesId && nominationSalesId === emp.id && emp.type === 'new_patient') {
            counts[emp.id].nominationsVisits.total += 1;
            if (ageCategory === 'adult') {
              counts[emp.id].nominationsVisits.adult += 1;
            } else if (ageCategory === 'child') {
              counts[emp.id].nominationsVisits.child += 1;
            }
          }
        }
      }
      
      // Log summary for debugging
      const totalCounted = Object.values(counts).reduce((sum, emp) => 
        sum + emp.newPatient.total + emp.existingPatient.total + emp.followUpTask.total, 0
      );
      const totalNew = Object.values(counts).reduce((s, e) => s + e.newPatient.total, 0);
      const totalExisting = Object.values(counts).reduce((s, e) => s + e.existingPatient.total, 0);
      const totalFollowUp = Object.values(counts).reduce((s, e) => s + e.followUpTask.total, 0);
      
      console.log(`\n========== [Visit Counting Summary - Previous Month] ==========`);
      console.log(`Total visits in database: ${visits.length}`);
      console.log(`Total visits processed: ${processedCount}`);
      console.log(`Total visits counted: ${totalCounted}`);
      console.log(`Total visits skipped: ${skippedCount}`);
      console.log(`Visits with no employee: ${noEmployeeCount}`);
      console.log(`\nBreakdown by type:`);
      console.log(`  - New Patients: ${totalNew} (expected: ${newPatientCount})`);
      console.log(`  - Existing Patients: ${totalExisting} (expected: ${existingPatientCount})`);
      console.log(`  - Follow-up: ${totalFollowUp} (expected: ${followUpCount})`);
      console.log(`\nSkip reasons:`);
      Object.entries(skipReasons).forEach(([reason, count]) => {
        console.log(`  - ${reason}: ${count}`);
      });
      console.log(`\nEmployees with visit counts: ${Object.keys(counts).length}`);
      console.log(`Visit counts by employee (showing only employees with visits):`);
      Object.entries(counts).forEach(([empId, empCounts]) => {
        if (empCounts.existingPatient.total > 0 || empCounts.newPatient.total > 0 || empCounts.followUpTask.total > 0) {
          console.log(`  - Employee ${empId}: new=${empCounts.newPatient.total}, existing=${empCounts.existingPatient.total}, followUp=${empCounts.followUpTask.total}`);
        }
      });
      console.log(`===========================================================\n`);

      return counts;
    });

    // Get previous month appointment counts (number of created appointments by type)
    const previousMonthAppointmentCounts = await withDbRetry(async () => {
      const appointmentWhere: any = {
        createdAt: {
          gte: startOfPreviousMonth,
          lte: endOfPreviousMonth
        }
      };

      const appointments = await prisma.appointment.findMany({
        where: appointmentWhere,
        select: {
          id: true,
          createdById: true,
          salesPersonId: true,
          isNewPatientAtCreation: true,
          createdFromFollowUpTaskId: true,
        }
      });

      const counts: Record<string, {
        newPatient: number;
        existingPatient: number;
        followUpTask: number;
        total: number;
      }> = {};

      appointments.forEach(apt => {
        const appointmentType = determineAppointmentType({
          isNewPatientAtCreation: apt.isNewPatientAtCreation,
          createdFromFollowUpTaskId: apt.createdFromFollowUpTaskId
        });

        const employeesToCount: string[] = [];
        if (apt.createdById) {
          employeesToCount.push(apt.createdById);
        }
        if (apt.salesPersonId && apt.salesPersonId !== apt.createdById) {
          employeesToCount.push(apt.salesPersonId);
        }

        employeesToCount.forEach(empId => {
          if (!counts[empId]) {
            counts[empId] = {
              newPatient: 0,
              existingPatient: 0,
              followUpTask: 0,
              total: 0
            };
          }

          if (appointmentType === 'new_patient') {
            counts[empId].newPatient += 1;
          } else if (appointmentType === 'existing_patient') {
            counts[empId].existingPatient += 1;
          } else if (appointmentType === 'follow_up_task') {
            counts[empId].followUpTask += 1;
          }
          counts[empId].total += 1;
        });
      });

      return counts;
    });

    // Get previous month transaction revenue (referral share) by sales person
    const previousMonthRevenue = await withDbRetry(async () => {
      const transactions = await prisma.transaction.findMany({
        where: {
          patient: {
            ...(employeeId ? { salesPersonId: employeeId as string } : {})
          },
          createdAt: {
            gte: startOfPreviousMonth,
            lte: endOfPreviousMonth
          }
        },
        select: {
          referralShare: true,
          patient: {
            select: {
              salesPersonId: true
            }
          }
        }
      });

      const revenue: Record<string, number> = {};
      transactions.forEach(t => {
        if (t.patient.salesPersonId) {
          revenue[t.patient.salesPersonId] = (revenue[t.patient.salesPersonId] || 0) + t.referralShare;
        }
      });

      return revenue;
    });

    // Get current month transaction revenue (referral share) by sales person
    const currentMonthRevenue = await withDbRetry(async () => {
      const transactions = await prisma.transaction.findMany({
        where: {
          patient: {
            ...(employeeId ? { salesPersonId: employeeId as string } : {})
          },
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth
          }
        },
        select: {
          referralShare: true,
          patient: {
            select: {
              salesPersonId: true
            }
          }
        }
      });

      const revenue: Record<string, number> = {};
      transactions.forEach(t => {
        if (t.patient.salesPersonId) {
          revenue[t.patient.salesPersonId] = (revenue[t.patient.salesPersonId] || 0) + t.referralShare;
        }
      });

      return revenue;
    });

    // Get visit counts per employee by type with age breakdown
    const visitCounts = await withDbRetry(async () => {
      const visitWhere: any = {};
      
      // Use shared Dubai timezone date utilities
      // Reuse startDateStr and endDateStr from function scope, or use undefined if not set
      const visitStartDateStr = startDateStr || undefined;
      const visitEndDateStr = endDateStr || undefined;
      const dateRange = getDubaiRangeFromStrings(visitStartDateStr, visitEndDateStr, true);
      
      // Filter visits by visitDate using Dubai UTC range
      if (dateRange.start || dateRange.end) {
        visitWhere.visitDate = {};
        if (dateRange.start) {
          visitWhere.visitDate.gte = dateRange.start;
        }
        if (dateRange.end) {
          visitWhere.visitDate.lte = dateRange.end;
        }
      }

      // Fetch visits with patient data for age calculation
      // Include ALL visits (not just those with specialties) to get accurate counts
      // Some existing patient visits might not have specialties yet, but they should still be counted
      const visits = await prisma.visit.findMany({
        where: {
          ...visitWhere
          // Removed visitSpecialities filter - we need to count all visits
        },
        select: {
          id: true,
          salesId: true,
          coordinatorId: true,
          visitDate: true, // Include visitDate for commission matching
          hospitalId: true, // Need hospitalId to check if first visit to hospital
          createdAt: true, // Need createdAt to check visit order
          visitSpecialities: {
            select: {
              id: true // Just check if specialties exist
            }
          },
          patient: {
            select: {
              id: true,
              dob: true,
              nationalId: true,
              salesPersonId: true, // Include patient's salesPersonId as fallback
            }
          }
        }
      });
      
      console.log(`\n[Visit Query] Found ${visits.length} visits in database for query:`, JSON.stringify(visitWhere, null, 2));
      
      // Count visits with vs without employee assignments
      const visitsWithCoordinator = visits.filter(v => v.coordinatorId).length;
      const visitsWithSales = visits.filter(v => v.salesId).length;
      const visitsWithPatientSales = visits.filter(v => v.patient.salesPersonId).length;
      const visitsWithNoEmployee = visits.filter(v => !v.coordinatorId && !v.salesId && !v.patient.salesPersonId).length;
      console.log(`[Visit Query] Employee assignment breakdown:`);
      console.log(`  - Visits with coordinatorId: ${visitsWithCoordinator}`);
      console.log(`  - Visits with salesId: ${visitsWithSales}`);
      console.log(`  - Visits with patient.salesPersonId: ${visitsWithPatientSales}`);
      console.log(`  - Visits with NO employee assignment: ${visitsWithNoEmployee}`);

      // Fetch patients who were converted from nominations
      const convertedNominationPatients = await prisma.nomination.findMany({
        where: {
          convertedToPatientId: { not: null }
        },
        select: {
          convertedToPatientId: true,
          salesId: true,
        }
      });
      const convertedPatientIds = new Set(convertedNominationPatients.map(n => n.convertedToPatientId).filter(Boolean) as string[]);
      const nominationSalesMap = new Map<string, string>();
      convertedNominationPatients.forEach(n => {
        if (n.convertedToPatientId && n.salesId) {
          nominationSalesMap.set(n.convertedToPatientId, n.salesId);
        }
      });

      // Fetch commissions for visits to help determine type for unknown visits
      // We need to check both patient-level and visit-date-level commissions
      const commissions = await prisma.commission.findMany({
        where: {
          patientId: { in: visits.map(v => v.patient.id) },
          type: { in: ['PATIENT_CREATION', 'FOLLOW_UP', 'NOMINATION_CONVERSION'] }
        },
        select: {
          type: true,
          patientId: true,
          description: true,
          createdAt: true,
          period: true
        }
      });

      // Create a map of patient ID to commission type (prioritize PATIENT_CREATION over FOLLOW_UP)
      const patientCommissionMap = new Map<string, 'PATIENT_CREATION' | 'FOLLOW_UP'>();
      // Also create a map of visit ID to commission type (for visit-specific commissions)
      const visitCommissionMap = new Map<string, 'PATIENT_CREATION' | 'FOLLOW_UP'>();
      
      commissions.forEach(comm => {
        if (comm.patientId) {
          const existing = patientCommissionMap.get(comm.patientId);
          // PATIENT_CREATION takes priority
          if (!existing || comm.type === 'PATIENT_CREATION') {
            patientCommissionMap.set(comm.patientId, comm.type as 'PATIENT_CREATION' | 'FOLLOW_UP');
          }
        }
      });

      // Map commissions to specific visits by matching patient and date
      // A PATIENT_CREATION commission created on the same date as a visit indicates it's a new patient visit
      visits.forEach(visit => {
        const visitDate = new Date(visit.visitDate);
        const visitDateStr = visitDate.toISOString().split('T')[0];
        
        // Check if there's a PATIENT_CREATION commission for this patient on the visit date
        const matchingCommission = commissions.find(comm => 
          comm.patientId === visit.patient.id &&
          comm.type === 'PATIENT_CREATION' &&
          (comm.period === visitDateStr || 
           new Date(comm.createdAt).toISOString().split('T')[0] === visitDateStr)
        );
        
        if (matchingCommission) {
          visitCommissionMap.set(visit.id, 'PATIENT_CREATION');
        } else {
          // Check for FOLLOW_UP commission on the visit date
          const followUpCommission = commissions.find(comm =>
            comm.patientId === visit.patient.id &&
            comm.type === 'FOLLOW_UP' &&
            (comm.period === visitDateStr ||
             new Date(comm.createdAt).toISOString().split('T')[0] === visitDateStr)
          );
          
          if (followUpCommission) {
            visitCommissionMap.set(visit.id, 'FOLLOW_UP');
          }
        }
      });

      // Group by employee and type with age breakdown
      const counts: Record<string, {
        newPatient: { total: number; adult: number; child: number };
        existingPatient: { total: number; adult: number; child: number };
        followUpTask: { total: number; adult: number; child: number };
        nominationsVisits: { total: number; adult: number; child: number };
        notBookedVisits: number;
        total: number;
      }> = {};
      
      // Process each visit
      console.log(`\n========== [Visit Counting - Current Month] ==========`);
      console.log(`Query found ${visits.length} visits in database for period`);
      if (visits.length < 300) {
        console.warn(`[WARNING] Only ${visits.length} visits found - expected ~389. This might indicate a query issue.`);
      }
      
      let processedCount = 0;
      let skippedCount = 0;
      let newPatientCount = 0;
      let existingPatientCount = 0;
      let followUpCount = 0;
      let noEmployeeCount = 0;
      const skipReasons: Record<string, number> = {};
      const employeeAssignments: Record<string, number> = {}; // Track which employees get visits
      
      for (const visit of visits) {
        processedCount++;
        
        // SIMPLIFIED LOGIC: Default to existing_patient, only reclassify if:
        // 1. First visit ever → new_patient
        // 2. First visit to hospital → new_patient
        // 3. From follow-up task → follow_up_task
        // Otherwise → existing_patient
        
        // STEP 1: Check if visit is from a follow-up task
        const visitDateStart = new Date(visit.visitDate);
        visitDateStart.setHours(0, 0, 0, 0);
        const visitDateEnd = new Date(visit.visitDate);
        visitDateEnd.setHours(23, 59, 59, 999);
        
        const appointment = await withDbRetry(async () => {
          return await prisma.appointment.findFirst({
            where: {
              patientId: visit.patient.id,
              hospitalId: visit.hospitalId,
              scheduledDate: {
                gte: visitDateStart,
                lte: visitDateEnd
              }
            },
            select: {
              createdFromFollowUpTaskId: true,
              isNotBooked: true
            }
          });
        });
        
        let visitType: 'new_patient' | 'existing_patient' | 'follow_up_task';
        
        if (appointment?.createdFromFollowUpTaskId) {
          // From follow-up task → follow_up_task
          visitType = 'follow_up_task';
          console.log(`[Visit Classification] Visit ${visit.id}: Classified as follow_up_task (from follow-up task)`);
        } else {
          // STEP 2: Check if this is the first visit ever or first to hospital
          const previousVisits = await withDbRetry(async () => {
            return await prisma.visit.findFirst({
              where: {
                patientId: visit.patient.id,
                id: { not: visit.id },
                OR: [
                  { visitDate: { lt: visit.visitDate } },
                  {
                    visitDate: visit.visitDate,
                    createdAt: { lt: visit.createdAt }
                  }
                ]
              },
              select: { id: true },
              orderBy: [
                { visitDate: 'desc' },
                { createdAt: 'desc' }
              ]
            });
          });
          
          const previousVisitsToHospital = await withDbRetry(async () => {
            return await prisma.visit.findFirst({
              where: {
                patientId: visit.patient.id,
                hospitalId: visit.hospitalId,
                id: { not: visit.id },
                OR: [
                  { visitDate: { lt: visit.visitDate } },
                  {
                    visitDate: visit.visitDate,
                    createdAt: { lt: visit.createdAt }
                  }
                ]
              },
              select: { id: true },
              orderBy: [
                { visitDate: 'desc' },
                { createdAt: 'desc' }
              ]
            });
          });
          
          const isFirstVisitEver = !previousVisits;
          const isFirstVisitToHospital = !previousVisitsToHospital;
          
          if (isFirstVisitEver || isFirstVisitToHospital) {
            // First visit ever or first to hospital → new_patient
            visitType = 'new_patient';
            console.log(`[Visit Classification] Visit ${visit.id}: Classified as new_patient (first visit ever: ${isFirstVisitEver}, first to hospital: ${isFirstVisitToHospital})`);
          } else {
            // Otherwise → existing_patient (default)
            visitType = 'existing_patient';
            console.log(`[Visit Classification] Visit ${visit.id}: Classified as existing_patient (has previous visits)`);
          }
        }
        
        console.log(`[Visit Classification] Visit ${visit.id}: Final classification = ${visitType}`);
        
        // STEP 3: Calculate patient age
        const age = calculatePatientAge(visit.patient.dob, visit.patient.nationalId);
        const ageCategory = getAgeCategory(age);
        
        // STEP 4: Check if this visit is from a converted nomination
        const isFromNomination = convertedPatientIds.has(visit.patient.id);
        const nominationSalesId = nominationSalesMap.get(visit.patient.id);
        
        // STEP 5: Assign visit to appropriate employee(s)
        const employeesToCount: Array<{ id: string; type: 'new_patient' | 'existing_patient' | 'follow_up_task' }> = [];
        
        if (visitType === 'new_patient') {
          // New patients: assign to sales person
          const salesId = visit.salesId || visit.patient.salesPersonId;
          if (salesId) {
            employeesToCount.push({ id: salesId, type: 'new_patient' });
            newPatientCount++;
            console.log(`[Visit Assignment] Visit ${visit.id}: NEW PATIENT - Assigned to sales ${salesId}`);
          } else {
            noEmployeeCount++;
            skipReasons['new_no_employee'] = (skipReasons['new_no_employee'] || 0) + 1;
            console.error(`[Visit Assignment] CRITICAL: New patient visit ${visit.id} has NO sales person. Visit will NOT be counted.`);
          }
        } else if (visitType === 'follow_up_task') {
          // Follow-up visits: assign to coordinator
          if (visit.coordinatorId) {
            employeesToCount.push({ id: visit.coordinatorId, type: 'follow_up_task' });
            followUpCount++;
            console.log(`[Visit Assignment] Visit ${visit.id}: FOLLOW-UP - Assigned to coordinator ${visit.coordinatorId}`);
          } else {
            noEmployeeCount++;
            skipReasons['follow_up_no_employee'] = (skipReasons['follow_up_no_employee'] || 0) + 1;
            console.error(`[Visit Assignment] CRITICAL: Follow-up visit ${visit.id} has NO coordinator. Visit will NOT be counted.`);
          }
        } else if (visitType === 'existing_patient') {
          // Existing patients: assign to coordinator (all visits have coordinators)
          // Fallback to sales person if coordinator is missing (data integrity issue)
          let employeeIdToCount: string | null = null;
          
          if (visit.coordinatorId) {
            employeeIdToCount = visit.coordinatorId;
          } else {
            // Data integrity issue - fallback to sales person
            console.error(`[Visit Assignment] WARNING: Visit ${visit.id} has NO coordinatorId. Falling back to sales person.`);
            employeeIdToCount = visit.salesId || visit.patient.salesPersonId || null;
          }
          
          if (employeeIdToCount) {
            employeesToCount.push({ id: employeeIdToCount, type: 'existing_patient' });
            existingPatientCount++;
            console.log(`[Visit Assignment] Visit ${visit.id}: EXISTING PATIENT - Assigned to ${visit.coordinatorId ? 'coordinator' : 'sales'} ${employeeIdToCount}`);
          } else {
            noEmployeeCount++;
            skipReasons['existing_no_employee'] = (skipReasons['existing_no_employee'] || 0) + 1;
            console.error(`[Visit Assignment] CRITICAL: Existing patient visit ${visit.id} has NO employee assignment. Visit will NOT be counted.`);
          }
        }
        
        // Count for each relevant employee
        for (const emp of employeesToCount) {
          if (!counts[emp.id]) {
            counts[emp.id] = {
              newPatient: { total: 0, adult: 0, child: 0 },
              existingPatient: { total: 0, adult: 0, child: 0 },
              followUpTask: { total: 0, adult: 0, child: 0 },
              nominationsVisits: { total: 0, adult: 0, child: 0 },
              notBookedVisits: 0,
              total: 0
            };
          }
          
          const visitTypeKey = emp.type === 'new_patient' ? 'newPatient' : 
                               emp.type === 'existing_patient' ? 'existingPatient' : 'followUpTask';
          
          counts[emp.id][visitTypeKey].total += 1;
          counts[emp.id].total += 1;
          
          if (ageCategory === 'adult') {
            counts[emp.id][visitTypeKey].adult += 1;
          } else if (ageCategory === 'child') {
            counts[emp.id][visitTypeKey].child += 1;
          }
          
          // If this visit is from a converted nomination and the sales person matches, count it
          if (isFromNomination && nominationSalesId && nominationSalesId === emp.id && emp.type === 'new_patient') {
            counts[emp.id].nominationsVisits.total += 1;
            if (ageCategory === 'adult') {
              counts[emp.id].nominationsVisits.adult += 1;
            } else if (ageCategory === 'child') {
              counts[emp.id].nominationsVisits.child += 1;
            }
          }
        }
      }
      
      // Log summary for debugging
      const totalCounted = Object.values(counts).reduce((sum, emp) => 
        sum + emp.newPatient.total + emp.existingPatient.total + emp.followUpTask.total, 0
      );
      console.log(`[Visit Counting Summary] Total visits processed: ${visits.length}, Total counted: ${totalCounted}, New: ${Object.values(counts).reduce((s, e) => s + e.newPatient.total, 0)}, Existing: ${Object.values(counts).reduce((s, e) => s + e.existingPatient.total, 0)}, Follow-up: ${Object.values(counts).reduce((s, e) => s + e.followUpTask.total, 0)}`);

      return counts;
    });

    // Get appointment counts per employee by type (newPatient, existingPatient, followUpTask)
    // Use scheduledDate (when appointment is scheduled) instead of createdAt (when it was created)
    const appointmentCounts = await withDbRetry(async () => {
      const appointmentWhere: any = {};
      
      // Use shared Dubai timezone date utilities
      // Reuse startDateStr and endDateStr from function scope, or use undefined if not set
      const appointmentStartDateStr = startDateStr || undefined;
      const appointmentEndDateStr = endDateStr || undefined;
      const dateRange = getDubaiRangeFromStrings(appointmentStartDateStr, appointmentEndDateStr, true);
      
      // Filter by scheduledDate (when appointment is scheduled), not createdAt
      if (dateRange.start || dateRange.end) {
        appointmentWhere.scheduledDate = {};
        if (dateRange.start) {
          appointmentWhere.scheduledDate.gte = dateRange.start;
        }
        if (dateRange.end) {
          appointmentWhere.scheduledDate.lte = dateRange.end;
        }
      }

      // Get appointments with their type-determining fields
      const appointments = await prisma.appointment.findMany({
        where: appointmentWhere,
        select: {
          id: true,
          createdById: true,
          salesPersonId: true,
          isNewPatientAtCreation: true,
          createdFromFollowUpTaskId: true,
        }
      });

      const counts: Record<string, {
        newPatient: number;
        existingPatient: number;
        followUpTask: number;
        total: number;
      }> = {};

      appointments.forEach(apt => {
        // Determine appointment type
        const appointmentType = determineAppointmentType({
          isNewPatientAtCreation: apt.isNewPatientAtCreation,
          createdFromFollowUpTaskId: apt.createdFromFollowUpTaskId
        });

        // Determine which employees to count for this appointment
        // Only count for the creator (createdById), not for salesPersonId
        const employeesToCount: string[] = [];
        if (apt.createdById) {
          employeesToCount.push(apt.createdById);
        }

        // Count for each relevant employee
        employeesToCount.forEach(empId => {
          if (!counts[empId]) {
            counts[empId] = {
              newPatient: 0,
              existingPatient: 0,
              followUpTask: 0,
              total: 0
            };
          }

          if (appointmentType === 'new_patient') {
            counts[empId].newPatient += 1;
          } else if (appointmentType === 'existing_patient') {
            counts[empId].existingPatient += 1;
          } else if (appointmentType === 'follow_up_task') {
            counts[empId].followUpTask += 1;
          }
          counts[empId].total += 1;
        });
      });

      return counts;
    });

    // Get appointed specialties count per coordinator from connected visits
    // Simple approach: Find visits where coordinator is connected, count appointed specialties
    const appointmentSpecialtiesCounts = await withDbRetry(async () => {
      // Use shared Dubai timezone date utilities
      // Reuse startDateStr and endDateStr from function scope, or use undefined if not set
      const specialtyDateStartStr = startDateStr || undefined;
      const specialtyDateEndStr = endDateStr || undefined;
      const specialtyDateRange = getDubaiRangeFromStrings(specialtyDateStartStr, specialtyDateEndStr, true);
      
      const visits = await prisma.visit.findMany({
        where: {
          visitDate: {
            ...(specialtyDateRange.start ? { gte: specialtyDateRange.start } : {}),
            ...(specialtyDateRange.end ? { lte: specialtyDateRange.end } : {}),
          },
          OR: [
            {
              coordinatorId: {
                not: undefined
              }
            },
            {
              appointments: {
                some: {}
              }
            }
          ]
        },
        select: {
          id: true,
          coordinatorId: true,
          visitDate: true,
          appointments: {
            select: {
              id: true,
              appointmentSpecialities: {
                select: {
                  id: true,
                  specialityId: true,
                  doctorId: true,
                  scheduledTime: true
                }
              }
            }
          },
          visitSpecialities: {
            select: {
              id: true,
              specialityId: true,
              doctorId: true,
              scheduledTime: true,
              details: true
            }
          }
        }
      });

      // Get all appointment IDs from these visits
      const appointmentIds: string[] = [];
      visits.forEach(visit => {
        visit.appointments.forEach(apt => {
          if (apt.id) appointmentIds.push(apt.id);
        });
      });

      // Get all tasks for these appointments to find coordinators assigned via tasks
      const tasks = await prisma.task.findMany({
        where: {
          relatedEntityType: 'appointment',
          relatedEntityId: { in: appointmentIds }
        },
        select: {
          assignedToId: true,
          relatedEntityId: true
        }
      });

      // Create map of appointmentId -> coordinatorId (from tasks)
      const appointmentCoordinatorMap = new Map<string, string>();
      tasks.forEach(task => {
        if (task.relatedEntityId && task.assignedToId) {
          appointmentCoordinatorMap.set(task.relatedEntityId, task.assignedToId);
        }
      });

      const counts: Record<string, { total: number; added: number }> = {};
      
      // For each visit, count all specialties (appointed + added)
      visits.forEach(visit => {
        // Find coordinators connected to this visit:
        // 1. Directly assigned to visit (visit.coordinatorId)
        // 2. Assigned to appointment via task
        const connectedCoordinatorIds = new Set<string>();
        
        // Add direct coordinator
        if (visit.coordinatorId) {
          connectedCoordinatorIds.add(visit.coordinatorId);
        }
        
        // Add coordinators from appointment tasks
        visit.appointments.forEach(apt => {
          const coordinatorId = appointmentCoordinatorMap.get(apt.id);
          if (coordinatorId) {
            connectedCoordinatorIds.add(coordinatorId);
          }
        });
        
        if (connectedCoordinatorIds.size > 0 && visit.visitSpecialities.length > 0) {
          // CRITICAL FIX: Only count for the PRIMARY coordinator to avoid double counting
          // Priority: visit.coordinatorId > task coordinator
          // If visit has a direct coordinatorId, use only that one
          // Otherwise, use the first task coordinator
          let primaryCoordinatorId: string | null = null;
          
          if (visit.coordinatorId) {
            // Direct coordinator assignment takes priority
            primaryCoordinatorId = visit.coordinatorId;
          } else {
            // Use first task coordinator if no direct assignment
            const taskCoordinatorIds = Array.from(connectedCoordinatorIds).filter(id => id !== visit.coordinatorId);
            if (taskCoordinatorIds.length > 0) {
              primaryCoordinatorId = taskCoordinatorIds[0];
            }
          }
          
          // Only process if we have a primary coordinator
          if (primaryCoordinatorId) {
            // Use the same logic as employee performance page to determine appointed vs added
            // Count ALL visit specialties (both appointed and added) for totalSpecialties
            // Count only "added" specialties (those that are NOT appointed) for addedSpecialties
            let totalCount = 0;
            let addedCount = 0;
            
            // CRITICAL: Count ALL specialties in the visit for totalCount
            // This should be the length of visitSpecialities array
            totalCount = visit.visitSpecialities.length;
            
            // Now count only the "added" ones (not appointed)
            visit.visitSpecialities.forEach((vs: any) => {
              // Check if details includes "Attended from appointment"
              const isAppointedByDetails = vs.details && vs.details.includes('Attended from appointment');
              
              // Try to match with appointment specialties
              let matchedAppointmentSpecialty = null;
              if (visit.appointments && visit.appointments.length > 0) {
                for (const appointment of visit.appointments) {
                  if (appointment.appointmentSpecialities) {
                    matchedAppointmentSpecialty = appointment.appointmentSpecialities.find((aptSpec: any) => 
                      aptSpec.specialityId === vs.specialityId &&
                      aptSpec.doctorId === vs.doctorId &&
                      Math.abs(new Date(aptSpec.scheduledTime).getTime() - new Date(vs.scheduledTime).getTime()) < 60000 // Within 1 minute
                    );
                    if (matchedAppointmentSpecialty) break; // Found a match, stop searching
                  }
                }
              }
              
              // Determine if this specialty is appointed or added
              const isAppointed = isAppointedByDetails || matchedAppointmentSpecialty;
              
              // Count only "added" specialties (those that are NOT appointed)
              if (!isAppointed) {
                addedCount++;
              }
            });
            
            // Assign counts ONLY to the primary coordinator (no double counting)
            if (!counts[primaryCoordinatorId]) {
              counts[primaryCoordinatorId] = { total: 0, added: 0 };
            }
            counts[primaryCoordinatorId].total += totalCount;
            counts[primaryCoordinatorId].added += addedCount;
            
            // Debug logging
            if (connectedCoordinatorIds.size > 1) {
              console.log(`[COUNTING] Visit ${visit.id}: Multiple coordinators found (${Array.from(connectedCoordinatorIds).join(', ')}), using primary: ${primaryCoordinatorId}`);
            }
          }
        } else if (connectedCoordinatorIds.size > 0 && visit.visitSpecialities.length === 0) {
          // Debug: Log visits with coordinators but no specialties
          console.log(`Visit ${visit.id} has coordinators but no visitSpecialities. Coordinators:`, Array.from(connectedCoordinatorIds));
        }
      });

      // Debug: Log the counts to see what we're getting
      if (Object.keys(counts).length > 0) {
        console.log('appointmentSpecialtiesCounts result:', {
          totalCoordinators: Object.keys(counts).length,
          allCoordinatorIds: Object.keys(counts),
          sampleCounts: Object.entries(counts).slice(0, 10).map(([id, data]) => ({ coordinatorId: id, total: data.total, added: data.added })),
          totalVisitsProcessed: visits.length,
          visitsWithSpecialties: visits.filter(v => v.visitSpecialities && v.visitSpecialities.length > 0).length
        });
      } else {
        console.log('appointmentSpecialtiesCounts: No coordinators found. Total visits:', visits.length);
      }

      return counts;
    });

    // Query visits directly for each coordinator employee to ensure correct ID matching
    // This fixes the issue where coordinator IDs from visits don't match employee IDs
    const coordinatorSpecialtiesMap = new Map<string, { total: number; added: number }>();
    const coordinatorTotalVisitsMap = new Map<string, number>();
    
    // Get all coordinator employees
    const coordinatorEmployees = await withDbRetry(async () => {
      return await prisma.employee.findMany({
        where: {
          employeeRoles: {
            some: {
              role: 'coordinator',
              isActive: true
            }
          }
        },
        select: {
          id: true,
          name: true
        }
      });
    });

    // Calculate date range using shared Dubai timezone utilities
    // Reuse startDateStr and endDateStr from function scope, or use undefined if not set
    const coordinatorStartDateStr = startDateStr || undefined;
    const coordinatorEndDateStr = endDateStr || undefined;
    const coordinatorDateRange = getDubaiRangeFromStrings(coordinatorStartDateStr, coordinatorEndDateStr, true);
    const effectiveStartDate = coordinatorDateRange.start!;
    const effectiveEndDate = coordinatorDateRange.end!;

    // Query visits for each coordinator and count specialties
    for (const coordinator of coordinatorEmployees) {
      // Count ALL visits where this coordinator is assigned (regardless of visit type)
      const totalCoordinatorVisitsCount = await prisma.visit.count({
        where: {
          visitDate: {
            gte: effectiveStartDate,
            lte: effectiveEndDate
          },
          coordinatorId: coordinator.id
        }
      });
      coordinatorTotalVisitsMap.set(coordinator.id, totalCoordinatorVisitsCount);
      
      // First, get visits with coordinatorId
      const directVisits = await prisma.visit.findMany({
        where: {
          visitDate: {
            gte: effectiveStartDate,
            lte: effectiveEndDate
          },
          coordinatorId: coordinator.id
        },
        select: {
          id: true,
          visitSpecialities: {
            select: {
              id: true,
              specialityId: true,
              doctorId: true,
              scheduledTime: true,
              details: true
            }
          },
          appointments: {
            select: {
              id: true,
              appointmentSpecialities: {
                select: {
                  id: true,
                  specialityId: true,
                  doctorId: true,
                  scheduledTime: true
                }
              }
            }
          }
        }
      });

      // Get appointment IDs from all visits
      const appointmentIds: string[] = [];
      directVisits.forEach(visit => {
        visit.appointments.forEach(apt => {
          if (apt.id) appointmentIds.push(apt.id);
        });
      });

      // Get visits with appointments that have tasks assigned to this coordinator
      const taskAppointmentIds = appointmentIds.length > 0 ? await prisma.task.findMany({
        where: {
          relatedEntityType: 'appointment',
          relatedEntityId: { in: appointmentIds },
          assignedToId: coordinator.id
        },
        select: {
          relatedEntityId: true
        }
      }).then(tasks => tasks.map(t => t.relatedEntityId).filter(Boolean) as string[]) : [];

      // Get visits for appointments with coordinator tasks
      const taskVisits = taskAppointmentIds.length > 0 ? await prisma.visit.findMany({
        where: {
          visitDate: {
            gte: effectiveStartDate,
            lte: effectiveEndDate
          },
          appointments: {
            some: {
              id: { in: taskAppointmentIds }
            }
          }
        },
        select: {
          id: true,
          visitSpecialities: {
            select: {
              id: true,
              specialityId: true,
              doctorId: true,
              scheduledTime: true,
              details: true
            }
          },
          appointments: {
            select: {
              id: true,
              appointmentSpecialities: {
                select: {
                  id: true,
                  specialityId: true,
                  doctorId: true,
                  scheduledTime: true
                }
              }
            }
          }
        }
      }) : [];

      // Combine and deduplicate visits
      const allVisitIds = new Set([...directVisits.map(v => v.id), ...taskVisits.map(v => v.id)]);
      const coordinatorVisits = [...directVisits, ...taskVisits].filter((v, index, self) => 
        index === self.findIndex(visit => visit.id === v.id)
      );

      let totalCount = 0;
      let addedCount = 0;

      coordinatorVisits.forEach(visit => {
        if (visit.visitSpecialities && visit.visitSpecialities.length > 0) {
          // Count ALL specialties for total
          totalCount += visit.visitSpecialities.length;

          // Count only "added" specialties (not appointed)
          visit.visitSpecialities.forEach((vs: any) => {
            const isAppointedByDetails = vs.details && vs.details.includes('Attended from appointment');
            
            let matchedAppointmentSpecialty = null;
            if (visit.appointments && visit.appointments.length > 0) {
              for (const appointment of visit.appointments) {
                if (appointment.appointmentSpecialities) {
                  matchedAppointmentSpecialty = appointment.appointmentSpecialities.find((aptSpec: any) => 
                    aptSpec.specialityId === vs.specialityId &&
                    aptSpec.doctorId === vs.doctorId &&
                    Math.abs(new Date(aptSpec.scheduledTime).getTime() - new Date(vs.scheduledTime).getTime()) < 60000
                  );
                  if (matchedAppointmentSpecialty) break;
                }
              }
            }
            
            const isAppointed = isAppointedByDetails || matchedAppointmentSpecialty;
            if (!isAppointed) {
              addedCount++;
            }
          });
        }
      });

      if (totalCount > 0 || addedCount > 0) {
        coordinatorSpecialtiesMap.set(coordinator.id, { total: totalCount, added: addedCount });
        console.log(`[DIRECT QUERY] Coordinator ${coordinator.id} (${coordinator.name}): total=${totalCount}, added=${addedCount}`);
      }
    }

    // Helper function to calculate percentage change
    const calculateChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    // Format the response with detailed commission breakdown
    // Note: We need to make this async to calculate actual new patient visits for sales employees
    const result = await Promise.all(employees.map(async (employee) => {
      const employeeCommissions = commissionBreakdown.filter(c => c.employeeId === employee.id);
      const currentMonthData = currentMonthCommissions.find(c => c.employeeId === employee.id);
      const previousMonthEmployeeCommissions = previousMonthCommissions.filter(c => c.employeeId === employee.id);

      const breakdown = {
        newPatients: 0,        // Sales: When a new patient is created
        addedSpecialties: 0,   // Coordinator: When specialty is added to appointment
        nominations: 0,        // Coordinator: When nominated patient converts to patient
        followUps: 0,          // Coordinator: When existing patient comes for second visit
        manualAdjustments: 0   // Manual adjustments
      };

      const previousMonthBreakdown = {
        newPatients: 0,
        addedSpecialties: 0,
        nominations: 0,
        followUps: 0,
        manualAdjustments: 0
      };

      employeeCommissions.forEach(commission => {
        const count = commission._count.id || 0; // Count the number of commission records, not sum amounts
        switch (commission.type) {
          case 'PATIENT_CREATION':
            // Sales commission: New patient created
            breakdown.newPatients = count;
            break;
          case 'VISIT_SPECIALITY_ADDITION':
            // Coordinator commission: Specialty added to appointment
            // Commission records are the source of truth - they're created when specialties are actually added
            breakdown.addedSpecialties = count;
            if (count > 0) {
              console.log(`[COMMISSION COUNT] Coordinator ${employee.id} (${employee.name}): ${count} added specialties from commission records`);
            }
            break;
          case 'NOMINATION_CONVERSION':
            // Coordinator commission: Nominated patient converted to patient
            breakdown.nominations = count;
            break;
          case 'FOLLOW_UP':
            // Coordinator commission: Existing patient returns for visit
            breakdown.followUps = count;
            break;
          case 'MANUAL_ADJUSTMENT':
            // Manual commission adjustments
            breakdown.manualAdjustments = count;
            break;
        }
      });
      
      // CRITICAL FIX: Commission records are the source of truth for added specialties
      // Commission records are created when specialties are actually added (VISIT_SPECIALITY_ADDITION)
      // They are more accurate than visit-based counting which might incorrectly classify specialties
      // DO NOT override commission records with visit counts - commission records are accurate
      
      // Log the final added specialties count for debugging
      if (breakdown.addedSpecialties > 0) {
        console.log(`[FINAL] Coordinator ${employee.id} (${employee.name}): Using ${breakdown.addedSpecialties} added specialties from commission records (source of truth)`);
      }
      
      // Only use visit counts as fallback if commission records are 0 (edge case)
      if (breakdown.addedSpecialties === 0) {
        const coordinatorVisitData = appointmentSpecialtiesCounts[employee.id];
        if (coordinatorVisitData && coordinatorVisitData.added > 0) {
          console.warn(`[FALLBACK] Coordinator ${employee.id} (${employee.name}): No commission records but visit data shows ${coordinatorVisitData.added} added specialties. Using visit data as fallback.`);
          breakdown.addedSpecialties = coordinatorVisitData.added || 0;
        }
      }
      
      // For sales employees: Override newPatients with actual new patient visits count and age breakdown (more accurate)
      // This ensures the count matches the actual visits shown in the "New Patient Visits" tab
      // Always override (even when count is 0) to handle patient reassignments correctly
      const employeeRoles = employee.employeeRoles?.map(er => er.role) || [];
      const isSales = employeeRoles.includes('sales');
      
      // Debug logging to help identify issues
      if (breakdown.newPatients > 0) {
        console.log(`[Commission Breakdown] Employee ${employee.id} (${employee.name}): Initial newPatients from commission records: ${breakdown.newPatients}, Roles: [${employeeRoles.join(', ')}], IsSales: ${isSales}`);
      }
      
      if (isSales) {
        // Calculate date range for the helper function
        // Use the same UTC date conversion logic as visit counts to ensure consistency
        // This matches how commission records are filtered by period (YYYY-MM-DD string)
        let startDateObj: Date | undefined;
        let endDateObj: Date | undefined;
        
        if (startDateStr) {
          // Parse date string (YYYY-MM-DD) - use local timezone to match performance page
          // Performance page uses: new Date(year, month - 1, day, 0, 0, 0, 0)
          // This ensures consistency between performance page and commission analytics
          const dateParts = startDateStr.split('-');
          const year = parseInt(dateParts[0]);
          const month = parseInt(dateParts[1]) - 1; // Month is 0-indexed
          const day = parseInt(dateParts[2]);
          // Create local timezone date for start of day (matches performance page)
          startDateObj = new Date(year, month, day, 0, 0, 0, 0);
        }
        
        if (endDateStr) {
          // Parse date string - use local timezone to match performance page
          // Performance page uses: new Date(year, month - 1, day, 23, 59, 59, 999)
          const dateParts = endDateStr.split('-');
          const year = parseInt(dateParts[0]);
          const month = parseInt(dateParts[1]) - 1; // Month is 0-indexed
          const day = parseInt(dateParts[2]);
          // Create local timezone date for end of day (matches performance page)
          endDateObj = new Date(year, month, day, 23, 59, 59, 999);
        }
        
        // Use async helper to get actual new patient visits with age information
        const actualNewPatientVisits = await getActualNewPatientVisitsWithAge(
          employee.id,
          startDateObj,
          endDateObj
        );
        
        // Always override for sales employees to use visit-based calculation (handles reassignments correctly)
        // This ensures the count is based on current patient assignments, not old commission records
        const originalNewPatientsCount = breakdown.newPatients;
        breakdown.newPatients = actualNewPatientVisits.length;
        console.log(`[Commission Breakdown] Sales employee ${employee.id} (${employee.name}): Overriding newPatients count: ${originalNewPatientsCount} -> ${actualNewPatientVisits.length} (using actual visits count, date range: ${startDateStr || 'all'} to ${endDateStr || 'all'})`);
        
        // Store age breakdown to update later after commissionAgeData is declared
        let adultCount = 0;
        let childCount = 0;
        for (const visit of actualNewPatientVisits) {
          if (visit.ageCategory === 'adult') {
            adultCount++;
          } else if (visit.ageCategory === 'child') {
            childCount++;
          }
        }
        
        // Store for later update (commissionAgeData is declared after this block)
        (employee as any)._actualNewPatientAgeBreakdown = {
          total: actualNewPatientVisits.length,
          adult: adultCount,
          child: childCount
        };
        
        if (actualNewPatientVisits.length > 0) {
          console.log(`[Commission Breakdown] Sales employee ${employee.id} (${employee.name}): Age breakdown - Adults: ${adultCount}, Children: ${childCount}`);
        }
      } else if (breakdown.newPatients > 0) {
        // Log if non-sales employee has PATIENT_CREATION commissions (shouldn't happen normally)
        console.warn(`[Commission Breakdown] Non-sales employee ${employee.id} (${employee.name}) has ${breakdown.newPatients} PATIENT_CREATION commissions. Roles: [${employeeRoles.join(', ')}]`);
      }
      
      // Debug logging for troubleshooting
      if (currentMonthData && currentMonthData._count.id > 0) {
        console.log(`Employee ${employee.id} (${employee.name}):`, {
          currentMonthCommissions: currentMonthData._count.id,
          employeeCommissionsFound: employeeCommissions.length,
          breakdown,
          commissionTypes: employeeCommissions.map(c => ({ type: c.type, count: c._count.id }))
        });
      }

      // Calculate previous month breakdown
      previousMonthEmployeeCommissions.forEach(commission => {
        const count = commission._count.id || 0;
        switch (commission.type) {
          case 'PATIENT_CREATION':
            previousMonthBreakdown.newPatients = count;
            break;
          case 'VISIT_SPECIALITY_ADDITION':
            previousMonthBreakdown.addedSpecialties = count;
            break;
          case 'NOMINATION_CONVERSION':
            previousMonthBreakdown.nominations = count;
            break;
          case 'FOLLOW_UP':
            previousMonthBreakdown.followUps = count;
            break;
          case 'MANUAL_ADJUSTMENT':
            previousMonthBreakdown.manualAdjustments = count;
            break;
        }
      });

      // Get values for current and previous month
      const currentTotalCommissions = currentMonthData?._count.id || 0;
      const previousTotalCommissions = previousMonthEmployeeCommissions.reduce((sum, c) => sum + c._count.id, 0);
      const currentRevenue = currentMonthRevenue[employee.id] || 0;
      const previousRevenue = previousMonthRevenue[employee.id] || 0;
      // Use commission-based age breakdown for commission types, fallback to visit counts for existing patients
      let commissionAgeData = commissionAgeBreakdown[employee.id] || {
        newPatient: { total: 0, adult: 0, child: 0 },
        followUpTask: { total: 0, adult: 0, child: 0 },
        nominationsVisits: { total: 0, adult: 0, child: 0 }
      };
      
      // For sales employees, override with actual visits age breakdown if available
      if ((employee as any)._actualNewPatientAgeBreakdown) {
        commissionAgeData.newPatient = (employee as any)._actualNewPatientAgeBreakdown;
        delete (employee as any)._actualNewPatientAgeBreakdown; // Clean up
      }
      
      const visitCountsData = visitCounts[employee.id] || { 
        newPatient: { total: 0, adult: 0, child: 0 },
        existingPatient: { total: 0, adult: 0, child: 0 },
        followUpTask: { total: 0, adult: 0, child: 0 },
        nominationsVisits: { total: 0, adult: 0, child: 0 },
        notBookedVisits: 0,
        total: 0
      };
      
      // Debug logging for team member details
      if (employeeId) {
        console.log(`[Team Member Details] Employee ${employee.id} (${employee.name}):`, {
          visitCountsData,
          hasVisitCounts: !!visitCounts[employee.id],
          visitCountsKeys: Object.keys(visitCounts),
          appointmentCounts: appointmentCounts[employee.id],
          hasAppointmentCounts: !!appointmentCounts[employee.id],
          appointmentCountsKeys: Object.keys(appointmentCounts),
          breakdown,
          employeeCommissions: employeeCommissions.length
        });
      }
      
      // Log visit counts for debugging - will check appointments later after they're defined

      // Merge: Use commission-based age breakdown for commission types, visit counts for existing patients
      // IMPORTANT: Ensure visits with PATIENT_CREATION commissions are NOT counted in existingPatient
      // The visit counting logic should already handle this, but we ensure no double-counting here
      // If a visit has a PATIENT_CREATION commission, it's a new patient visit and should only appear in newPatient
      const existingPatientCount = visitCountsData.existingPatient || { total: 0, adult: 0, child: 0 };
      
      // Calculate total visits: newPatient (from commissions) + existingPatient (visits without PATIENT_CREATION) + followUp (from commissions)
      const totalVisits = (breakdown.newPatients || 0) + existingPatientCount.total + (breakdown.followUps || 0);

      // Get total coordinator visits count (all visits where employee is coordinator)
      const isCoordinator = employee.employeeRoles?.some(er => er.role === 'coordinator') || false;
      const totalCoordinatorVisits = isCoordinator 
        ? (coordinatorTotalVisitsMap.get(employee.id) || 0)
        : undefined;
      
      const currentVisits = {
        newPatient: {
          total: breakdown.newPatients || 0, // Use commission count (PATIENT_CREATION commissions)
          adult: commissionAgeData.newPatient.adult || 0,
          child: commissionAgeData.newPatient.child || 0
        },
        existingPatient: existingPatientCount, // Visits classified as existing_patient (should exclude those with PATIENT_CREATION)
        followUpTask: {
          total: breakdown.followUps || 0, // Use commission count (FOLLOW_UP commissions)
          adult: commissionAgeData.followUpTask.adult || 0,
          child: commissionAgeData.followUpTask.child || 0
        },
        nominationsVisits: {
          total: breakdown.nominations || 0, // Use commission count
          adult: commissionAgeData.nominationsVisits.adult || 0,
          child: commissionAgeData.nominationsVisits.child || 0
        },
        notBookedVisits: visitCountsData.notBookedVisits || 0,
        totalCoordinatorVisits: totalCoordinatorVisits,
        total: totalVisits
      };
      
      // For previous month, use visit counts (age breakdown from previous month visits)
      const previousVisits = previousMonthVisitCounts[employee.id] || { 
        newPatient: { total: 0, adult: 0, child: 0 },
        existingPatient: { total: 0, adult: 0, child: 0 },
        followUpTask: { total: 0, adult: 0, child: 0 },
        nominationsVisits: { total: 0, adult: 0, child: 0 },
        notBookedVisits: 0,
        total: 0
      };
      
      // Calculate specialties from visits
      // First, try the direct query map (most accurate, ensures ID matching)
      let visitSpecialtiesDataRaw = coordinatorSpecialtiesMap.get(employee.id);
      
      // Fallback to appointmentSpecialtiesCounts if not found in direct query
      if (!visitSpecialtiesDataRaw) {
        visitSpecialtiesDataRaw = appointmentSpecialtiesCounts[employee.id];
      }
      
      // CRITICAL FIX: Do NOT use fallback to other coordinators' data
      // If the employee ID doesn't match, it means they have no visits/specialties
      // Using another coordinator's data would show incorrect numbers
      if (!visitSpecialtiesDataRaw) {
        // Employee has no visit data - this is correct, they have 0 specialties
        visitSpecialtiesDataRaw = undefined;
      }
      
      // If visitTotalSpecialties is 0 but we have addedSpecialties, we need to query visits directly
      // to get the correct total count (including appointed specialties)
      let needsDirectQuery = false;
      if (visitSpecialtiesDataRaw && visitSpecialtiesDataRaw.total === 0 && visitSpecialtiesDataRaw.added > 0) {
        needsDirectQuery = true;
        console.warn(`[DIRECT QUERY NEEDED] Coordinator ${employee.id} (${employee.name}): visitTotalSpecialties is 0 but added is ${visitSpecialtiesDataRaw.added}. Querying visits directly.`);
      }
      
      // Handle both old format (number) and new format ({ total, added })
      let visitSpecialtiesData: { total: number; added: number };
      if (!visitSpecialtiesDataRaw) {
        visitSpecialtiesData = { total: 0, added: 0 };
      } else if (typeof visitSpecialtiesDataRaw === 'number') {
        // Legacy format - treat as total, added is 0
        visitSpecialtiesData = { total: visitSpecialtiesDataRaw, added: 0 };
      } else {
        // New format
        visitSpecialtiesData = visitSpecialtiesDataRaw;
      }
      
      // For coordinators: 
      // - addedSpecialties should be the count of "added" specialties from visits (those with "added" badge)
      // - totalSpecialties should be the count of ALL specialties from visits (appointed + added)
      // Use visit counts as the primary source (more accurate than commission records)
      // Visit counts represent the actual specialties in visits, matching the employee performance page logic
      const visitAddedSpecialties = visitSpecialtiesData.added || 0;
      const visitTotalSpecialties = visitSpecialtiesData.total || 0;
      
      // For coordinators:
      // - addedSpecialties = count of "added" specialties (those with "added" badge, NOT appointed)
      // - totalSpecialties = count of ALL specialties (appointed + added)
      // CRITICAL: breakdown.addedSpecialties is the source of truth (set from visit data or commission records)
      // This is what the frontend displays and it's correct (showing 1, 5, etc.)
      const addedSpecialties = breakdown.addedSpecialties || 0;
      
      // Calculate totalSpecialties = addedSpecialties + appointedSpecialties
      // If visitTotalSpecialties is correct (non-zero), use it
      // Otherwise, we need to calculate appointedSpecialties and add it to addedSpecialties
      let totalSpecialties = visitTotalSpecialties;
      
      // If visitTotalSpecialties is 0 but we have addedSpecialties, this means:
      // - The coordinator has commission records (addedSpecialties > 0)
      // - But no visit data was found (visitTotalSpecialties = 0)
      // This could happen if:
      //   1. Commission records exist but visits were deleted
      //   2. Commission records are incorrect
      //   3. Visit data doesn't match employee ID
      // CRITICAL FIX: Do NOT try to match by count or use other coordinators' data
      // Only use data that actually matches the employee ID
      if (totalSpecialties === 0 && addedSpecialties > 0) {
        console.warn(`[WARNING] Coordinator ${employee.id} (${employee.name}): visitTotalSpecialties is 0 but addedSpecialties is ${addedSpecialties}.`);
        console.warn(`  - This may indicate commission records without matching visits, or ID mismatch.`);
        console.warn(`  - Using addedSpecialties as totalSpecialties (minimum value).`);
        // Use addedSpecialties as minimum - this is the safest approach
        // We can't use other coordinators' data as that would be incorrect
        totalSpecialties = addedSpecialties;
      } else if (totalSpecialties > 0) {
        // visitTotalSpecialties is correct, use it
        // But ensure it's at least equal to addedSpecialties (safety check)
        totalSpecialties = Math.max(totalSpecialties, addedSpecialties);
      } else {
        // Both are 0, which is fine
        totalSpecialties = 0;
      }
      
      // Final safety check: totalSpecialties must ALWAYS be >= addedSpecialties
      if (totalSpecialties < addedSpecialties) {
        console.error(`[CRITICAL] Coordinator ${employee.id} (${employee.name}): totalSpecialties (${totalSpecialties}) < addedSpecialties (${addedSpecialties}). Forcing fix.`);
        totalSpecialties = addedSpecialties;
      }
      
      // Log final values for debugging
      console.log(`[FINAL] Coordinator ${employee.id} (${employee.name}): totalSpecialties=${totalSpecialties}, addedSpecialties=${addedSpecialties}, visitTotalSpecialties=${visitTotalSpecialties}, visitAddedSpecialties=${visitAddedSpecialties}`);
      
      // Debug logging - log when there's visit data or when addedSpecialties > 0 (indicating coordinator activity)
      if (visitTotalSpecialties > 0 || visitAddedSpecialties > 0 || breakdown.addedSpecialties > 0 || visitSpecialtiesDataRaw) {
        console.log(`Employee ${employee.id} (${employee.name}):`, {
          visitSpecialtiesDataRaw,
          visitSpecialtiesData,
          visitAddedSpecialties,
          visitTotalSpecialties,
          breakdownAddedSpecialties: breakdown.addedSpecialties,
          finalAddedSpecialties: addedSpecialties,
          finalTotalSpecialties: totalSpecialties,
          appointmentSpecialtiesCountsKey: employee.id,
          hasVisitData: !!visitSpecialtiesDataRaw,
          allAppointmentSpecialtiesCountsKeys: Object.keys(appointmentSpecialtiesCounts)
        });
      }
      
      // Get appointment counts (number of created appointments by type)
      const currentAppointmentCounts = appointmentCounts[employee.id] || {
        newPatient: 0,
        existingPatient: 0,
        followUpTask: 0,
        total: 0
      };
      
      const previousAppointmentCounts = previousMonthAppointmentCounts[employee.id] || {
        newPatient: 0,
        existingPatient: 0,
        followUpTask: 0,
        total: 0
      };

      // Appointments refer to the number of created appointments by type
      const currentAppointments = {
        newPatient: currentAppointmentCounts.newPatient,
        existingPatient: currentAppointmentCounts.existingPatient,
        followUpTask: currentAppointmentCounts.followUpTask,
        total: currentAppointmentCounts.total
      };
      const previousAppointments = {
        newPatient: previousAppointmentCounts.newPatient,
        existingPatient: previousAppointmentCounts.existingPatient,
        followUpTask: previousAppointmentCounts.followUpTask,
        total: previousAppointmentCounts.total
      };

      // Calculate total commissions from breakdown (sum of all commission types)
      // This should always match the sum of individual commission types
      const totalCommissionsFromBreakdown = 
        (breakdown.newPatients || 0) + 
        (breakdown.addedSpecialties || 0) + 
        (breakdown.nominations || 0) + 
        (breakdown.followUps || 0) + 
        (breakdown.manualAdjustments || 0);

      // Ensure total is always calculated from breakdown, never from cached employee.commissions
      const finalTotalCommissions = totalCommissionsFromBreakdown;

      return {
        employeeId: employee.id,
        employeeName: employee.name,
        totalCommissions: finalTotalCommissions,
        thisMonth: currentTotalCommissions,
        appointments: {
          newPatient: currentAppointments.newPatient,
          existingPatient: currentAppointments.existingPatient,
          followUpTask: currentAppointments.followUpTask,
          total: currentAppointments.total
        },
        visits: {
          newPatient: currentVisits.newPatient,
          existingPatient: currentVisits.existingPatient,
          followUpTask: currentVisits.followUpTask,
          nominationsVisits: currentVisits.nominationsVisits || { total: 0, adult: 0, child: 0 },
          notBookedVisits: currentVisits.notBookedVisits || 0,
          totalCoordinatorVisits: currentVisits.totalCoordinatorVisits
        },
        totalSpecialties: totalSpecialties,
        revenue: currentRevenue,
        breakdown,
        previousMonth: {
          newPatients: previousMonthBreakdown.newPatients,
          addedSpecialties: previousMonthBreakdown.addedSpecialties,
          nominations: previousMonthBreakdown.nominations,
          followUps: previousMonthBreakdown.followUps,
          manualAdjustments: previousMonthBreakdown.manualAdjustments,
          totalCommissions: previousTotalCommissions,
          revenue: previousRevenue,
          appointments: {
            newPatient: previousAppointments.newPatient,
            existingPatient: previousAppointments.existingPatient,
            followUpTask: previousAppointments.followUpTask,
            total: previousAppointments.total
          },
          visits: {
            newPatient: previousVisits.newPatient,
            existingPatient: previousVisits.existingPatient,
            followUpTask: previousVisits.followUpTask
          }
        },
        comparison: {
          newPatientsChange: calculateChange(breakdown.newPatients, previousMonthBreakdown.newPatients),
          addedSpecialtiesChange: calculateChange(breakdown.addedSpecialties, previousMonthBreakdown.addedSpecialties),
          nominationsChange: calculateChange(breakdown.nominations, previousMonthBreakdown.nominations),
          followUpsChange: calculateChange(breakdown.followUps, previousMonthBreakdown.followUps),
          manualAdjustmentsChange: calculateChange(breakdown.manualAdjustments, previousMonthBreakdown.manualAdjustments),
          totalCommissionsChange: calculateChange(currentTotalCommissions, previousTotalCommissions),
          revenueChange: calculateChange(currentRevenue, previousRevenue),
          appointmentsChange: {
            newPatient: calculateChange(currentAppointments.newPatient, previousAppointments.newPatient),
            existingPatient: calculateChange(currentAppointments.existingPatient, previousAppointments.existingPatient),
            followUpTask: calculateChange(currentAppointments.followUpTask, previousAppointments.followUpTask),
            total: calculateChange(currentAppointments.total, previousAppointments.total)
          }
        },
        commissionDetails: {
          newPatients: {
            description: "Sales: Commission for creating new patients",
            count: breakdown.newPatients
          },
          addedSpecialties: {
            description: "Coordinator: Commission for adding specialties to appointments",
            count: breakdown.addedSpecialties
          },
          nominations: {
            description: "Coordinator: Commission for converting nominated patients to patients",
            count: breakdown.nominations
          },
          followUps: {
            description: "Coordinator: Commission for follow-up visits from existing patients",
            count: breakdown.followUps
          },
          manualAdjustments: {
            description: "Manual commission adjustments",
            count: breakdown.manualAdjustments
          }
        }
      };
    }));


    // Cache the result for 30 seconds
    cache.set(cacheKey, result, 30000);

    res.status(200).json({
      success: true,
      data: result,
      cached: false
    });
  } catch (error) {
    console.error('Error fetching commission breakdown:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch commission breakdown',
      error: error
    });
  }
};

// Create manual commission adjustment
export const createManualAdjustment = async (req: Request, res: Response) => {
  try {
    const { employeeId, amount, description } = req.body;

    // Validate required fields
    if (!employeeId || !description) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID and description are required'
      });
    }

    // Verify employee exists
    const employee = await withDbRetry(async () => {
      return await prisma.employee.findUnique({
        where: { id: employeeId }
      });
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Create commission record
    const commission = await withDbRetry(async () => {
      return await prisma.commission.create({
        data: {
          employeeId: employeeId,
          amount: amount || 1,
          type: 'MANUAL_ADJUSTMENT',
          description: description,
          period: new Date().toISOString().split('T')[0]
        }
      });
    });

    // Update employee's commission count
    await withDbRetry(async () => {
      return await prisma.employee.update({
        where: { id: employeeId },
        data: {
          commissions: {
            increment: amount || 1
          }
        }
      });
    });

    res.status(201).json({
      success: true,
      data: commission,
      message: 'Manual commission adjustment created successfully'
    });
  } catch (error) {
    console.error('Error creating manual adjustment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create manual adjustment',
      error: error
    });
  }
};

// Delete all commissions (admin only)
export const deleteAllCommissions = async (req: Request, res: Response) => {
  try {
    // Get total count before deletion
    const totalCount = await withDbRetry(async () => {
      return await prisma.commission.count();
    });

    if (totalCount === 0) {
      return res.status(200).json({
        success: true,
        message: 'No commissions to delete',
        deletedCount: 0
      });
    }

    // Delete all commissions
    const deletedCount = await withDbRetry(async () => {
      return await prisma.commission.deleteMany({});
    });

    // Reset all employee commission counts to 0
    await withDbRetry(async () => {
      return await prisma.employee.updateMany({
        data: {
          commissions: 0
        }
      });
    });

    // Clear all commission-related cache entries
    // Clear all cache to ensure commission breakdown is recalculated
    cache.clear();
    
    // Also clear any specific commission cache keys that might exist
    // This ensures the breakdown endpoint will recalculate from the database
    try {
      const cacheInstance = cache as any;
      if (cacheInstance.cache && typeof cacheInstance.cache.clear === 'function') {
        cacheInstance.cache.clear();
      }
    } catch (e) {
      // Cache clearing is best effort
      console.warn('Additional cache clear attempt failed:', e);
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'Delete All',
      entity_type: 'Commission',
      entity_id: 'all',
      status: 'Successful',
      description: `All ${deletedCount.count} commissions deleted successfully`,
    });

    res.status(200).json({
      success: true,
      message: `All ${deletedCount.count} commissions deleted successfully`,
      deletedCount: deletedCount.count
    });
  } catch (error) {
    console.error('Error deleting all commissions:', error);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'Delete All',
      entity_type: 'Commission',
      entity_id: 'all',
      status: 'Failed',
      description: `Failed to delete all commissions: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to delete all commissions',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};