import { prisma } from "./database.utils";

/**
 * Normalizes a national ID by removing all dashes and spaces.
 * This is used for duplicate checking while preserving the original format in the database.
 * 
 * @param id - The national ID string (e.g., "784-1972-6398098-5" or "784197263980985")
 * @returns The normalized ID without dashes or spaces (e.g., "784197263980985")
 */
export function normalizeNationalId(id: string | null | undefined): string {
  if (!id) return '';
  return id.replace(/[\s-]/g, '');
}

/**
 * Finds a patient by normalized national ID.
 * This function fetches all patients and compares normalized IDs to handle
 * cases where IDs are entered with or without dashes.
 * 
 * @param normalizedId - The normalized national ID (without dashes/spaces)
 * @returns The patient if found, null otherwise
 */
export async function findPatientByNormalizedId(normalizedId: string) {
  if (!normalizedId || normalizedId.trim() === '') {
    return null;
  }

  // Fetch all patients and compare normalized IDs
  // This approach handles cases where IDs are stored with different dash formats
  const patients = await prisma.patient.findMany({
    select: {
      id: true,
      nationalId: true,
    }
  });

  // Find patient with matching normalized ID
  const matchingPatient = patients.find(patient => {
    if (!patient.nationalId) return false;
    const patientNormalizedId = normalizeNationalId(patient.nationalId);
    return patientNormalizedId === normalizedId;
  });

  if (matchingPatient) {
    // Return full patient record
    return await prisma.patient.findUnique({
      where: { id: matchingPatient.id }
    });
  }

  return null;
}

/**
 * Checks if a patient with the given normalized national ID already exists.
 * 
 * @param normalizedId - The normalized national ID (without dashes/spaces)
 * @returns true if patient exists, false otherwise
 */
export async function patientExistsByNormalizedId(normalizedId: string): Promise<boolean> {
  const patient = await findPatientByNormalizedId(normalizedId);
  return patient !== null;
}

