import { withDbRetry, prisma } from "../utils/database.utils";

export interface AppointmentSpecialityInput {
  specialityId: string;
  doctorId: string;
  scheduledTime: Date | string; // ISO string or Date object
}

export interface CreateAppointmentWithSpecialtiesInput {
  /**
   * Optional appointment ID.
   * When provided, the service will update/merge into this existing appointment
   * instead of searching by patient/date or creating a new one.
   */
  appointmentId?: string;
  patientId: string;
  hospitalId: string;
  salesPersonId: string;
  scheduledDate: Date | string; // Date only (will use first specialty's date if not provided)
  appointmentSpecialities: AppointmentSpecialityInput[];
  createdById: string;
  driverNeeded?: boolean;
  driverId?: string | null;
  notes?: string | null;
  isNewPatientAtCreation?: boolean;
  isNotBooked?: boolean;
  createdFromFollowUpTaskId?: string | null;
  /**
   * When true and appointmentId is provided, replaces all existing specialties
   * with the new ones instead of merging. When false or undefined, merges (adds only).
   */
  replaceSpecialities?: boolean;
}

/**
 * Creates an appointment with AppointmentSpeciality records
 * This is the centralized service for all appointment creation in the system
 */
export const createAppointmentWithSpecialties = async (
  input: CreateAppointmentWithSpecialtiesInput
) => {
  // Validate required fields
  if (!input.patientId || !input.hospitalId || !input.salesPersonId || !input.createdById) {
    throw new Error("Missing required fields: patientId, hospitalId, salesPersonId, createdById");
  }

  if (!input.appointmentSpecialities || input.appointmentSpecialities.length === 0) {
    throw new Error("At least one appointment specialty is required");
  }

  // Validate each specialty has required fields
  for (const spec of input.appointmentSpecialities) {
    if (!spec.specialityId || !spec.doctorId || !spec.scheduledTime) {
      throw new Error("Each specialty must have specialityId, doctorId, and scheduledTime");
    }
  }

  // Validate hospital exists
  const hospital = await withDbRetry(async () => {
    return await prisma.hospital.findUnique({
      where: { id: input.hospitalId }
    });
  });

  if (!hospital) {
    throw new Error(`Hospital with id ${input.hospitalId} not found`);
  }

  // Get first specialty's scheduled time to determine appointment date
  const firstSpecialtyTime = typeof input.appointmentSpecialities[0].scheduledTime === 'string'
    ? new Date(input.appointmentSpecialities[0].scheduledTime)
    : input.appointmentSpecialities[0].scheduledTime;

  // Use provided scheduledDate or derive from first specialty
  const appointmentDate = input.scheduledDate
    ? (typeof input.scheduledDate === 'string' ? new Date(input.scheduledDate) : input.scheduledDate)
    : firstSpecialtyTime;

  // Calculate day start and end in UTC (accounting for UAE timezone offset)
  const dayStart = new Date(appointmentDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(appointmentDate);
  dayEnd.setUTCHours(23, 59, 59, 999);

  // When appointmentId is provided, we are explicitly updating an existing appointment.
  // In that case, fetch by ID instead of searching by patient/date.
  const existingAppointment = input.appointmentId
    ? await withDbRetry(async () => {
        return await prisma.appointment.findUnique({
          where: { id: input.appointmentId },
          include: {
            appointmentSpecialities: {
              include: {
                speciality: {
                  select: {
                    id: true,
                    name: true,
                    nameArabic: true,
                  },
                },
                doctor: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nationalId: true,
                phoneNumber: true,
              },
            },
            hospital: {
              select: {
                id: true,
                name: true,
              },
            },
            salesPerson: {
              select: {
                id: true,
                name: true,
                employeeId: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                name: true,
                employeeId: true,
              },
            },
            driver: {
              select: {
                id: true,
                name: true,
                employeeId: true,
              },
            },
          },
        });
      })
    : await withDbRetry(async () => {
        return await prisma.appointment.findFirst({
          where: {
            patientId: input.patientId,
            hospitalId: input.hospitalId,
            scheduledDate: {
              gte: dayStart,
              lte: dayEnd,
            },
            status: {
              in: ['scheduled', 'assigned'],
            },
          },
          include: {
            appointmentSpecialities: {
              include: {
                speciality: {
                  select: {
                    id: true,
                    name: true,
                    nameArabic: true,
                  },
                },
                doctor: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nationalId: true,
                phoneNumber: true,
              },
            },
            hospital: {
              select: {
                id: true,
                name: true,
              },
            },
            salesPerson: {
              select: {
                id: true,
                name: true,
                employeeId: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                name: true,
                employeeId: true,
              },
            },
            driver: {
              select: {
                id: true,
                name: true,
                employeeId: true,
              },
            },
          },
        });
      });

  // If existing appointment found, merge or replace specialties
  if (existingAppointment) {
    const result = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        let finalSpecialties: any[] = [];
        let allSpecialtyNames: string[] = [];

        if (input.replaceSpecialities) {
          // Replace mode: Delete all existing specialties and create new ones
          await tx.appointmentSpeciality.deleteMany({
            where: { appointmentId: existingAppointment.id }
          });

          // Get specialty names for the new specialties
          const specialtyIds = input.appointmentSpecialities.map(spec => spec.specialityId);
          const specialties = await Promise.all(
            specialtyIds.map(id => tx.speciality.findUnique({ where: { id } }))
          );
          allSpecialtyNames = specialties
            .filter(s => s !== null)
            .map(s => s!.name);

          // Deduplicate appointment specialties before creating
          // Keep the last occurrence of each specialty-doctor combination (most recent time)
          const specialtyMap = new Map<string, typeof input.appointmentSpecialities[0]>();
          input.appointmentSpecialities.forEach(spec => {
            const key = `${spec.specialityId}-${spec.doctorId}`;
            specialtyMap.set(key, spec); // Last occurrence overwrites previous ones
          });
          const uniqueSpecialties = Array.from(specialtyMap.values());

          // Create new AppointmentSpeciality records
          finalSpecialties = await Promise.all(
            uniqueSpecialties.map(spec => {
              const scheduledTime = typeof spec.scheduledTime === 'string'
                ? new Date(spec.scheduledTime)
                : spec.scheduledTime;

              return tx.appointmentSpeciality.create({
                data: {
                  appointmentId: existingAppointment.id,
                  specialityId: spec.specialityId,
                  doctorId: spec.doctorId,
                  scheduledTime: scheduledTime,
                  status: 'scheduled'
                },
                include: {
                  speciality: {
                    select: {
                      id: true,
                      name: true,
                      nameArabic: true
                    }
                  },
                  doctor: {
                    select: {
                      id: true,
                      name: true
                    }
                  }
                }
              });
            })
          );
        } else {
          // Merge mode: Add only new specialties (skip duplicates)
          const existingSpecialtyNames = existingAppointment.appointmentSpecialities
            .map(aptSpec => aptSpec.speciality.name);
          
          // First, deduplicate within the input array itself - keep last occurrence
          const inputSpecialtyMap = new Map<string, typeof input.appointmentSpecialities[0]>();
          input.appointmentSpecialities.forEach(spec => {
            const key = `${spec.specialityId}-${spec.doctorId}`;
            inputSpecialtyMap.set(key, spec); // Last occurrence overwrites previous ones
          });
          const deduplicatedInput = Array.from(inputSpecialtyMap.values());
          
          // Track which specialties to add or update
          const specialtiesToAdd: AppointmentSpecialityInput[] = [];
          const specialtiesToUpdate: Array<{ existingId: string; newSpec: typeof input.appointmentSpecialities[0] }> = [];
          const newSpecialtyNames: string[] = [];

          for (const newSpec of deduplicatedInput) {
            // Check if this specialty-doctor combination already exists
            const existingSpec = existingAppointment.appointmentSpecialities.find(existingSpec => {
              return existingSpec.specialityId === newSpec.specialityId &&
                     existingSpec.doctorId === newSpec.doctorId;
            });

            if (existingSpec) {
              // Update existing specialty with new time
              specialtiesToUpdate.push({
                existingId: existingSpec.id,
                newSpec: newSpec
              });
            } else {
              // Add new specialty
              specialtiesToAdd.push(newSpec);
              const specialty = await tx.speciality.findUnique({
                where: { id: newSpec.specialityId }
              });
              if (specialty) {
                newSpecialtyNames.push(specialty.name);
              }
            }
          }

          // Create new AppointmentSpeciality records for non-duplicate specialties
          const newAppointmentSpecialities = await Promise.all(
            specialtiesToAdd.map(spec => {
              const scheduledTime = typeof spec.scheduledTime === 'string'
                ? new Date(spec.scheduledTime)
                : spec.scheduledTime;

              return tx.appointmentSpeciality.create({
                data: {
                  appointmentId: existingAppointment.id,
                  specialityId: spec.specialityId,
                  doctorId: spec.doctorId,
                  scheduledTime: scheduledTime,
                  status: 'scheduled'
                },
                include: {
                  speciality: {
                    select: {
                      id: true,
                      name: true,
                      nameArabic: true
                    }
                  },
                  doctor: {
                    select: {
                      id: true,
                      name: true
                    }
                  }
                }
              });
            })
          );

          // Get updated specialties with new times
          const updatedSpecialties = await Promise.all(
            specialtiesToUpdate.map(async ({ existingId, newSpec }) => {
              const scheduledTime = typeof newSpec.scheduledTime === 'string'
                ? new Date(newSpec.scheduledTime)
                : newSpec.scheduledTime;
              
              const updated = await tx.appointmentSpeciality.update({
                where: { id: existingId },
                data: {
                  scheduledTime: scheduledTime
                },
                include: {
                  speciality: {
                    select: {
                      id: true,
                      name: true,
                      nameArabic: true
                    }
                  },
                  doctor: {
                    select: {
                      id: true,
                      name: true
                    }
                  }
                }
              });
              return updated;
            })
          );

          // Combine: existing (not updated) + updated + new
          const existingNotUpdated = existingAppointment.appointmentSpecialities.filter(existing => 
            !specialtiesToUpdate.some(update => update.existingId === existing.id)
          );
          finalSpecialties = [...existingNotUpdated, ...updatedSpecialties, ...newAppointmentSpecialities];
          allSpecialtyNames = [...new Set([...existingSpecialtyNames, ...newSpecialtyNames])];
        }

        // Build update payload for the appointment
        const appointmentUpdateData: any = {
          speciality: allSpecialtyNames.join(', '),
        };

        // Allow updating core appointment fields when provided
        // For implicit merges (no appointmentId), hospitalId must already match (enforced by query),
        // so we skip updating it to prevent any potential issues. For explicit updates (with appointmentId),
        // allow hospitalId to be changed.
        if (input.hospitalId && input.appointmentId) {
          appointmentUpdateData.hospitalId = input.hospitalId;
        }
        if (input.salesPersonId) {
          appointmentUpdateData.salesPersonId = input.salesPersonId;
        }
        if (input.driverNeeded !== undefined) {
          appointmentUpdateData.driverNeeded = input.driverNeeded;
        }
        if (input.driverId !== undefined) {
          // Validate and resolve driverId
          let resolvedDriverId: string | null = null;
          if (input.driverId && input.driverId.trim() !== '') {
            const driver = await tx.employee.findUnique({
              where: { id: input.driverId }
            });
            if (driver) {
              resolvedDriverId = input.driverId;
            }
            // If driver doesn't exist, resolvedDriverId remains null
          }
          appointmentUpdateData.driverId = resolvedDriverId;
        }
        if (input.notes !== undefined) {
          appointmentUpdateData.notes = input.notes ?? null;
        }
        // Always align scheduledDate with the computed appointmentDate
        appointmentUpdateData.scheduledDate = appointmentDate;
        if (input.isNewPatientAtCreation !== undefined) {
          appointmentUpdateData.isNewPatientAtCreation = input.isNewPatientAtCreation;
        }
        if (input.isNotBooked !== undefined) {
          appointmentUpdateData.isNotBooked = input.isNotBooked;
        }
        if (input.createdFromFollowUpTaskId !== undefined) {
          appointmentUpdateData.createdFromFollowUpTaskId = input.createdFromFollowUpTaskId ?? null;
        }

        await tx.appointment.update({
          where: { id: existingAppointment.id },
          data: appointmentUpdateData,
        });

        // Fetch updated appointment with all specialties
        const updatedAppointment = await tx.appointment.findUnique({
          where: { id: existingAppointment.id },
          include: {
            appointmentSpecialities: {
              include: {
                speciality: {
                  select: {
                    id: true,
                    name: true,
                    nameArabic: true
                  }
                },
                doctor: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              },
              orderBy: {
                scheduledTime: 'asc'
              }
            },
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nationalId: true,
                phoneNumber: true
              }
            },
            hospital: {
              select: {
                id: true,
                name: true
              }
            },
            salesPerson: {
              select: {
                id: true,
                name: true,
                employeeId: true
              }
            },
            createdBy: {
              select: {
                id: true,
                name: true,
                employeeId: true
              }
            },
            driver: {
              select: {
                id: true,
                name: true,
                employeeId: true
              }
            }
          }
        });

        const existingCount = existingAppointment.appointmentSpecialities.length;
        const finalCount = finalSpecialties.length;
        const addedCount = input.replaceSpecialities 
          ? input.appointmentSpecialities.length 
          : (finalCount - existingCount);

        return {
          appointment: updatedAppointment!,
          appointmentSpecialities: finalSpecialties,
          isMerged: !input.replaceSpecialities,
          mergedCount: addedCount,
          skippedCount: input.replaceSpecialities ? 0 : (input.appointmentSpecialities.length - addedCount)
        };
      });
    });

    return result;
  }

  // No existing appointment found, create new one
  const result = await withDbRetry(async () => {
    return await prisma.$transaction(async (tx) => {
      // Get specialty names for the speciality field
      const specialtyIds = input.appointmentSpecialities.map(spec => spec.specialityId);
      const specialties = await Promise.all(
        specialtyIds.map(id => tx.speciality.findUnique({ where: { id } }))
      );
      const specialtyNames = specialties
        .filter(s => s !== null)
        .map(s => s!.name);

      // Validate and resolve driverId
      let resolvedDriverId: string | null = null;
      if (input.driverId && input.driverId.trim() !== '') {
        const driver = await tx.employee.findUnique({
          where: { id: input.driverId }
        });
        if (driver) {
          resolvedDriverId = input.driverId;
        }
        // If driver doesn't exist, resolvedDriverId remains null
      }

      // Create the appointment
      const appointment = await tx.appointment.create({
        data: {
          patientId: input.patientId,
          hospitalId: input.hospitalId,
          salesPersonId: input.salesPersonId,
          scheduledDate: appointmentDate,
          status: 'scheduled',
          createdById: input.createdById,
          driverNeeded: input.driverNeeded || false,
          driverId: resolvedDriverId,
          notes: input.notes || null,
          isNewPatientAtCreation: input.isNewPatientAtCreation || false,
          isNotBooked: input.isNotBooked || false,
          createdFromFollowUpTaskId: input.createdFromFollowUpTaskId || null,
          speciality: specialtyNames.join(', ')
        },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nationalId: true,
              phoneNumber: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          },
          salesPerson: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          driver: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          }
        }
      });

      // Deduplicate appointment specialties before creating
      // Keep the last occurrence of each specialty-doctor combination (most recent time)
      const specialtyMap = new Map<string, typeof input.appointmentSpecialities[0]>();
      input.appointmentSpecialities.forEach(spec => {
        const key = `${spec.specialityId}-${spec.doctorId}`;
        specialtyMap.set(key, spec); // Last occurrence overwrites previous ones
      });
      const uniqueSpecialties = Array.from(specialtyMap.values());

      // Create AppointmentSpeciality records
      const appointmentSpecialities = await Promise.all(
        uniqueSpecialties.map(spec => {
          const scheduledTime = typeof spec.scheduledTime === 'string'
            ? new Date(spec.scheduledTime)
            : spec.scheduledTime;

          return tx.appointmentSpeciality.create({
            data: {
              appointmentId: appointment.id,
              specialityId: spec.specialityId,
              doctorId: spec.doctorId,
              scheduledTime: scheduledTime,
              status: 'scheduled'
            },
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true
                }
              },
              doctor: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          });
        })
      );

      return {
        appointment,
        appointmentSpecialities,
        isMerged: false,
        mergedCount: 0,
        skippedCount: 0
      };
    });
  });

  return result;
};

/**
 * Merges duplicate appointments for the same patient, same day, same hospital, and same coordinator
 * Returns merge result if duplicates were found and merged, null otherwise
 * Now handles both 'scheduled' and 'assigned' statuses
 */
export const mergeDuplicateAppointmentsForPatient = async (
  patientId: string,
  scheduledDate: Date | string,
  hospitalId: string,
  coordinatorId: string | null // null for scheduled appointments without coordinator
): Promise<{
  isMerged: boolean;
  primaryAppointmentId: string;
  mergedCount: number;
  deletedAppointmentIds: string[];
  mergedSpecialtyCount: number;
} | null> => {
  try {
    // Convert scheduledDate to Date if string
    const appointmentDate = typeof scheduledDate === 'string' ? new Date(scheduledDate) : scheduledDate;
    
    // Calculate day start and end in UTC
    const dayStart = new Date(appointmentDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(appointmentDate);
    dayEnd.setUTCHours(23, 59, 59, 999);

    // Find all appointments for this patient on this day at this hospital with status 'scheduled' or 'assigned'
    const appointments = await withDbRetry(async () => {
      return await prisma.appointment.findMany({
        where: {
          patientId: patientId,
          hospitalId: hospitalId,
          scheduledDate: {
            gte: dayStart,
            lte: dayEnd
          },
          status: {
            in: ['scheduled', 'assigned']
          }
        },
        select: {
          id: true,
          patientId: true,
          scheduledDate: true,
          status: true,
          speciality: true, // Include the speciality string field
          appointmentSpecialities: {
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true
                }
              },
              doctor: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'asc' // Oldest first
        }
      });
    });

    // Find tasks for each appointment to check coordinator
    const appointmentsWithTasks = await Promise.all(
      appointments.map(async (appointment) => {
        const task = await prisma.task.findFirst({
          where: {
            relatedEntityId: appointment.id,
            relatedEntityType: 'appointment'
          },
          select: {
            id: true,
            assignedToId: true
          }
        });
        return {
          appointment,
          task,
          coordinatorId: task?.assignedToId || null
        };
      })
    );

    // Filter to only appointments with the specified coordinator (or null for scheduled appointments)
    // Handle both null coordinatorId cases (scheduled appointments)
    const appointmentsWithSameCoordinator = appointmentsWithTasks.filter(apt => {
      // Both null or both same string value
      if (coordinatorId === null) {
        return apt.coordinatorId === null;
      }
      return apt.coordinatorId === coordinatorId;
    });

    console.log(`  - Found ${appointments.length} total appointments for patient ${patientId} on ${appointmentDate.toISOString()}`);
    console.log(`  - Filtered to ${appointmentsWithSameCoordinator.length} appointments with coordinator ${coordinatorId || 'null (scheduled)'}`);

    // If less than 2 appointments, no merge needed
    if (appointmentsWithSameCoordinator.length < 2) {
      console.log(`  - Less than 2 appointments with same coordinator, no merge needed`);
      return null;
    }

    // Select primary appointment (oldest)
    const primaryAppointmentData = appointmentsWithSameCoordinator[0];
    const primaryAppointment = primaryAppointmentData.appointment;
    const duplicateAppointments = appointmentsWithSameCoordinator.slice(1);

    // Get existing primary appointment specialty keys (these will be preserved)
    const existingPrimarySpecialtyKeys = new Set(
      primaryAppointment.appointmentSpecialities.map(spec => {
        const scheduledTime = new Date(spec.scheduledTime);
        const timeMinutes = scheduledTime.getUTCHours() * 60 + scheduledTime.getUTCMinutes();
        return `${spec.specialityId}-${spec.doctorId}-${timeMinutes}`;
      })
    );

    // CRITICAL FIX: Collect ALL specialties from ALL appointments (primary + duplicates)
    // This ensures we don't lose any specialties during merge
    const allSpecialtiesToPreserve: Array<{
      specialityId: string;
      doctorId: string;
      scheduledTime: Date;
      appointmentId: string;
      source: 'primary' | 'duplicate';
    }> = [];

    // First, add specialties from primary appointment's AppointmentSpeciality records
    primaryAppointment.appointmentSpecialities.forEach(spec => {
      allSpecialtiesToPreserve.push({
        specialityId: spec.specialityId,
        doctorId: spec.doctorId,
        scheduledTime: spec.scheduledTime,
        appointmentId: primaryAppointment.id,
        source: 'primary'
      });
    });

    // Then, add specialties from duplicate appointments
    duplicateAppointments.forEach(aptData => {
      aptData.appointment.appointmentSpecialities.forEach(spec => {
        allSpecialtiesToPreserve.push({
          specialityId: spec.specialityId,
          doctorId: spec.doctorId,
          scheduledTime: spec.scheduledTime,
          appointmentId: aptData.appointment.id,
          source: 'duplicate'
        });
      });
    });

    // Filter to only unique specialties (deduplicate by specialityId, doctorId, and time)
    // CRITICAL: If primary has NO AppointmentSpeciality records, we need to create them for ALL unique specialties
    // If primary HAS AppointmentSpeciality records, we only add new ones from duplicates
    const specialtiesToAdd: Array<{
      specialityId: string;
      doctorId: string;
      scheduledTime: Date;
      appointmentId: string;
    }> = [];
    const seenKeys = new Set<string>();
    const primaryHasRecords = primaryAppointment.appointmentSpecialities.length > 0;

    // Process all specialties and deduplicate
    allSpecialtiesToPreserve.forEach(spec => {
      const scheduledTime = new Date(spec.scheduledTime);
      const timeMinutes = scheduledTime.getUTCHours() * 60 + scheduledTime.getUTCMinutes();
      const key = `${spec.specialityId}-${spec.doctorId}-${timeMinutes}`;
      
      // Add if we haven't seen this exact combination before
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        // CRITICAL FIX: 
        // - If primary has NO AppointmentSpeciality records, we need to create ALL unique specialties (from both primary and duplicates)
        // - If primary HAS AppointmentSpeciality records, we only add new ones from duplicates (not already in primary)
        if (!primaryHasRecords) {
          // Primary has no records, so we need to create ALL unique specialties
          specialtiesToAdd.push({
            specialityId: spec.specialityId,
            doctorId: spec.doctorId,
            scheduledTime: spec.scheduledTime,
            appointmentId: spec.appointmentId
          });
        } else if (spec.source === 'duplicate' && !existingPrimarySpecialtyKeys.has(key)) {
          // Primary has records, so only add new ones from duplicates
          specialtiesToAdd.push({
            specialityId: spec.specialityId,
            doctorId: spec.doctorId,
            scheduledTime: spec.scheduledTime,
            appointmentId: spec.appointmentId
          });
        }
      }
    });
    
    console.log(`  - Primary has ${primaryAppointment.appointmentSpecialities.length} existing AppointmentSpeciality records`);
    console.log(`  - Collected ${allSpecialtiesToPreserve.length} total specialties from all appointments`);
    console.log(`  - Will create ${specialtiesToAdd.length} AppointmentSpeciality records (${primaryHasRecords ? 'new from duplicates' : 'all unique specialties'})`);

    // Get all unique specialty names for the speciality field (including existing ones)
    // First from AppointmentSpeciality records
    const allUniqueSpecialtyNames = new Set<string>();
    primaryAppointment.appointmentSpecialities.forEach(spec => {
      if (spec.speciality?.name) {
        allUniqueSpecialtyNames.add(spec.speciality.name);
      }
    });
    duplicateAppointments.forEach(aptData => {
      aptData.appointment.appointmentSpecialities.forEach(spec => {
        if (spec.speciality?.name) {
          allUniqueSpecialtyNames.add(spec.speciality.name);
        }
      });
    });

    // Also parse specialty names from the speciality string field (for legacy appointments)
    // This handles cases where appointments have only the string field but no AppointmentSpeciality records
    if (primaryAppointment.speciality) {
      const primarySpecialtyNames = primaryAppointment.speciality.split(',').map(s => s.trim()).filter(s => s);
      primarySpecialtyNames.forEach(name => allUniqueSpecialtyNames.add(name));
    }
    duplicateAppointments.forEach(aptData => {
      if (aptData.appointment.speciality) {
        const duplicateSpecialtyNames = aptData.appointment.speciality.split(',').map(s => s.trim()).filter(s => s);
        duplicateSpecialtyNames.forEach(name => allUniqueSpecialtyNames.add(name));
      }
    });

    // Log merge details before transaction
    const coordinatorLabel = coordinatorId || 'scheduled (no coordinator)';
    console.log(`Starting merge for patient ${patientId}, date ${appointmentDate.toISOString()}, coordinator ${coordinatorLabel}:`);
    console.log(`  - Found ${appointmentsWithSameCoordinator.length} appointments with same coordinator`);
    console.log(`  - Primary appointment ${primaryAppointment.id} has ${primaryAppointment.appointmentSpecialities.length} specialties`);
    console.log(`  - Will add ${specialtiesToAdd.length} new specialties from duplicates`);
    duplicateAppointments.forEach((apt, idx) => {
      console.log(`  - Duplicate ${idx + 1}: ${apt.appointment.id} has ${apt.appointment.appointmentSpecialities.length} specialties`);
    });

    // Perform merge in transaction
    const result = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // CRITICAL: If primary has no AppointmentSpeciality records, we need to ensure we don't lose any
        // First, delete any existing AppointmentSpeciality records for primary (if we're rebuilding them)
        // Actually, we should keep existing ones and only add new ones
        
        // Add new specialties to primary appointment
        const newAppointmentSpecialities = await Promise.all(
          specialtiesToAdd.map(async (spec) => {
            // Check if this specialty already exists in primary (shouldn't happen, but safety check)
            const existing = await tx.appointmentSpeciality.findFirst({
              where: {
                appointmentId: primaryAppointment.id,
                specialityId: spec.specialityId,
                doctorId: spec.doctorId,
                scheduledTime: spec.scheduledTime
              }
            });
            
            if (existing) {
              console.log(`  - Skipping duplicate specialty: ${spec.specialityId}-${spec.doctorId} at ${spec.scheduledTime}`);
              return existing;
            }
            
            return tx.appointmentSpeciality.create({
              data: {
                appointmentId: primaryAppointment.id,
                specialityId: spec.specialityId,
                doctorId: spec.doctorId,
                scheduledTime: spec.scheduledTime,
                status: 'scheduled'
              },
              include: {
                speciality: {
                  select: {
                    id: true,
                    name: true,
                    nameArabic: true
                  }
                },
                doctor: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            });
          })
        );

        console.log(`  - Created ${newAppointmentSpecialities.length} new AppointmentSpeciality records`);

        // Update appointment's speciality field with all unique specialty names
        const mergedSpecialityString = Array.from(allUniqueSpecialtyNames).join(', ');
        await tx.appointment.update({
          where: { id: primaryAppointment.id },
          data: {
            speciality: mergedSpecialityString
          }
        });
        
        console.log(`  - Updated speciality field: "${mergedSpecialityString}"`);
        console.log(`  - Primary had ${primaryAppointment.appointmentSpecialities.length} AppointmentSpeciality records`);
        console.log(`  - Added ${newAppointmentSpecialities.length} new AppointmentSpeciality records`);

        // Handle tasks: keep primary task, delete others
        const primaryTask = primaryAppointmentData.task;
        const duplicateAppointmentIds = duplicateAppointments.map(apt => apt.appointment.id);

        // Find ALL tasks for duplicate appointments (including any that might have been created after the initial query)
        const duplicateTasks = await tx.task.findMany({
          where: {
            relatedEntityType: 'appointment',
            relatedEntityId: {
              in: duplicateAppointmentIds
            }
          },
          select: {
            id: true,
            title: true,
            relatedEntityId: true
          }
        });

        console.log(`  - Found ${duplicateTasks.length} tasks for duplicate appointments:`, duplicateTasks.map(t => ({ id: t.id, title: t.title, appointmentId: t.relatedEntityId })));

        // Also check if primary appointment has multiple tasks (shouldn't happen, but just in case)
        const allPrimaryTasks = await tx.task.findMany({
          where: {
            relatedEntityType: 'appointment',
            relatedEntityId: primaryAppointment.id
          },
          select: {
            id: true,
            title: true
          },
          orderBy: {
            createdAt: 'asc' // Keep the oldest task
          }
        });

        console.log(`  - Found ${allPrimaryTasks.length} tasks for primary appointment:`, allPrimaryTasks.map(t => ({ id: t.id, title: t.title })));

        // If primary has multiple tasks, keep only the oldest one and delete the rest
        if (allPrimaryTasks.length > 1) {
          const tasksToDelete = allPrimaryTasks.slice(1); // All except the first (oldest)
          console.log(`  - Primary has multiple tasks, deleting ${tasksToDelete.length} duplicate task(s)`);
          await tx.task.deleteMany({
            where: {
              id: {
                in: tasksToDelete.map(t => t.id)
              }
            }
          });
        }

        // Update primary task metadata if it exists (use the oldest task if multiple exist)
        const taskToUpdate = allPrimaryTasks.length > 0 ? allPrimaryTasks[0] : primaryTask;
        if (taskToUpdate) {
          await tx.task.update({
            where: { id: taskToUpdate.id },
            data: {
              metadata: {
                ...(taskToUpdate as any).metadata || {},
                mergedSpecialties: Array.from(allUniqueSpecialtyNames),
                mergedFromAppointments: duplicateAppointmentIds
              }
            }
          });
        }

        // Delete tasks for duplicate appointments
        if (duplicateTasks.length > 0) {
          console.log(`  - Deleting ${duplicateTasks.length} task(s) from duplicate appointments`);
          await tx.task.deleteMany({
            where: {
              id: {
                in: duplicateTasks.map(t => t.id)
              }
            }
          });
        }

        // Delete AppointmentSpeciality records for duplicate appointments first (to avoid foreign key constraint)
        console.log(`  - Deleting AppointmentSpeciality records for ${duplicateAppointmentIds.length} duplicate appointment(s)`);
        await tx.appointmentSpeciality.deleteMany({
          where: {
            appointmentId: {
              in: duplicateAppointmentIds
            }
          }
        });

        // Delete duplicate appointments (AppointmentSpeciality records already deleted)
        console.log(`  - Deleting ${duplicateAppointmentIds.length} duplicate appointment(s)`);
        await tx.appointment.deleteMany({
          where: {
            id: {
              in: duplicateAppointmentIds
            }
          }
        });

        // Verify final appointment has all specialties
        const finalAppointment = await tx.appointment.findUnique({
          where: { id: primaryAppointment.id },
          select: {
            id: true,
            speciality: true, // Include the speciality string field
            appointmentSpecialities: {
              include: {
                speciality: {
                  select: {
                    id: true,
                    name: true,
                    nameArabic: true
                  }
                },
                doctor: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              },
              orderBy: {
                scheduledTime: 'asc'
              }
            }
          }
        });

        const totalSpecialtiesAfterMerge = finalAppointment?.appointmentSpecialities.length || 0;
        const primarySpecialtiesCount = primaryAppointment.appointmentSpecialities.length;
        const finalSpecialityString = finalAppointment?.speciality || '';
        
        console.log(`Merge completed for patient ${patientId}:`);
        console.log(`  - Primary appointment: ${primaryAppointment.id}`);
        console.log(`  - Merged ${duplicateAppointments.length} duplicate appointment(s)`);
        console.log(`  - Primary had ${primarySpecialtiesCount} AppointmentSpeciality records`);
        console.log(`  - Added ${specialtiesToAdd.length} new AppointmentSpeciality records`);
        console.log(`  - Final appointment has ${totalSpecialtiesAfterMerge} AppointmentSpeciality records`);
        console.log(`  - Final speciality string field: "${finalSpecialityString}"`);

        return {
          isMerged: true,
          primaryAppointmentId: primaryAppointment.id,
          mergedCount: duplicateAppointments.length,
          deletedAppointmentIds: duplicateAppointmentIds,
          mergedSpecialtyCount: specialtiesToAdd.length,
          totalSpecialtiesAfterMerge: finalAppointment?.appointmentSpecialities.length || 0
        };
      });
    });

    return result;
  } catch (error) {
    console.error('Error merging duplicate appointments:', error);
    // Don't throw - return null to indicate no merge occurred
    return null;
  }
};

/**
 * Finds all duplicate appointment groups across all patients
 * Groups by: patientId + same calendar day + hospitalId + coordinator (or null for scheduled)
 * Returns groups that have 2+ appointments (duplicates)
 */
export const findAllDuplicateAppointmentGroups = async (): Promise<Array<{
  patientId: string;
  scheduledDate: Date;
  hospitalId: string;
  coordinatorId: string | null;
  appointmentIds: string[];
  appointmentCount: number;
}>> => {
  try {
    // Find all appointments with status 'scheduled' or 'assigned'
    const allAppointments = await withDbRetry(async () => {
      return await prisma.appointment.findMany({
        where: {
          status: {
            in: ['scheduled', 'assigned']
          }
        },
        select: {
          id: true,
          patientId: true,
          hospitalId: true,
          scheduledDate: true,
          status: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });
    });

    // Get tasks for all appointments to determine coordinators
    const appointmentsWithCoordinators = await Promise.all(
      allAppointments.map(async (appointment) => {
        const task = await prisma.task.findFirst({
          where: {
            relatedEntityId: appointment.id,
            relatedEntityType: 'appointment'
          },
          select: {
            assignedToId: true
          }
        });
        return {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          hospitalId: appointment.hospitalId,
          scheduledDate: appointment.scheduledDate,
          status: appointment.status,
          coordinatorId: task?.assignedToId || null
        };
      })
    );

    // Group by patient, date, hospital, and coordinator
    const groupsMap = new Map<string, Array<{
      appointmentId: string;
      patientId: string;
      hospitalId: string;
      scheduledDate: Date;
      coordinatorId: string | null;
    }>>();

    appointmentsWithCoordinators.forEach(apt => {
      // Calculate day start for consistent grouping
      const dayStart = new Date(apt.scheduledDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dateKey = dayStart.toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Use 'scheduled' as key for appointments without coordinator
      // Important: Use explicit string 'scheduled' for null coordinatorId to ensure consistent grouping
      const coordinatorKey = apt.coordinatorId ? apt.coordinatorId : 'scheduled';
      // Include hospitalId in grouping key to prevent cross-hospital merges
      const groupKey = `${apt.patientId}-${dateKey}-${apt.hospitalId}-${coordinatorKey}`;
      
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, []);
      }
      groupsMap.get(groupKey)!.push(apt);
    });

    console.log(`Found ${groupsMap.size} unique appointment groups`);

    // Filter to only groups with 2+ appointments (duplicates)
    const duplicateGroups: Array<{
      patientId: string;
      scheduledDate: Date;
      hospitalId: string;
      coordinatorId: string | null;
      appointmentIds: string[];
      appointmentCount: number;
    }> = [];

    groupsMap.forEach((appointments, groupKey) => {
      if (appointments.length >= 2) {
        const firstAppointment = appointments[0];
        console.log(`Duplicate group found: ${groupKey} with ${appointments.length} appointments`);
        duplicateGroups.push({
          patientId: firstAppointment.patientId,
          scheduledDate: firstAppointment.scheduledDate,
          hospitalId: firstAppointment.hospitalId,
          coordinatorId: firstAppointment.coordinatorId,
          appointmentIds: appointments.map(a => a.appointmentId),
          appointmentCount: appointments.length
        });
      }
    });

    console.log(`Total duplicate groups found: ${duplicateGroups.length}`);

    return duplicateGroups;
  } catch (error) {
    console.error('Error finding duplicate appointment groups:', error);
    return [];
  }
};

/**
 * Comprehensive function to find and merge all duplicate appointments
 * Groups appointments by coordinator and merges each group
 * Returns summary of merge operations
 */
export const findAndMergeAllDuplicateAppointments = async (): Promise<{
  totalGroupsProcessed: number;
  totalGroupsMerged: number;
  totalAppointmentsMerged: number;
  totalTasksMerged: number;
  mergeResults: Array<{
    patientId: string;
    scheduledDate: Date;
    hospitalId: string;
    coordinatorId: string | null;
    merged: boolean;
    mergedCount: number;
    primaryAppointmentId: string;
    deletedAppointmentIds: string[];
    error?: string;
  }>;
}> => {
  try {
    // Find all duplicate groups
    const duplicateGroups = await findAllDuplicateAppointmentGroups();
    
    console.log(`Found ${duplicateGroups.length} duplicate appointment groups to process`);

    const mergeResults: Array<{
      patientId: string;
      scheduledDate: Date;
      hospitalId: string;
      coordinatorId: string | null;
      merged: boolean;
      mergedCount: number;
      primaryAppointmentId: string;
      deletedAppointmentIds: string[];
      error?: string;
    }> = [];

    let totalAppointmentsMerged = 0;
    let totalTasksMerged = 0;
    let totalGroupsMerged = 0;

    // Process each group
    for (const group of duplicateGroups) {
      try {
        // Convert 'scheduled' string back to null for appointments without coordinators
        const coordinatorId = group.coordinatorId === 'scheduled' ? null : group.coordinatorId;
        console.log(`Processing merge for patient ${group.patientId}, date ${group.scheduledDate.toISOString()}, hospital ${group.hospitalId}, coordinator ${coordinatorId || 'null (scheduled)'}`);
        
        const mergeResult = await mergeDuplicateAppointmentsForPatient(
          group.patientId,
          group.scheduledDate,
          group.hospitalId,
          coordinatorId
        );

        if (mergeResult && mergeResult.isMerged) {
          totalGroupsMerged++;
          totalAppointmentsMerged += mergeResult.mergedCount;
          // Estimate tasks merged (one per merged appointment)
          totalTasksMerged += mergeResult.mergedCount;

          mergeResults.push({
            patientId: group.patientId,
            scheduledDate: group.scheduledDate,
            hospitalId: group.hospitalId,
            coordinatorId: group.coordinatorId,
            merged: true,
            mergedCount: mergeResult.mergedCount,
            primaryAppointmentId: mergeResult.primaryAppointmentId,
            deletedAppointmentIds: mergeResult.deletedAppointmentIds
          });
        } else {
          mergeResults.push({
            patientId: group.patientId,
            scheduledDate: group.scheduledDate,
            hospitalId: group.hospitalId,
            coordinatorId: group.coordinatorId,
            merged: false,
            mergedCount: 0,
            primaryAppointmentId: '',
            deletedAppointmentIds: []
          });
        }
      } catch (error) {
        console.error(`Error merging group for patient ${group.patientId}:`, error);
        mergeResults.push({
          patientId: group.patientId,
          scheduledDate: group.scheduledDate,
          hospitalId: group.hospitalId,
          coordinatorId: group.coordinatorId,
          merged: false,
          mergedCount: 0,
          primaryAppointmentId: '',
          deletedAppointmentIds: [],
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      totalGroupsProcessed: duplicateGroups.length,
      totalGroupsMerged,
      totalAppointmentsMerged,
      totalTasksMerged,
      mergeResults
    };
  } catch (error) {
    console.error('Error in findAndMergeAllDuplicateAppointments:', error);
    throw error;
  }
};
