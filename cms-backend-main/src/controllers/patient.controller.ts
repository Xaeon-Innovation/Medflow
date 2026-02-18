import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import { withDbRetry, prisma } from "../utils/database.utils";
import { assignDataEntryTaskForPatient, completeDataEntryTasksForPatient, getPatientMissingFields } from "../services/taskAutomation.service";
import { incrementTarget } from "../services/targetManagement.service";
import { normalizeNationalId, findPatientByNormalizedId } from "../utils/patientId.utils";
import "../middleware/auth.middleware"; // Import to extend Request interface

// Helper function to calculate patient status based on visit count and recency
function calculatePatientStatus(visitCount: number, lastVisitDate?: Date): 'new' | 'follow-up' {
  if (visitCount === 0) return 'new';
  if (visitCount >= 2) return 'follow-up';
  
  // visitCount === 1
  if (!lastVisitDate) return 'new';
  
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  
  return lastVisitDate < oneMonthAgo ? 'follow-up' : 'new';
}

// Helper function to increment commission
async function incrementCommission(employeeId: string, incrementAmount: number = 1) {
  try {
    if (!employeeId) {
      return {
        status: 400,
        success: false,
        message: "Employee ID is required",
      };
    }

    const employee = await prisma.employee.update({
      where: { id: employeeId },
      data: {
        commissions: {
          increment: incrementAmount,
        },
      },
    });

    return {
      status: 200,
      success: true,
      message: "Commission Incremented Successfully",
      data: employee,
    };
  } catch (err) {
    console.error("Increment Commission error:", err);
    return {
      status: 500,
      success: false,
      message: "Failed to Increment Commission",
      error: err,
    };
  }
}

export const getPatients = async (req: Request, res: Response) => {
  try {
    // Extract pagination and search parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50; // Default 50 per page
    const offset = (page - 1) * limit;
    const search = (req.query.search as string) || '';
    const statusFilter = req.query.status as string; // 'all', 'new', 'follow-up'
    const visitsCountFilter = req.query.visitsCount as string; // Filter by exact number of visits

    // Build where clause for search
    const where: any = {};
    if (search) {
      // Normalize search term for national ID matching
      const normalizedSearch = normalizeNationalId(search);
      
      where.OR = [
        { nameEnglish: { contains: search, mode: 'insensitive' } },
        { nameArabic: { contains: search, mode: 'insensitive' } },
        { nationalId: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search, mode: 'insensitive' } },
      ];
      
      // If search term looks like a national ID (contains only digits after normalization), 
      // also search by normalized ID to handle different dash formats
      if (normalizedSearch && normalizedSearch.length >= 3 && /^\d+$/.test(normalizedSearch)) {
        // Fetch all patients and filter by normalized ID in memory
        // This handles cases where search term has different dash format than stored ID
        const allPatientsForIdSearch = await withDbRetry(async () => {
          return await prisma.patient.findMany({
            select: { id: true, nationalId: true }
          });
        });
        
        const matchingPatientIds = allPatientsForIdSearch
          .filter(p => {
            if (!p.nationalId) return false;
            const normalizedPatientId = normalizeNationalId(p.nationalId);
            // Exact match for full IDs, or partial match if search is shorter
            return normalizedPatientId === normalizedSearch || 
                   (normalizedSearch.length >= 5 && normalizedPatientId.includes(normalizedSearch));
          })
          .map(p => p.id);
        
        if (matchingPatientIds.length > 0) {
          where.OR.push({ id: { in: matchingPatientIds } });
        }
      }
    }

    // Fetch all patients with visit counts (we need to filter by visit count)
    const allPatients = await withDbRetry(async () => {
      return await prisma.patient.findMany({
        where,
        include: {
          salesPerson: {
            select: {
              name: true,
            },
          },
          insuranceType: {
            select: {
              id: true,
              name: true
            }
          },
          _count: {
            select: {
              appointments: true,
              visits: true
            }
          },
          visits: {
            select: {
              visitDate: true
            },
            orderBy: {
              visitDate: 'desc'
            },
            take: 1
          }
        },
        orderBy: {
          createdAt: 'desc' // Most recent first
        }
      });
    });
    
    // Transform the data to include salesName, noAppointmentsBooked, noVisitsDone, and patient status
    let transformedPatients = allPatients.map((patient: any) => {
      const visitCount = patient._count.visits;
      const lastVisitDate = patient.visits && patient.visits.length > 0 
        ? new Date(patient.visits[0].visitDate) 
        : undefined;
      const patientStatus = calculatePatientStatus(visitCount, lastVisitDate);
      
      return {
        ...patient,
        salesName: patient.salesPerson?.name || "",
        noAppointmentsBooked: patient._count.appointments,
        noVisitsDone: visitCount,
        isNewPatient: patientStatus === 'new',
        isFollowUpPatient: patientStatus === 'follow-up',
        patientStatus
      };
    });

    // Apply status filter on transformed data (since it depends on visit count)
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'new') {
        transformedPatients = transformedPatients.filter(p => p.isNewPatient);
      } else if (statusFilter === 'follow-up') {
        transformedPatients = transformedPatients.filter(p => p.isFollowUpPatient);
      }
    }

    // Apply visits count filter (exact match)
    if (visitsCountFilter && visitsCountFilter !== '') {
      const visitsCount = parseInt(visitsCountFilter);
      if (!isNaN(visitsCount)) {
        transformedPatients = transformedPatients.filter(p => p.noVisitsDone === visitsCount);
      }
    }

    // Get total count after all filters
    const totalCount = transformedPatients.length;

    // Apply pagination to filtered results
    const patients = transformedPatients.slice(offset, offset + limit);

    res.status(200).json({ 
      patients: patients,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching patients:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(400).json({ 
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Search patients - optimized for autocomplete/search functionality
export const searchPatients = async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || '';
    
    if (!query || query.trim().length < 2) {
      return res.status(200).json({
        success: true,
        patients: []
      });
    }

    const searchTerm = query.trim();
    
    // Normalize search term for national ID matching
    const normalizedSearch = normalizeNationalId(searchTerm);
    
    // Build where clause for search
    const where: any = {
      OR: [
        { nameEnglish: { contains: searchTerm, mode: 'insensitive' } },
        { nameArabic: { contains: searchTerm, mode: 'insensitive' } },
        { nationalId: { contains: searchTerm, mode: 'insensitive' } },
        { phoneNumber: { contains: searchTerm, mode: 'insensitive' } },
      ]
    };
    
    // If search term looks like a national ID (contains only digits after normalization), 
    // also search by normalized ID to handle different dash formats
    if (normalizedSearch && normalizedSearch.length >= 3 && /^\d+$/.test(normalizedSearch)) {
      // Fetch all patients and filter by normalized ID in memory
      // This handles cases where search term has different dash format than stored ID
      const allPatientsForIdSearch = await withDbRetry(async () => {
        return await prisma.patient.findMany({
          select: { id: true, nationalId: true }
        });
      });
      
      const matchingPatientIds = allPatientsForIdSearch
        .filter(p => {
          if (!p.nationalId) return false;
          const normalizedPatientId = normalizeNationalId(p.nationalId);
          // Exact match for full IDs, or partial match if search is shorter
          return normalizedPatientId === normalizedSearch || 
                 (normalizedSearch.length >= 5 && normalizedPatientId.includes(normalizedSearch));
        })
        .map(p => p.id);
      
      if (matchingPatientIds.length > 0) {
        where.OR.push({ id: { in: matchingPatientIds } });
      }
    }

    // Fetch patients with minimal fields for search results
    const patients = await withDbRetry(async () => {
      return await prisma.patient.findMany({
        where,
        select: {
          id: true,
          nameEnglish: true,
          nameArabic: true,
          nationalId: true,
          phoneNumber: true,
          dob: true,
          salesPerson: {
            select: {
              id: true,
              name: true
            }
          },
          insuranceType: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 50 // Limit to 50 results for search
      });
    });

    res.status(200).json({
      success: true,
      patients: patients
    });
  } catch (err) {
    console.error('Error searching patients:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(400).json({
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

export const getPatientById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const patient = await withDbRetry(async () => {
      return await prisma.patient.findUnique({
        where: {
          id: id,
        },
        include: {
          salesPerson: {
            select: {
              name: true,
            },
          },
          insuranceType: {
            select: {
              id: true,
              name: true
            }
          },
          _count: {
            select: {
              appointments: true,
              visits: true
            }
          },
          visits: {
            select: {
              visitDate: true
            },
            orderBy: {
              visitDate: 'desc'
            },
            take: 1
          }
        }
      });
    });
    
    if (!patient) {
      return res.status(404).json({ 
        success: false,
        message: 'Patient not found' 
      });
    }

    // Transform the data to include status information
    const visitCount = patient._count.visits;
    const lastVisitDate = patient.visits && patient.visits.length > 0 
      ? new Date(patient.visits[0].visitDate) 
      : undefined;
    const patientStatus = calculatePatientStatus(visitCount, lastVisitDate);
    
    const transformedPatient = {
      ...patient,
      salesName: patient.salesPerson?.name || "",
      noAppointmentsBooked: patient._count.appointments,
      noVisitsDone: visitCount,
      isNewPatient: patientStatus === 'new',
      isFollowUpPatient: patientStatus === 'follow-up',
      patientStatus
    };

    res.status(200).json({ 
      success: true,
      patient: transformedPatient 
    });
  } catch (err) {
    console.error('Error fetching patient by ID:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(400).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

export const getPatientByFilter = async (req: Request, res: Response) => {
  try {
    const patients = await withDbRetry(async () => {
      return await prisma.patient.findMany({
        where: {
          [req.params.filterName]: req.body.filterData,
        },
      });
    });
    res.status(200).json({ patients });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Something went wrong" });
  }
};

// Get patients by hospital ID (patients who have visited the hospital)
export const getPatientsByHospital = async (req: Request, res: Response) => {
  try {
    const { hospitalId } = req.params;
    
    if (!hospitalId) {
      return res.status(400).json({
        success: false,
        error: 'Hospital ID is required'
      });
    }

    // Get unique patient IDs from visits for this hospital
    const visits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: { hospitalId },
        select: {
          patientId: true
        },
        distinct: ['patientId']
      });
    });

    const patientIds = visits.map(v => v.patientId).filter(Boolean);
    
    if (patientIds.length === 0) {
      return res.status(200).json({
        success: true,
        patients: [],
        count: 0
      });
    }

    // Fetch all patients who have visited this hospital
    const patients = await withDbRetry(async () => {
      return await prisma.patient.findMany({
        where: {
          id: { in: patientIds }
        },
        include: {
          salesPerson: {
            select: {
              name: true,
            },
          },
          insuranceType: {
            select: {
              id: true,
              name: true
            }
          },
          _count: {
            select: {
              appointments: true,
              visits: true
            }
          },
          visits: {
            select: {
              visitDate: true
            },
            orderBy: {
              visitDate: 'desc'
            },
            take: 1
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });

    // Transform the data
    const transformedPatients = patients.map((patient: any) => {
      const visitCount = patient._count.visits;
      const lastVisitDate = patient.visits && patient.visits.length > 0 
        ? new Date(patient.visits[0].visitDate) 
        : undefined;
      const patientStatus = calculatePatientStatus(visitCount, lastVisitDate);
      
      return {
        ...patient,
        salesName: patient.salesPerson?.name || "",
        noAppointmentsBooked: patient._count.appointments,
        noVisitsDone: visitCount,
        isNewPatient: patientStatus === 'new',
        isFollowUpPatient: patientStatus === 'follow-up',
        patientStatus
      };
    });

    res.status(200).json({
      success: true,
      patients: transformedPatients,
      count: transformedPatients.length
    });
  } catch (err) {
    console.error('Error fetching patients by hospital:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

export const createPatient = async (req: Request, res: Response) => {
  /* 
  request data:
    - req.body:
      - patient: new patients data
      - employeeId: Id of attached employee
      - salesPersonId: Id of sales person (required)
  */

  try {
    // Validate required fields
    if (!req.body.salesPersonId) {
      return res.status(400).json({
        success: false,
        message: 'Sales person is required. Please select a sales person for this patient.'
      });
    }

    // Verify the sales person exists and has sales role
    const salesPerson = await prisma.employee.findFirst({
      where: {
        id: req.body.salesPersonId,
        isActive: true,
        accountStatus: 'active',
        employeeRoles: {
          some: {
            role: 'sales',
            isActive: true
          }
        }
      }
    });

    if (!salesPerson) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sales person selected. Please select a valid active sales person.'
      });
    }

    // Transform the incoming patient data to match the schema
    // Helper to safely parse date
    const parseDate = (dateValue: any): Date | undefined => {
      if (!dateValue) return undefined;
      try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) {
          console.warn(`Invalid date value: ${dateValue}, skipping`);
          return undefined;
        }
        return date;
      } catch (e) {
        console.warn(`Error parsing date: ${dateValue}`, e);
        return undefined;
      }
    };

    // Get the original national ID (preserve dashes)
    const originalNationalId = req.body.nationalId || req.body.patient?.nationalId;
    
    if (!originalNationalId) {
      return res.status(400).json({
        success: false,
        message: 'National ID is required'
      });
    }

    // Normalize the national ID for duplicate checking
    const normalizedNationalId = normalizeNationalId(originalNationalId);
    
    // Check if patient already exists with normalized ID
    const existingPatient = await findPatientByNormalizedId(normalizedNationalId);
    
    if (existingPatient) {
      return res.status(400).json({
        success: false,
        message: `A patient with National ID "${originalNationalId}" (or equivalent format) already exists in the system.`,
        existingPatientId: existingPatient.id,
        existingPatientNationalId: existingPatient.nationalId
      });
    }

    const patientData: any = {
      nameEnglish: req.body.nameEnglish || req.body.patient?.nameEnglish || '',
      nameArabic: req.body.nameArabic || req.body.patient?.nameArabic || '',
      nationalId: originalNationalId, // Store original format (with dashes if provided)
      phoneNumber: req.body.phoneNumber || req.body.patient?.phoneNumber,
    };
    
    // Use relation syntax for salesPerson to avoid Prisma validation issues
    if (req.body.salesPersonId) {
      patientData.salesPerson = {
        connect: { id: req.body.salesPersonId }
      };
    }

    // Add optional fields only if they have values
    if (req.body.nationality || req.body.patient?.nationality) {
      patientData.nationality = req.body.nationality || req.body.patient?.nationality;
    }
    
    const dobValue = req.body.dob || req.body.patient?.dob;
    if (dobValue) {
      const parsedDob = parseDate(dobValue);
      if (parsedDob) {
        patientData.dob = parsedDob;
      }
    }
    
    if (req.body.gender || req.body.patient?.gender) {
      patientData.gender = req.body.gender || req.body.patient?.gender;
    }
    
    if (req.body.residencyEmirate || req.body.patient?.residencyEmirate) {
      patientData.residencyEmirate = req.body.residencyEmirate || req.body.patient?.residencyEmirate;
    }
    
    if (req.body.jobTitle || req.body.patient?.jobTitle) {
      patientData.jobTitle = req.body.jobTitle || req.body.patient?.jobTitle;
    }
    
    // Add organization field if provided
    const organizationValue = req.body.organization || req.body.patient?.organization;
    if (organizationValue && String(organizationValue).trim()) {
      patientData.organization = String(organizationValue).trim();
    }
    
    // Use relation syntax for insuranceType to avoid Prisma validation issues
    const insuranceTypeIdValue = req.body.insuranceTypeId || req.body.patient?.insuranceTypeId;
    if (insuranceTypeIdValue) {
      patientData.insuranceType = {
        connect: { id: insuranceTypeIdValue }
      };
    }
    
    if (req.body.referralSource || req.body.patient?.referralSource) {
      patientData.referralSource = req.body.referralSource || req.body.patient?.referralSource;
    }

    const newPatient = await prisma.patient.create({
      data: patientData,
      include: {
        salesPerson: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        insuranceType: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });


    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Create",
      entity_type: "Patient",
      entity_id: newPatient.id,
      status: "Successful",
      description: "New Patient Created Successfully",
    });

    // Note: Commission for new patients is now created when the patient makes their first visit
    // This ensures we only count patients who actually visit, not just those created
    // Commission logic moved to visit creation (createVisit and convertAppointmentToVisit)

    // Note: Data Entry tasks for patients created directly (not through appointments) are still created here
    // For patients created through appointments, data entry tasks are created when the appointment is completed
    // After patient creation, create Data Entry task if needed (only for directly created patients)
    try {
      const { missingFields } = getPatientMissingFields(newPatient as any);
      if (missingFields.length > 0) {
        await assignDataEntryTaskForPatient(newPatient.id, req.user?.id || salesPerson.id);
      }
    } catch (e) {
      console.warn('Data entry task assignment skipped:', (e as Error).message);
    }

    // Log successful patient creation
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_PATIENT',
      entity_id: newPatient.id,
      entity_type: 'Patient',
      status: 'Successful',
      description: `New patient "${newPatient.nameEnglish}" created successfully`
    });

    res.status(200).json({
      success: true,
      patient: newPatient,
      message: "New Patient Created Successfully with Sales Person Assignment",
    });
  } catch (err: any) {
    console.error("Patient creation error:", err);
    
    // Extract detailed Prisma error message
    let errorDetails = "Unknown error";
    if (err instanceof Error) {
      errorDetails = err.message;
      // For Prisma errors, try to extract more details
      if (err.name === 'PrismaClientValidationError' || err.message.includes('Invalid')) {
        errorDetails = err.message;
        // Try to get the full error stack for debugging
        if (err.stack) {
          console.error("Prisma validation error stack:", err.stack);
        }
      }
    } else if (typeof err === 'object' && err !== null) {
      errorDetails = JSON.stringify(err);
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Create",
      entity_type: "Patient",
      entity_id: null,
      status: "Failed",
      description: "Failed to Create New Patient: " + errorDetails,
    });

    res.status(400).json({
      error: err,
      message: "Failed to Create New Patient",
      details: errorDetails,
    });
  }
};

export const updatePatient = async (req: Request, res: Response) => {
  const patientData = req.body;
  
  try {
    // Build update data object, handling relation fields properly
    const updateData: any = { ...patientData };
    
    // Remove id from data (it's only used in where clause)
    delete updateData.id;
    
    // Handle age field - if age is provided, calculate dob from it
    if (patientData.age !== undefined && patientData.age !== null && patientData.age !== '') {
      const age = parseInt(patientData.age);
      if (!isNaN(age) && age >= 0 && age <= 150) {
        // Calculate dob from age (assuming current year minus age, using January 1st)
        const today = new Date();
        const birthYear = today.getFullYear() - age;
        
        // If dob already exists, preserve the month and day, just update the year
        if (patientData.dob) {
          try {
            const existingDob = new Date(patientData.dob);
            if (!isNaN(existingDob.getTime())) {
              existingDob.setFullYear(birthYear);
              updateData.dob = existingDob;
            } else {
              // Invalid existing dob, create new one
              updateData.dob = new Date(birthYear, 0, 1); // January 1st of birth year
            }
          } catch (e) {
            // Error parsing existing dob, create new one
            updateData.dob = new Date(birthYear, 0, 1);
          }
        } else {
          // No existing dob, create new one from age
          updateData.dob = new Date(birthYear, 0, 1); // January 1st of birth year
        }
      }
      // Remove age from updateData since it's not a database field
      delete updateData.age;
    } else {
      // If age is not provided or is empty, just remove it
      delete updateData.age;
    }
    
    // Handle salesPersonId - convert to relation format
    if (patientData.salesPersonId !== undefined) {
      // Normalize empty strings to null/undefined
      const normalizedSalesPersonId = typeof patientData.salesPersonId === 'string' 
        ? patientData.salesPersonId.trim() || null 
        : patientData.salesPersonId;
      
      if (normalizedSalesPersonId) {
        // Validate Employee exists before connecting
        const employee = await withDbRetry(async () => {
          return await prisma.employee.findUnique({
            where: { id: normalizedSalesPersonId },
            select: { id: true }
          });
        });
        
        if (!employee) {
          return res.status(400).json({
            success: false,
            error: `Sales person with ID ${normalizedSalesPersonId} not found`
          });
        }
        
        updateData.salesPerson = {
          connect: { id: normalizedSalesPersonId }
        };
      } else {
        // If salesPersonId is null/empty, disconnect the relation
        updateData.salesPerson = {
          disconnect: true
        };
      }
      delete updateData.salesPersonId;
    }
    
    // Handle insuranceTypeId - convert to relation format
    if (patientData.insuranceTypeId !== undefined) {
      if (patientData.insuranceTypeId) {
        updateData.insuranceType = {
          connect: { id: patientData.insuranceTypeId }
        };
      } else {
        updateData.insuranceType = {
          disconnect: true
        };
      }
      delete updateData.insuranceTypeId;
    }
    
    // Handle assignedHospitalId - convert to relation format
    if (patientData.assignedHospitalId !== undefined) {
      if (patientData.assignedHospitalId) {
        updateData.assignedHospital = {
          connect: { id: patientData.assignedHospitalId }
        };
      } else {
        updateData.assignedHospital = {
          disconnect: true
        };
      }
      delete updateData.assignedHospitalId;
    }
    
    // Handle referredById - convert to relation format
    if (patientData.referredById !== undefined) {
      if (patientData.referredById) {
        updateData.referredBy = {
          connect: { id: patientData.referredById }
        };
      } else {
        updateData.referredBy = {
          disconnect: true
        };
      }
      delete updateData.referredById;
    }
    
    const updatedPatient = await prisma.patient.update({
      where: { id: patientData.id },
      data: updateData,
      include: {
        salesPerson: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        _count: {
          select: {
            appointments: true,
            visits: true
          }
        }
      }
    });

    // Transform the data to include salesName, noAppointmentsBooked, and noVisitsDone
    const transformedPatient = {
      ...updatedPatient,
      salesName: updatedPatient.salesPerson?.name || '',
      noAppointmentsBooked: updatedPatient._count.appointments,
      noVisitsDone: updatedPatient._count.visits
    };


    // After update, auto-complete or update Data Entry task based on completeness
    try {
      // Check if patient was force-marked as complete
      const preferences = updatedPatient.preferences as any;
      const isForceMarkedComplete = preferences?.isDataComplete === true;
      
      // Check if patient data is actually complete (no missing fields)
      const { missingFields } = getPatientMissingFields(updatedPatient as any);
      const isActuallyComplete = missingFields.length === 0;
      
      // Complete tasks if patient is either force-marked as complete OR actually complete
      if (isForceMarkedComplete || isActuallyComplete) {
        await completeDataEntryTasksForPatient(updatedPatient.id);
      } else {
        // Patient has missing fields and is not force-marked, ensure task exists/updated
        await assignDataEntryTaskForPatient(updatedPatient.id, req.user?.id || updatedPatient.salesPerson?.id || 'system');
      }
    } catch (e) {
      console.warn('Data entry task post-update handling skipped:', (e as Error).message);
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Update",
      entity_type: "Patient",
      entity_id: updatedPatient.id,
      status: "Successful",
      description: "Patient Data Updated Successfully",
    });

    res.status(200).json({
      success: true,
      patient: transformedPatient,
      message: "Patient Data Updated Successfully",
    });
  } catch (err) {

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Update",
      entity_type: "Patient",
      entity_id: patientData.id,
      status: "Failed",
      description: "Failed to Update Patient Data: " + err,
    });

    res.status(400).json({ 
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

export const deletePatient = async (req: Request, res: Response) => {
  try {
    const patientId = req.params.id;

    // Perform a safe, manual cascade to avoid foreign key constraint errors
    await prisma.$transaction(async (tx) => {
      // Delete visit specialties connected to patient visits
      await tx.visitSpeciality.deleteMany({
        where: { visit: { patientId } }
      });

      // Delete visits for this patient
      await tx.visit.deleteMany({
        where: { patientId }
      });

      // Delete follow up tasks linked to this patient
      await tx.followUpTask.deleteMany({
        where: { patientId }
      });

      // Delete AppointmentSpeciality records for this patient's appointments first
      // (must be deleted before appointments to avoid foreign key constraint violation)
      await tx.appointmentSpeciality.deleteMany({
        where: { appointment: { patientId } }
      });

      // Delete appointments for this patient
      await tx.appointment.deleteMany({
        where: { patientId }
      });

      // Delete commissions tied to this patient
      await tx.commission.deleteMany({
        where: { patientId }
      });

      // Finally delete the patient
      await tx.patient.delete({
        where: { id: patientId }
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete",
      entity_type: "Patient",
      entity_id: patientId,
      status: "Successful",
      description: "Patient Deleted Successfully",
    });

    res.status(200).json({
      success: true,
      message: "Patient deleted successfully",
    });
  } catch (err) {
    console.error('Error deleting patient:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete",
      entity_type: "Patient",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to Delete Patient: " + err,
    });

    res.status(400).json({ 
      success: false,
      message: 'Failed to delete patient',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const deleteAllPatients = async (req: Request, res: Response) => {
  try {
    // Get total count before deletion
    const totalCount = await prisma.patient.count();

    if (totalCount === 0) {
      return res.status(200).json({
        success: true,
        message: "No patients to delete",
        deletedCount: 0
      });
    }

    // Perform a safe, manual cascade to delete all patients and related records
    await prisma.$transaction(async (tx) => {
      // Delete all nominations first (they have required visitId foreign key)
      await tx.nomination.deleteMany({});

      // Delete TransactionVisitSpeciality records first (they reference transactions and visit specialties)
      await tx.transactionVisitSpeciality.deleteMany({});

      // Delete all transactions (they reference patients)
      await tx.transaction.deleteMany({});

      // Delete all visit specialties
      await tx.visitSpeciality.deleteMany({});

      // Delete all visits (now safe since nominations are deleted)
      await tx.visit.deleteMany({});

      // Delete all follow up tasks
      await tx.followUpTask.deleteMany({});

      // Delete all AppointmentSpeciality records first
      // (must be deleted before appointments to avoid foreign key constraint violation)
      await tx.appointmentSpeciality.deleteMany({});

      // Delete all appointments
      await tx.appointment.deleteMany({});

      // Delete all commissions
      await tx.commission.deleteMany({});

      // Delete all PatientHospitalMRN records (they reference patients)
      await tx.patientHospitalMRN.deleteMany({});

      // Delete all tasks that reference patients (Data Entry tasks, etc.)
      await tx.task.deleteMany({
        where: {
          relatedEntityType: 'patient'
        }
      });

      // Finally delete all patients
      await tx.patient.deleteMany({});
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete All",
      entity_type: "Patient",
      entity_id: "all",
      status: "Successful",
      description: `All ${totalCount} patients deleted successfully`,
    });

    res.status(200).json({
      success: true,
      message: `All ${totalCount} patients deleted successfully`,
      deletedCount: totalCount
    });
  } catch (err) {
    console.error('Error deleting all patients:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete All",
      entity_type: "Patient",
      entity_id: "all",
      status: "Failed",
      description: "Failed to Delete All Patients: " + err,
    });

    res.status(400).json({ 
      success: false,
      message: 'Failed to delete all patients',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

/**
 * Process items in batches with controlled concurrency to avoid overwhelming the database connection pool
 * @param items Array of items to process
 * @param processor Async function that processes a single item
 * @param batchSize Number of items to process concurrently (default: 2)
 * @returns Array of processed results in the same order as input
 */
async function processInBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 2
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  
  return results;
}

// Find duplicate patients by normalized national ID
export const findDuplicatePatients = async (req: Request, res: Response) => {
  try {
    // Fetch all patients
    const allPatients = await prisma.patient.findMany({
      select: {
        id: true,
        nameEnglish: true,
        nameArabic: true,
        nationalId: true,
        phoneNumber: true,
        createdAt: true,
      }
    });

    // Group patients by normalized national ID
    const normalizedGroups = new Map<string, typeof allPatients>();
    
    for (const patient of allPatients) {
      if (!patient.nationalId) continue;
      
      const normalizedId = normalizeNationalId(patient.nationalId);
      if (!normalizedId) continue;

      if (!normalizedGroups.has(normalizedId)) {
        normalizedGroups.set(normalizedId, []);
      }
      normalizedGroups.get(normalizedId)!.push(patient);
    }

    // Filter to only groups with duplicates (2+ patients)
    const duplicateGroups: Array<{
      normalizedId: string;
      patients: Array<{
        id: string;
        nameEnglish: string;
        nameArabic: string;
        nationalId: string;
        phoneNumber: string;
        createdAt: Date;
        visitCount: number;
        appointmentCount: number;
        commissionCount: number;
        transactionCount: number;
        followUpTaskCount: number;
        dataEntryTaskCount: number;
        mrnCount: number;
      }>;
    }> = [];

    // Process duplicate groups sequentially to avoid connection pool exhaustion
    for (const [normalizedId, patients] of normalizedGroups.entries()) {
      if (patients.length < 2) continue; // Only groups with duplicates

      // Process patients one at a time with sequential queries to prevent connection pool exhaustion
      // Connection pool is limited (5 for Neon, 10 for generic PostgreSQL)
      // Running queries sequentially ensures we never exceed the pool limit
      const patientsWithCounts = await processInBatches(
        patients,
        async (patient) => {
          // Run count queries sequentially to avoid connection pool exhaustion
          // This ensures only 1 connection is used at a time per patient
          const visitCount = await prisma.visit.count({ where: { patientId: patient.id } });
          const appointmentCount = await prisma.appointment.count({ where: { patientId: patient.id } });
          const commissionCount = await prisma.commission.count({ where: { patientId: patient.id } });
          const transactionCount = await prisma.transaction.count({ where: { patientId: patient.id } });
          const followUpTaskCount = await prisma.followUpTask.count({ where: { patientId: patient.id } });
          const dataEntryTaskCount = await prisma.dataEntryTask.count({ where: { patientId: patient.id } });
          const mrnCount = await prisma.patientHospitalMRN.count({ where: { patientId: patient.id } });

          return {
            ...patient,
            visitCount,
            appointmentCount,
            commissionCount,
            transactionCount,
            followUpTaskCount,
            dataEntryTaskCount,
            mrnCount,
          };
        },
        1 // Process 1 patient at a time to stay within connection pool limits
      );

      duplicateGroups.push({
        normalizedId,
        patients: patientsWithCounts,
      });
    }

    res.status(200).json({
      success: true,
      duplicateGroups,
      totalGroups: duplicateGroups.length,
      totalDuplicates: duplicateGroups.reduce((sum, group) => sum + group.patients.length, 0),
    });
  } catch (err) {
    console.error('Error finding duplicate patients:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Find Duplicates",
      entity_type: "Patient",
      entity_id: null,
      status: "Failed",
      description: "Failed to find duplicate patients: " + errorMessage,
    });

    res.status(400).json({
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined,
    });
  }
};

// Merge duplicate patients into origin patient
export const mergeDuplicatePatients = async (req: Request, res: Response) => {
  try {
    const { originPatientId, duplicatePatientIds } = req.body;

    if (!originPatientId || !Array.isArray(duplicatePatientIds) || duplicatePatientIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'originPatientId and duplicatePatientIds array are required',
      });
    }

    // Validate that origin patient exists
    const originPatient = await prisma.patient.findUnique({
      where: { id: originPatientId },
    });

    if (!originPatient) {
      return res.status(404).json({
        success: false,
        error: 'Origin patient not found',
      });
    }

    // Origin cannot be in the duplicate list
    if (duplicatePatientIds.includes(originPatientId)) {
      return res.status(400).json({
        success: false,
        error: 'Origin patient cannot be in the duplicate list',
      });
    }

    // Validate that all duplicate patients exist
    const duplicatePatients = await prisma.patient.findMany({
      where: { id: { in: duplicatePatientIds } },
    });

    if (duplicatePatients.length !== duplicatePatientIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Some duplicate patients not found',
      });
    }

    // Perform merge in transaction (allows typo duplicates: different national IDs)
    const mergeResult = await prisma.$transaction(async (tx) => {
      const stats = {
        visitsUpdated: 0,
        appointmentsUpdated: 0,
        commissionsUpdated: 0,
        transactionsUpdated: 0,
        nominationsUpdated: 0,
        followUpTasksUpdated: 0,
        dataEntryTasksUpdated: 0,
        mrnsUpdated: 0,
        familyMembersUpdated: 0,
        mobileNotificationsUpdated: 0,
        scanHistoryUpdated: 0,
        assignmentHistoryUpdated: 0,
        pointsMerged: 0,
      };

      // Update all related records for each duplicate patient
      for (const duplicateId of duplicatePatientIds) {
        // Update visits
        const visitsUpdate = await tx.visit.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.visitsUpdated += visitsUpdate.count;

        // Update appointments
        const appointmentsUpdate = await tx.appointment.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.appointmentsUpdated += appointmentsUpdate.count;

        // Update commissions
        const commissionsUpdate = await tx.commission.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.commissionsUpdated += commissionsUpdate.count;

        // Update transactions
        const transactionsUpdate = await tx.transaction.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.transactionsUpdated += transactionsUpdate.count;

        // Update nominations (both convertedToPatientId and referrerId)
        const nominationsUpdate = await tx.nomination.updateMany({
          where: { convertedToPatientId: duplicateId },
          data: { convertedToPatientId: originPatientId },
        });
        stats.nominationsUpdated += nominationsUpdate.count;

        // Update referrerId in nominations
        await tx.nomination.updateMany({
          where: { referrerId: duplicateId },
          data: { referrerId: originPatientId },
        });

        // Update follow-up tasks
        const followUpTasksUpdate = await tx.followUpTask.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.followUpTasksUpdated += followUpTasksUpdate.count;

        // Update data entry tasks
        const dataEntryTasksUpdate = await tx.dataEntryTask.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.dataEntryTasksUpdated += dataEntryTasksUpdate.count;

        // Update Patient Hospital MRNs (handle conflicts by keeping both if different hospitals)
        const duplicateMrns = await tx.patientHospitalMRN.findMany({
          where: { patientId: duplicateId },
        });

        for (const mrn of duplicateMrns) {
          // Check if origin already has MRN for this hospital
          const existingMrn = await tx.patientHospitalMRN.findUnique({
            where: {
              patientId_hospitalId: {
                patientId: originPatientId,
                hospitalId: mrn.hospitalId,
              },
            },
          });

          if (existingMrn) {
            // If MRN is the same, delete duplicate; if different, keep both (update patientId)
            if (existingMrn.mrn === mrn.mrn) {
              await tx.patientHospitalMRN.delete({ where: { id: mrn.id } });
            } else {
              // Different MRN for same hospital - update to origin (may need manual review)
              await tx.patientHospitalMRN.update({
                where: { id: mrn.id },
                data: { patientId: originPatientId },
              });
              stats.mrnsUpdated += 1;
            }
          } else {
            // No existing MRN for this hospital, update to origin
            await tx.patientHospitalMRN.update({
              where: { id: mrn.id },
              data: { patientId: originPatientId },
            });
            stats.mrnsUpdated += 1;
          }
        }

        // Update family members
        const familyMembersUpdate = await tx.familyMember.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.familyMembersUpdated += familyMembersUpdate.count;

        // Update mobile notifications
        const mobileNotificationsUpdate = await tx.mobileNotification.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.mobileNotificationsUpdated += mobileNotificationsUpdate.count;

        // Update scan history
        const scanHistoryUpdate = await tx.scanRecord.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.scanHistoryUpdated += scanHistoryUpdate.count;

        // Update assignment history
        const assignmentHistoryUpdate = await tx.patientAssignmentHistory.updateMany({
          where: { patientId: duplicateId },
          data: { patientId: originPatientId },
        });
        stats.assignmentHistoryUpdated += assignmentHistoryUpdate.count;

        // Get duplicate patient to merge data
        const duplicate = duplicatePatients.find(p => p.id === duplicateId);
        if (duplicate) {
          // Merge points
          stats.pointsMerged += duplicate.points || 0;
        }
      }

      // Merge patient data - keep origin's data, fill missing from duplicates
      const updateData: any = {};
      let pointsToAdd = 0;

      for (const duplicate of duplicatePatients) {
        // Merge points
        pointsToAdd += duplicate.points || 0;

        // Fill missing fields from duplicates
        if (!originPatient.nationality && duplicate.nationality) {
          updateData.nationality = duplicate.nationality;
        }
        if (!originPatient.dob && duplicate.dob) {
          updateData.dob = duplicate.dob;
        }
        if (!originPatient.gender && duplicate.gender) {
          updateData.gender = duplicate.gender;
        }
        if (!originPatient.residencyEmirate && duplicate.residencyEmirate) {
          updateData.residencyEmirate = duplicate.residencyEmirate;
        }
        if (!originPatient.jobTitle && duplicate.jobTitle) {
          updateData.jobTitle = duplicate.jobTitle;
        }
        if (!originPatient.organization && duplicate.organization) {
          updateData.organization = duplicate.organization;
        }
        if (!originPatient.referralSource && duplicate.referralSource) {
          updateData.referralSource = duplicate.referralSource;
        }

        // Merge arrays (services, specialities) - combine unique values
        const originServices = new Set(originPatient.services || []);
        const duplicateServices = new Set(duplicate.services || []);
        const mergedServices = Array.from(new Set([...originServices, ...duplicateServices]));

        const originSpecialities = new Set(originPatient.specialities || []);
        const duplicateSpecialities = new Set(duplicate.specialities || []);
        const mergedSpecialities = Array.from(new Set([...originSpecialities, ...duplicateSpecialities]));

        if (mergedServices.length > (originPatient.services?.length || 0)) {
          updateData.services = mergedServices;
        }
        if (mergedSpecialities.length > (originPatient.specialities?.length || 0)) {
          updateData.specialities = mergedSpecialities;
        }
      }

      // Update origin patient with merged data
      if (Object.keys(updateData).length > 0 || pointsToAdd > 0) {
        const finalUpdateData = { ...updateData };
        if (pointsToAdd > 0) {
          finalUpdateData.points = { increment: pointsToAdd };
        }
        await tx.patient.update({
          where: { id: originPatientId },
          data: finalUpdateData,
        });
      }

      // Delete duplicate patients
      await tx.patient.deleteMany({
        where: { id: { in: duplicatePatientIds } },
      });

      return stats;
    });

    // Log the merge operation
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Merge Duplicates",
      entity_type: "Patient",
      entity_id: originPatientId,
      status: "Successful",
      description: `Merged ${duplicatePatientIds.length} duplicate patient(s) into origin patient ${originPatientId}`,
    });

    res.status(200).json({
      success: true,
      message: `Successfully merged ${duplicatePatientIds.length} duplicate patient(s) into origin patient`,
      originPatientId,
      mergedPatientIds: duplicatePatientIds,
      stats: mergeResult,
    });
  } catch (err) {
    console.error('Error merging duplicate patients:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Merge Duplicates",
      entity_type: "Patient",
      entity_id: req.body.originPatientId || null,
      status: "Failed",
      description: "Failed to merge duplicate patients: " + errorMessage,
    });

    res.status(400).json({
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined,
    });
  }
};

// Batch update sales person for multiple patients (admin only)
export const batchUpdateSalesPerson = async (req: Request, res: Response) => {
  try {
    const { patientIds, salesPersonId } = req.body;

    // Validate input
    if (!Array.isArray(patientIds) || patientIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'patientIds must be a non-empty array',
      });
    }

    if (!salesPersonId || typeof salesPersonId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'salesPersonId is required and must be a string',
      });
    }

    // Validate UUID format for salesPersonId
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(salesPersonId)) {
      return res.status(400).json({
        success: false,
        error: 'salesPersonId must be a valid UUID',
      });
    }

    // Validate UUID format for all patientIds
    if (!patientIds.every(id => typeof id === 'string' && uuidRegex.test(id))) {
      return res.status(400).json({
        success: false,
        error: 'All patientIds must be valid UUIDs',
      });
    }

    // Verify that the sales person exists
    const salesPerson = await withDbRetry(async () => {
      return await prisma.employee.findUnique({
        where: { id: salesPersonId },
        select: { id: true, name: true },
      });
    });

    if (!salesPerson) {
      return res.status(404).json({
        success: false,
        error: `Sales person with ID ${salesPersonId} not found`,
      });
    }

    // Update all patients in a transaction
    const result = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const updateResult = await tx.patient.updateMany({
          where: {
            id: {
              in: patientIds,
            },
          },
          data: {
            salesPersonId: salesPersonId,
          },
        });

        return updateResult;
      });
    });

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'Batch Update Sales Person',
      entity_type: 'Patient',
      entity_id: null,
      status: 'Successful',
      description: `Updated sales person for ${result.count} patient(s) to ${salesPerson.name}`,
    });

    res.status(200).json({
      success: true,
      message: `Successfully updated sales person for ${result.count} patient(s)`,
      updatedCount: result.count,
    });
  } catch (err) {
    console.error('Error in batchUpdateSalesPerson:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to batch update sales person',
      details: err instanceof Error ? err.message : undefined,
    });

    // Log the error
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'Batch Update Sales Person',
      entity_type: 'Patient',
      entity_id: null,
      status: 'Failed',
      description: `Failed to batch update sales person: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
  }
};
