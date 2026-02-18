import { prisma } from "../utils/database.utils";

export interface DeduplicationResult {
  totalVisitsProcessed: number;
  totalDuplicatesFound: number;
  visitsKept: number;
  visitsDeleted: number;
  specialtiesMerged: number;
  duplicateGroupsCount: number;
  duplicateGroups: Array<{
    patientId: string;
    hospitalId: string;
    visitDate: string;
    count: number;
    kept: string;
    deleted: string[];
    specialtiesMerged: number;
  }>;
}

/**
 * Deduplicates visits by merging duplicates into the oldest visit for each (patient, hospital, date) group.
 * This function can be called programmatically without requiring HTTP request context.
 * 
 * @param options Optional configuration
 * @param options.userId Optional user ID for logging purposes
 * @param options.userName Optional user name for logging purposes
 * @returns Promise with deduplication results
 */
export async function deduplicateVisitsProgrammatically(options?: {
  userId?: string;
  userName?: string;
}): Promise<DeduplicationResult> {
  // Statistics
  let totalDuplicatesFound = 0;
  let visitsKept = 0;
  let visitsDeleted = 0;
  let specialtiesMerged = 0;
  const duplicateGroups: Array<{
    patientId: string;
    hospitalId: string;
    visitDate: string;
    count: number;
    kept: string;
    deleted: string[];
    specialtiesMerged: number;
  }> = [];

  // Use transaction for atomicity with increased timeout (5 minutes for large datasets)
  const result = await prisma.$transaction(async (tx) => {
    // Fetch all visits with their basic info
    const allVisits = await tx.visit.findMany({
      select: {
        id: true,
        patientId: true,
        hospitalId: true,
        visitDate: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc' // Oldest first - we'll keep the oldest as primary
      }
    });

    // Group visits by (patientId, hospitalId, normalized visitDate)
    const visitGroups = new Map<string, typeof allVisits>();

    for (const visit of allVisits) {
      // Normalize visitDate to start of day for comparison
      const normalizedDate = new Date(visit.visitDate);
      normalizedDate.setHours(0, 0, 0, 0);
      const dateKey = normalizedDate.toISOString().split('T')[0]; // YYYY-MM-DD

      // Create unique key: patientId_hospitalId_dateKey
      const groupKey = `${visit.patientId}_${visit.hospitalId}_${dateKey}`;

      if (!visitGroups.has(groupKey)) {
        visitGroups.set(groupKey, []);
      }
      visitGroups.get(groupKey)!.push(visit);
    }

    // Collect all visit IDs to delete
    const allVisitIdsToDelete: string[] = [];
    const visitIdsToKeep = new Set<string>();

    // Process each group to merge duplicates
    for (const [groupKey, visits] of visitGroups.entries()) {
      // Only process groups with more than 1 visit (duplicates)
      if (visits.length > 1) {
        // Visits are sorted by createdAt asc (oldest first)
        const primaryVisit = visits[0]; // Keep the oldest as primary
        const duplicateVisits = visits.slice(1); // Merge these into primary

        totalDuplicatesFound += visits.length - 1;
        visitsKept += 1;
        visitsDeleted += duplicateVisits.length;

        visitIdsToKeep.add(primaryVisit.id);
        allVisitIdsToDelete.push(...duplicateVisits.map(v => v.id));

        // Fetch all specialties from primary visit
        const primarySpecialties = await tx.visitSpeciality.findMany({
          where: { visitId: primaryVisit.id }
        });

        // Create a map of existing specialties in primary visit
        // Key format: `${specialityId}-${doctorId}-${scheduledTimeMinutes}`
        const existingSpecialtyKeys = new Map<string, typeof primarySpecialties[0]>();
        primarySpecialties.forEach(spec => {
          const scheduledTime = new Date(spec.scheduledTime);
          const timeMinutes = scheduledTime.getUTCHours() * 60 + scheduledTime.getUTCMinutes();
          const key = `${spec.specialityId}-${spec.doctorId}-${timeMinutes}`;
          existingSpecialtyKeys.set(key, spec);
        });

        // Collect all specialties from duplicate visits that need to be merged
        const specialtiesToMerge: Array<{
          specialty: typeof primarySpecialties[0];
          fromVisitId: string;
          mapToExisting?: string; // If set, map to this existing specialty ID instead of creating new
        }> = [];

        for (const duplicateVisit of duplicateVisits) {
          const duplicateSpecialties = await tx.visitSpeciality.findMany({
            where: { visitId: duplicateVisit.id }
          });

          for (const spec of duplicateSpecialties) {
            const scheduledTime = new Date(spec.scheduledTime);
            const timeMinutes = scheduledTime.getUTCHours() * 60 + scheduledTime.getUTCMinutes();
            const key = `${spec.specialityId}-${spec.doctorId}-${timeMinutes}`;

            // Check if this specialty already exists in primary visit
            if (!existingSpecialtyKeys.has(key)) {
              // This is a new specialty, add it to merge list
              specialtiesToMerge.push({
                specialty: spec,
                fromVisitId: duplicateVisit.id
              });
              existingSpecialtyKeys.set(key, spec); // Mark as added to avoid duplicates
            } else {
              // Exact duplicate exists - map it to the existing one for commission/transaction updates
              const existingSpec = existingSpecialtyKeys.get(key)!;
              const existingHasDetails = !!(existingSpec.details || existingSpec.serviceTime || existingSpec.eventType);
              const newHasDetails = !!(spec.details || spec.serviceTime || spec.eventType);

              // If the duplicate has more complete data, update the existing one
              if (newHasDetails && !existingHasDetails) {
                await tx.visitSpeciality.update({
                  where: { id: existingSpec.id },
                  data: {
                    details: spec.details || existingSpec.details,
                    doctorName: spec.doctorName || existingSpec.doctorName,
                    serviceTime: spec.serviceTime || existingSpec.serviceTime,
                    eventType: spec.eventType || existingSpec.eventType,
                    eventDescription: spec.eventDescription || existingSpec.eventDescription,
                    eventNotes: spec.eventNotes || existingSpec.eventNotes,
                    eventOutcome: spec.eventOutcome || existingSpec.eventOutcome,
                    status: spec.status || existingSpec.status,
                  }
                });
              }
              
              // Map this duplicate specialty to the existing one in primary visit
              // This ensures commissions/transactions are updated correctly
              specialtiesToMerge.push({
                specialty: spec,
                fromVisitId: duplicateVisit.id,
                mapToExisting: existingSpec.id // Flag to indicate this should map to existing
              });
            }
          }
        }

        // Merge specialties into primary visit
        let mergedCount = 0;
        const specialtyMapping = new Map<string, string>(); // Map old specialty ID to new specialty ID

        for (const { specialty, fromVisitId, mapToExisting } of specialtiesToMerge) {
          if (mapToExisting) {
            // This specialty should map to an existing one in primary visit
            specialtyMapping.set(specialty.id, mapToExisting);
          } else {
            // This is a new specialty, check if it already exists before creating
            // Note: Unique constraint is on (visitId, specialityId, doctorId) - not including scheduledTime
            const scheduledTime = new Date(specialty.scheduledTime);
            const existingSpec = await tx.visitSpeciality.findFirst({
              where: {
                visitId: primaryVisit.id,
                specialityId: specialty.specialityId,
                doctorId: specialty.doctorId,
                // Don't include scheduledTime in the check since it's not part of the unique constraint
              }
            });

            if (existingSpec) {
              // Specialty already exists (same visitId, specialityId, doctorId), map to it
              // Update it if the new one has more complete data
              const existingHasDetails = !!(existingSpec.details || existingSpec.serviceTime || existingSpec.eventType);
              const newHasDetails = !!(specialty.details || specialty.serviceTime || specialty.eventType);

              if (newHasDetails && !existingHasDetails) {
                // Update existing with more complete data
                await tx.visitSpeciality.update({
                  where: { id: existingSpec.id },
                  data: {
                    scheduledTime: scheduledTime, // Update scheduled time to the new one
                    details: specialty.details || existingSpec.details,
                    doctorName: specialty.doctorName || existingSpec.doctorName,
                    serviceTime: specialty.serviceTime || existingSpec.serviceTime,
                    eventType: specialty.eventType || existingSpec.eventType,
                    eventDescription: specialty.eventDescription || existingSpec.eventDescription,
                    eventNotes: specialty.eventNotes || existingSpec.eventNotes,
                    eventOutcome: specialty.eventOutcome || existingSpec.eventOutcome,
                    status: specialty.status || existingSpec.status,
                  }
                });
              }
              
              console.log(`Specialty ${specialty.specialityId}-${specialty.doctorId} already exists in primary visit, using existing`);
              specialtyMapping.set(specialty.id, existingSpec.id);
            } else {
              // Create new specialty in primary visit
              const newSpecialty = await tx.visitSpeciality.create({
                data: {
                  visitId: primaryVisit.id,
                  specialityId: specialty.specialityId,
                  doctorId: specialty.doctorId,
                  scheduledTime: scheduledTime,
                  status: specialty.status,
                  details: specialty.details,
                  doctorName: specialty.doctorName,
                  serviceTime: specialty.serviceTime,
                  eventType: specialty.eventType,
                  eventDescription: specialty.eventDescription,
                  eventNotes: specialty.eventNotes,
                  eventOutcome: specialty.eventOutcome,
                }
              });
              mergedCount++;

              // Map old specialty ID to new specialty ID for updating related records
              specialtyMapping.set(specialty.id, newSpecialty.id);
            }
          }
        }

        // Update all commissions and transactions in batch
        for (const [oldSpecialtyId, newSpecialtyId] of specialtyMapping.entries()) {
          // Update commissions
          await tx.commission.updateMany({
            where: { visitSpecialityId: oldSpecialtyId },
            data: { visitSpecialityId: newSpecialtyId }
          });

          // Update transactions
          await tx.transactionVisitSpeciality.updateMany({
            where: { visitSpecialityId: oldSpecialtyId },
            data: { visitSpecialityId: newSpecialtyId }
          });
        }

        specialtiesMerged += mergedCount;

        // Track this group
        const [patientId, hospitalId, dateKey] = groupKey.split('_');
        duplicateGroups.push({
          patientId,
          hospitalId,
          visitDate: dateKey,
          count: visits.length,
          kept: primaryVisit.id,
          deleted: duplicateVisits.map(v => v.id),
          specialtiesMerged: mergedCount
        });
      } else {
        // Single visit, no duplicates - count as kept
        visitsKept += 1;
        visitIdsToKeep.add(visits[0].id);
      }
    }

    // After merging all specialties, delete duplicate visits
    // VisitSpecialities will be handled by cascade or already moved
    if (allVisitIdsToDelete.length > 0) {
      // First, delete any remaining visitSpecialities from duplicate visits
      // (those that weren't merged - exact duplicates)
      const batchSize = 1000;
      for (let i = 0; i < allVisitIdsToDelete.length; i += batchSize) {
        const batch = allVisitIdsToDelete.slice(i, i + batchSize);
        await tx.visitSpeciality.deleteMany({
          where: {
            visitId: { in: batch }
          }
        });
      }

      // Then delete duplicate visits
      for (let i = 0; i < allVisitIdsToDelete.length; i += batchSize) {
        const batch = allVisitIdsToDelete.slice(i, i + batchSize);
        await tx.visit.deleteMany({
          where: {
            id: { in: batch }
          }
        });
      }
    }

    return {
      totalVisitsProcessed: allVisits.length,
      totalDuplicatesFound,
      visitsKept,
      visitsDeleted,
      specialtiesMerged,
      duplicateGroups
    };
  }, {
    timeout: 300000, // 5 minutes timeout for large datasets
    maxWait: 60000, // Wait up to 1 minute for transaction to start
  });

  return {
    totalVisitsProcessed: result.totalVisitsProcessed,
    totalDuplicatesFound: result.totalDuplicatesFound,
    visitsKept: result.visitsKept,
    visitsDeleted: result.visitsDeleted,
    specialtiesMerged: result.specialtiesMerged,
    duplicateGroupsCount: duplicateGroups.length,
    duplicateGroups: duplicateGroups.slice(0, 100) // Limit to first 100 groups for response size
  };
}

