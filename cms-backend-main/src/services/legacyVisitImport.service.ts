import { prisma } from '../utils/database.utils';
import { normalizeNationalId } from '../utils/patientId.utils';

export interface LegacyVisitRecord {
  nationalId: string;
  hospitalLabel: string;
  visitDate: string | Date | number;
  salesName?: string;
  coordinatorName?: string;
}

export interface LegacyVisitImportResult {
  created: number;
  duplicates: number;
  unmatchedPatients: number;
  unmatchedHospitals: number;
  unmatchedSales: number;
  usedDefaultCoordinator: number;
  deduplicationResult?: {
    duplicatesFound: number;
    visitsMerged: number;
    specialtiesMerged: number;
  };
}

// Normalize hospital names for matching
// Removes all digits (handles any number suffix: Fakeeh1, Fakeeh12, Fakeeh123, etc.)
// Also removes "visit" text and normalizes separators
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/visit/g, '')
    .replace(/\d+/g, '') // Remove all digits (handles any number: 1, 2, 12, 123, etc.)
    .replace(/[\-_/.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeName = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFFa-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Hospital name aliases for matching Excel column names to system hospital names
// Note: The normalize() function removes all digits, so we don't need to list every number variant
// (e.g., fakeeh1, fakeeh2, fakeeh12, etc. all normalize to "fakeeh")
// We only include specific variants that have special formatting (like "klamenso 1" with a space)
const HOSPITAL_ALIASES: Record<string, string[]> = {
  'IMH': ['imh', 'imh hospital', 'imh visit', 'imh -', 'imh -visit', 'imh visit 1'],
  'Fakeeh': ['fakeeh', 'dr soliman fakeeh', 'soliman fakeeh', 'fakeeh hospital'], // fakeeh1, fakeeh2, fakeeh12, etc. are handled by normalize()
  'Sulaiman': ['sulaiman', 'suliman', 'sulaiman-visit', 'sulaiman visit', 'sulaiman visit 1', 'sulaiman-vist 1', 'sulaiman al habib', 'habib'],
  'Royal': ['medcare', 'medcare visit', 'medcare visit 1', 'royal'],
  'Rama': ['rama'],
  'Luzan': ['luzan'],
  'Hellenic': ['hellenic'],
  'Monroe Dental': ['monroo', 'monroe', 'monro', 'monroe dental'], // monroo1, monroo2, etc. are handled by normalize()
  'Cleamenceau': ['clemenceau', 'cleamenceau', 'klamenso', 'klamenso 1'], // Keep "klamenso 1" since it has a space before the number
};

async function getOrCreateLegacyCoordinatorId(): Promise<string> {
  const name = 'Legacy Coordinator';
  const existing = await prisma.employee.findFirst({ where: { name } });
  if (existing) return existing.id;
  const created = await prisma.employee.create({
    data: {
      name,
      phone: '0000000000',
      password: 'legacy_placeholder',
      role: 'coordinator',
      accountStatus: 'active',
    },
  });
  return created.id;
}

async function buildHospitalLookup() {
  const hospitals = await prisma.hospital.findMany();
  const byId = new Map(hospitals.map(h => [h.id, h]));
  const byName = new Map(hospitals.map(h => [h.name, h]));
  const byNorm = new Map<string, typeof hospitals[number]>();
  hospitals.forEach(h => byNorm.set(normalize(h.name), h));

  // Alias index
  const aliasIndex = new Map<string, typeof hospitals[number]>();
  hospitals.forEach(h => {
    const aliases = HOSPITAL_ALIASES[h.name] || [];
    aliases.forEach(a => aliasIndex.set(normalize(a), h));
  });

  return { byId, byName, byNorm, aliasIndex };
}

async function matchEmployeeByName(name?: string, roleFilter?: 'sales' | 'coordinator'): Promise<string | null> {
  if (!name) return null;
  
  // Filter by role if specified (for sales matching)
  const whereClause: any = { isActive: true };
  if (roleFilter) {
    whereClause.role = roleFilter;
  }
  
  const all = await prisma.employee.findMany({ 
    where: whereClause,
    select: { id: true, name: true, role: true } 
  });
  
  const target = normalizeName(name);
  
  // exact match
  let found = all.find(e => normalizeName(e.name) === target);
  if (found) return found.id;
  
  // contains match (handles partial matches and Arabic/English variations)
  found = all.find(e => {
    const n = normalizeName(e.name);
    return n.includes(target) || target.includes(n);
  });
  if (found) return found.id;
  
  // Try matching first word (common in Arabic names where first name might match)
  const targetFirstWord = target.split(/\s+/)[0];
  if (targetFirstWord && targetFirstWord.length > 2) {
    found = all.find(e => {
      const n = normalizeName(e.name);
      const nameFirstWord = n.split(/\s+/)[0];
      return nameFirstWord === targetFirstWord || 
             nameFirstWord.includes(targetFirstWord) || 
             targetFirstWord.includes(nameFirstWord);
    });
    if (found) return found.id;
  }
  
  return null;
}

function parseDateLoose(input: string | Date | number): Date | null {
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    // Excel serial date support (assuming 1900 system)
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = input * 86400000;
    const d = new Date(epoch.getTime() + ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export async function importLegacyVisits(records: LegacyVisitRecord[]): Promise<LegacyVisitImportResult> {
  const result: LegacyVisitImportResult = {
    created: 0,
    duplicates: 0,
    unmatchedPatients: 0,
    unmatchedHospitals: 0,
    unmatchedSales: 0,
    usedDefaultCoordinator: 0,
  };

  const legacyCoordinatorId = await getOrCreateLegacyCoordinatorId();
  const { byName, byNorm, aliasIndex } = await buildHospitalLookup();

  const batchSize = 500;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    // Preload unique patient nationalIds in batch
    const nis = Array.from(new Set(batch.map(r => r.nationalId).filter(Boolean)));
    const patients = await prisma.patient.findMany({ select: { id: true, nationalId: true } });
    
    // Create a map using normalized IDs for matching
    const niToPid = new Map<string, string>();
    patients.forEach(p => {
      if (p.nationalId) {
        const normalizedId = normalizeNationalId(p.nationalId);
        niToPid.set(normalizedId, p.id);
      }
    });

    // Preload sales/coordinators names? keep per-record matching for now

    for (const r of batch) {
      // Normalize the national ID from the record for matching
      const normalizedRecordId = normalizeNationalId(r.nationalId);
      const patientId = niToPid.get(normalizedRecordId);
      if (!patientId) {
        result.unmatchedPatients++;
        continue;
      }

      // Hospital match
      const rawLabel = r.hospitalLabel || '';
      const direct = byName.get(rawLabel);
      let hospitalId = direct?.id;
      if (!hospitalId) {
        const norm = normalize(rawLabel);
        const h = byNorm.get(norm) || aliasIndex.get(norm);
        hospitalId = h?.id;
      }
      if (!hospitalId) {
        result.unmatchedHospitals++;
        continue;
      }

      // Date
      const visitDate = parseDateLoose(r.visitDate);
      if (!visitDate) {
        continue;
      }
      // Normalize date to start of day for consistent comparison
      visitDate.setHours(0, 0, 0, 0);

      // Sales - filter by role='sales' and match Arabic names from Excel to English names in system
      const salesId = await matchEmployeeByName(r.salesName, 'sales');
      if (!salesId) result.unmatchedSales++;

      // Coordinator
      let coordinatorId = await matchEmployeeByName(r.coordinatorName);
      if (!coordinatorId) {
        coordinatorId = legacyCoordinatorId;
        result.usedDefaultCoordinator++;
      }

      // Dedup check - use exact date match (not date range) to avoid false positives
      // Check if visit exists for this patient, hospital, and exact date
      // Normalize visitDate to start of day for comparison
      const visitDateStart = new Date(visitDate);
      visitDateStart.setHours(0, 0, 0, 0);
      const visitDateEnd = new Date(visitDateStart);
      visitDateEnd.setHours(23, 59, 59, 999);
      
      const exists = await prisma.visit.findFirst({
        where: {
          patientId,
          hospitalId,
          visitDate: {
            gte: visitDateStart,
            lte: visitDateEnd,
          },
        },
        select: { id: true },
      });
      if (exists) {
        result.duplicates++;
        continue;
      }
      

      await prisma.visit.create({
        data: {
          patientId,
          hospitalId,
          coordinatorId,
          salesId: salesId || legacyCoordinatorId, // fallback if sales missing
          visitDate: visitDate,
          isEmergency: false,
        },
      });
      result.created++;
    }
  }

  // Automatically deduplicate visits after import completes
  try {
    console.log('Running automatic deduplication after legacy visit import...');
    const { deduplicateVisitsProgrammatically } = await import('./visitDeduplication.service');
    const dedupResult = await deduplicateVisitsProgrammatically();
    console.log(`Automatic deduplication completed: ${dedupResult.totalDuplicatesFound} duplicates found and merged`);
    result.deduplicationResult = {
      duplicatesFound: dedupResult.totalDuplicatesFound,
      visitsMerged: dedupResult.visitsDeleted,
      specialtiesMerged: dedupResult.specialtiesMerged
    };
  } catch (dedupError: any) {
    console.error('Error during automatic deduplication after legacy import:', dedupError);
    // Don't fail the import if deduplication fails - just log it
  }

  return result;
}

export default { importLegacyVisits };


