import { prisma, withDbRetry } from './database.utils';
import { calculatePatientAge, getAgeCategory } from './appointment.utils';

interface VisitWithAge {
  id: string;
  patientId: string;
  ageCategory: 'adult' | 'child' | null;
}

// Helper function to get actual new patient visits for a sales employee
// This returns visit IDs for first visits (first ever or first to a new hospital) with specialties
export async function getActualNewPatientVisits(
  employeeId: string,
  startDate?: Date,
  endDate?: Date
): Promise<string[]> {
  try {
    // Get all patients assigned to this sales person
    const assignedPatients = await withDbRetry(async () => {
      return await prisma.patient.findMany({
        where: {
          salesPersonId: employeeId
        },
        select: {
          id: true
        }
      });
    });

    if (assignedPatients.length === 0) {
      return [];
    }

    const patientIds = assignedPatients.map(p => p.id);
    
    // OPTIMIZATION: Get all visits for all patients in a single query instead of per-patient queries
    // This dramatically reduces the number of database connections needed
    // We need ALL visits (including legacy without specialties) to determine first visits correctly
    const whereClause: any = {
      patientId: { in: patientIds }
    };
    
    // Get ALL visits for all patients (including legacy without specialties) to check first visit status
    // This is needed because legacy visits count when determining "new" status
    // IMPORTANT: Don't apply date filter here - we need ALL visits to correctly determine first visits
    const allVisitsForComparison = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: whereClause,
        select: {
          id: true,
          patientId: true,
          hospitalId: true,
          createdAt: true,
          visitDate: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });
    });

    // Get ALL visits with specialties (no date filter yet) - we'll filter by date after determining first visits
    // This matches the performance page logic which finds all first visits first, then filters by date
    const visitsWithSpecialties = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: {
          ...whereClause,
          visitSpecialities: {
            some: {}
          }
        },
        include: {
          visitSpecialities: {
            select: {
              id: true
            },
            take: 1
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      });
    });

    if (visitsWithSpecialties.length === 0) {
      return [];
    }

    // Group all visits by patient for efficient processing
    const allVisitsByPatient = new Map<string, typeof allVisitsForComparison>();
    for (const visit of allVisitsForComparison) {
      if (!allVisitsByPatient.has(visit.patientId)) {
        allVisitsByPatient.set(visit.patientId, []);
      }
      allVisitsByPatient.get(visit.patientId)!.push(visit);
    }

    // Group visits with specialties by patient
    const visitsWithSpecialtiesByPatient = new Map<string, typeof visitsWithSpecialties>();
    for (const visit of visitsWithSpecialties) {
      if (!visitsWithSpecialtiesByPatient.has(visit.patientId)) {
        visitsWithSpecialtiesByPatient.set(visit.patientId, []);
      }
      visitsWithSpecialtiesByPatient.get(visit.patientId)!.push(visit);
    }

    const visitIds: string[] = [];

    // Process each patient's visits with specialties
    for (const [patientId, patientVisitsWithSpecialties] of visitsWithSpecialtiesByPatient.entries()) {
      try {
        // Get all visits for this patient (including legacy) for comparison
        const allPatientVisits = allVisitsByPatient.get(patientId) || [];
        
        // Track which hospitals we've seen first visits for
        const visitedHospitals = new Set<string>();

        for (const visit of patientVisitsWithSpecialties) {
          // Check if this is the patient's first visit ever (including legacy visits)
          // Legacy visits count when determining "new" status, but don't create commissions
          // Check against ALL previous visits (including legacy)
          const previousVisits = allPatientVisits.filter(v => 
            v.id !== visit.id && v.createdAt < visit.createdAt
          );
          const isFirstVisitEver = previousVisits.length === 0;

          // Check if this is the first visit to this hospital (including legacy visits)
          let isFirstVisitToHospital = false;
          if (!visitedHospitals.has(visit.hospitalId)) {
            const previousVisitsToHospital = allPatientVisits.filter(v => 
              v.id !== visit.id && 
              v.hospitalId === visit.hospitalId && 
              v.createdAt < visit.createdAt
            );
            isFirstVisitToHospital = previousVisitsToHospital.length === 0;
          }

          // Include visit if it's first visit ever OR first visit to a new hospital
          if (isFirstVisitEver || isFirstVisitToHospital) {
            visitIds.push(visit.id);
            visitedHospitals.add(visit.hospitalId);
          }
        }
      } catch (patientError) {
        console.error(`[getActualNewPatientVisits] Error processing patient ${patientId}:`, patientError);
        // Continue with next patient
      }
    }

    // Remove duplicates
    const uniqueVisitIds = [...new Set(visitIds)];
    
    if (process.env.DEBUG_LOGS === 'true') {
      console.log(`[getActualNewPatientVisits] Employee ${employeeId}: Found ${uniqueVisitIds.length} unique first visits (before date filter)`);
    }
    
    // Apply date filter AFTER determining first visits (matches performance page logic)
    // Use Prisma query with gte/lte to match exactly how performance page filters
    // This ensures we count first visits correctly, then filter by the requested date range
    if (startDate || endDate) {
      // Build where clause matching performance page logic exactly
      const dateFilterWhere: any = {
        id: { in: uniqueVisitIds }
      };
      
      if (startDate || endDate) {
        dateFilterWhere.visitDate = {};
        if (startDate) {
          dateFilterWhere.visitDate.gte = startDate;
        }
        if (endDate) {
          dateFilterWhere.visitDate.lte = endDate;
        }
      }
      
      // Use Prisma count query to get filtered visit IDs (matches performance page approach)
      const filteredVisits = await withDbRetry(async () => {
        return await prisma.visit.findMany({
          where: dateFilterWhere,
          select: {
            id: true
          }
        });
      });
      
      const filteredVisitIds = filteredVisits.map(v => v.id);
      
      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`[getActualNewPatientVisits] Employee ${employeeId}: Found ${uniqueVisitIds.length} first visits total, after date filter (${startDate?.toISOString() || 'none'} to ${endDate?.toISOString() || 'none'}): ${filteredVisitIds.length} visits`);
      }
      
      // Additional debug: log a few sample visit IDs to help troubleshoot
      if (process.env.DEBUG_LOGS === 'true') {
        if (filteredVisitIds.length !== uniqueVisitIds.length && filteredVisitIds.length > 0) {
          console.log(`[getActualNewPatientVisits] Employee ${employeeId}: Sample filtered visit IDs (first 5):`, filteredVisitIds.slice(0, 5));
        }
      }
      
      return filteredVisitIds;
    }
    
    return uniqueVisitIds;
  } catch (error) {
    console.error(`[getActualNewPatientVisits] Error for employee ${employeeId}:`, error);
    return [];
  }
}

// Helper function to get actual new patient visits with age information for a sales employee
// This returns visits with age category for calculating adults/children breakdown
export async function getActualNewPatientVisitsWithAge(
  employeeId: string,
  startDate?: Date,
  endDate?: Date
): Promise<VisitWithAge[]> {
  const visitIds = await getActualNewPatientVisits(employeeId, startDate, endDate);
  
  if (visitIds.length === 0) {
    return [];
  }
  
  // Get visits with patient information
  const visits = await withDbRetry(async () => {
    return await prisma.visit.findMany({
      where: {
        id: { in: visitIds }
      },
      include: {
        patient: {
          select: {
            id: true,
            dob: true,
            nationalId: true
          }
        }
      }
    });
  });
  
  // Calculate age for each visit
  return visits.map(visit => {
    const age = calculatePatientAge(visit.patient.dob, visit.patient.nationalId);
    const ageCategory = getAgeCategory(age);
    
    return {
      id: visit.id,
      patientId: visit.patientId,
      ageCategory: ageCategory
    };
  });
}

// Helper function to calculate actual new patient visits count for a sales employee
// This counts only first visits (first ever or first to a new hospital) with specialties
export async function getActualNewPatientVisitsCount(
  employeeId: string,
  startDate?: Date,
  endDate?: Date
): Promise<number> {
  const visitIds = await getActualNewPatientVisits(employeeId, startDate, endDate);
  return visitIds.length;
}

