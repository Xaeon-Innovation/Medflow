import { prisma } from './database.utils';

export type AppointmentType = 'new_patient' | 'existing_patient' | 'follow_up_task' | 'unknown' | 'mixed';

/**
 * Determines the appointment type based on appointment fields
 * @param appointment - Appointment object with isNewPatientAtCreation, createdFromFollowUpTaskId, patientVisitCount, and isFirstVisitToHospital
 * @returns Appointment type
 */
export function determineAppointmentType(appointment: {
  isNewPatientAtCreation: boolean | null;
  createdFromFollowUpTaskId: string | null;
  patientVisitCount?: number;
  isFirstVisitToHospital?: boolean;
}): 'new_patient' | 'existing_patient' | 'follow_up_task' {
  // Follow-up task takes priority
  if (appointment.createdFromFollowUpTaskId) {
    return 'follow_up_task';
  }
  
  // New patient if:
  // 1. Explicitly marked as new patient at creation, OR
  // 2. Patient has no visits (visit count = 0), OR
  // 3. This is the patient's first visit to this hospital
  if (
    appointment.isNewPatientAtCreation === true ||
    appointment.patientVisitCount === 0 ||
    appointment.isFirstVisitToHospital === true
  ) {
    return 'new_patient';
  }
  
  // Existing patient (default case)
  return 'existing_patient';
}

/**
 * Gets the appointment type for a visit by checking its related appointments
 * @param visit - Visit object with appointments relation
 * @returns Appointment type (unknown if no appointments, mixed if multiple types)
 */
export function getVisitAppointmentType(visit: {
  appointments?: Array<{
    isNewPatientAtCreation: boolean | null;
    createdFromFollowUpTaskId: string | null;
  }>;
}): AppointmentType {
  if (!visit.appointments || visit.appointments.length === 0) {
    return 'unknown';
  }

  const types = visit.appointments.map(apt => determineAppointmentType(apt));
  const uniqueTypes = new Set(types);
  
  if (uniqueTypes.size === 1) {
    return types[0] as AppointmentType;
  }
  
  return 'mixed';
}

/**
 * Gets the appointment type for a transaction by tracing through visitSpecialities -> visit -> appointments
 * @param transaction - Transaction object with visitSpecialities relation
 * @returns Appointment type (unknown if no visits, mixed if multiple types)
 */
export async function getTransactionAppointmentType(transaction: {
  visitSpecialities?: Array<{
    visitSpeciality?: {
      visit?: {
        appointments?: Array<{
          isNewPatientAtCreation: boolean | null;
          createdFromFollowUpTaskId: string | null;
        }>;
      };
    };
  }>;
}): Promise<AppointmentType> {
  if (!transaction.visitSpecialities || transaction.visitSpecialities.length === 0) {
    return 'unknown';
  }

  // Collect all appointment types from all visits
  const types: AppointmentType[] = [];
  
  for (const tvs of transaction.visitSpecialities) {
    const visit = tvs.visitSpeciality?.visit;
    if (visit) {
      const visitType = getVisitAppointmentType(visit);
      if (visitType !== 'unknown') {
        types.push(visitType);
      }
    }
  }

  if (types.length === 0) {
    return 'unknown';
  }

  // If all types are the same, return that type
  const uniqueTypes = new Set(types);
  if (uniqueTypes.size === 1) {
    return types[0];
  }

  // If we have mixed types, return 'mixed'
  // But if we have a mix of 'new_patient', 'existing_patient', and 'follow_up_task',
  // we could prioritize 'follow_up_task' or return 'mixed'
  // For now, return 'mixed'
  return 'mixed';
}

/**
 * Gets appointment type for a visit by querying appointments (when visit doesn't have appointments relation loaded)
 * @param visitId - Visit ID
 * @returns Appointment type
 */
export async function getVisitAppointmentTypeById(visitId: string): Promise<AppointmentType> {
  const appointments = await prisma.appointment.findMany({
    where: { visitId },
    select: {
      isNewPatientAtCreation: true,
      createdFromFollowUpTaskId: true,
    },
  });

  if (appointments.length === 0) {
    return 'unknown';
  }

  const types = appointments.map(apt => determineAppointmentType(apt));
  const uniqueTypes = new Set(types);
  
  if (uniqueTypes.size === 1) {
    return types[0] as AppointmentType;
  }
  
  return 'mixed';
}

/**
 * Calculates patient age from date of birth or national ID
 * @param dob - Date of birth (can be Date, string, or null)
 * @param nationalId - National ID string (optional, used as fallback)
 * @returns Age as number, or null if cannot be determined
 */
export function calculatePatientAge(dob: Date | string | null | undefined, nationalId?: string | null): number | null {
  // Try to calculate from DOB first
  if (dob) {
    try {
      const birthDate = typeof dob === 'string' ? new Date(dob) : dob;
      if (!isNaN(birthDate.getTime())) {
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        
        // Adjust age if birthday hasn't occurred this year
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        
        if (age >= 0 && age <= 150) {
          return age;
        }
      }
    } catch (e) {
      // Fall through to national ID extraction
    }
  }
  
  // Fallback: Extract birth year from national ID (UAE format: first 2 digits are birth year)
  if (nationalId && nationalId.length >= 2) {
    try {
      const birthYearStr = nationalId.substring(0, 2);
      const birthYear = parseInt(birthYearStr);
      
      if (!isNaN(birthYear)) {
        // UAE national IDs: 00-29 = 2000-2029, 30-99 = 1930-1999
        const fullBirthYear = birthYear <= 29 ? 2000 + birthYear : 1900 + birthYear;
        const today = new Date();
        const age = today.getFullYear() - fullBirthYear;
        
        if (age >= 0 && age <= 150) {
          return age;
        }
      }
    } catch (e) {
      // Return null if extraction fails
    }
  }
  
  return null;
}

/**
 * Determines if a patient is an adult or child based on age
 * @param age - Patient age (can be number or null)
 * @returns 'adult' if age > 16, 'child' if age <= 16, or null if age is unknown
 */
export function getAgeCategory(age: number | null): 'adult' | 'child' | null {
  if (age === null) {
    return null;
  }
  return age > 16 ? 'adult' : 'child';
}

