import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import { withDbRetry, prisma } from "../utils/database.utils";
import { incrementTarget } from "../services/targetManagement.service";
import { deduplicateVisitsProgrammatically } from "../services/visitDeduplication.service";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import "../middleware/auth.middleware"; // Import to extend Request interface


// Cap limit to avoid heavy queries that can exhaust DB connections (e.g. Neon connection slots)
const MAX_VISIT_PAGE_LIMIT = 500;

export const getVisits = async (req: Request, res: Response) => {
  try {
    // Extract pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const requestedLimit = parseInt(req.query.limit as string) || 50;
    const limit = Math.min(requestedLimit, MAX_VISIT_PAGE_LIMIT); // Cap to avoid connection/query limits
    const skip = (page - 1) * limit;
    const search = (req.query.search as string) || '';

    // Build where clause for search
    const where: any = {};
    if (search) {
      where.OR = [
        { patient: { nameEnglish: { contains: search, mode: 'insensitive' } } },
        { patient: { nameArabic: { contains: search, mode: 'insensitive' } } },
        { patient: { nationalId: { contains: search, mode: 'insensitive' } } },
        { hospital: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Get total count for pagination
    const total = await withDbRetry(async () => {
      return await prisma.visit.count({ where });
    });

    // Fetch visits with pagination
    const visits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
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
          coordinator: {
            select: {
              id: true,
              name: true,
              role: true
            }
          },
          sales: {
            select: {
              id: true,
              name: true,
              role: true
            }
          },
          visitSpecialities: {
            select: {
              id: true,
              specialityId: true,
              doctorId: true,
              scheduledTime: true,
              status: true,
              details: true,
              doctorName: true,
              serviceTime: true,
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
          },
          appointments: {
            select: {
              id: true,
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
            take: 1
          }
        },
        orderBy: {
          visitDate: 'desc'
        },
        skip,
        take: limit
      });
    });

    // For visits without linked appointments, try to find appointments by patient and date
    const visitsWithAppointments = await Promise.all(visits.map(async (visit: any) => {
      // If visit already has appointments, use them
      if (visit.appointments && visit.appointments.length > 0) {
        return visit;
      }
      
      // Otherwise, try to find appointments for this patient on the same day
      const visitDate = new Date(visit.visitDate);
      const dayStart = new Date(visitDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(visitDate);
      dayEnd.setHours(23, 59, 59, 999);
      
      const relatedAppointments = await withDbRetry(async () => {
        return await prisma.appointment.findMany({
          where: {
            patientId: visit.patientId,
            hospitalId: visit.hospitalId,
            scheduledDate: { gte: dayStart, lte: dayEnd },
            status: { in: ['completed', 'assigned', 'scheduled'] }
          },
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
              }
            }
          },
          orderBy: { scheduledDate: 'desc' },
          take: 1
        });
      });
      
      return {
        ...visit,
        appointments: relatedAppointments
      };
    }));

    // Add badge flag to visits and include non-attended appointed specialties
    const visitsWithBadge = visitsWithAppointments.map((visit: any) => {
      // Get appointed specialty IDs from appointments
      const appointedSpecialtyIds = new Set<string>();
      if (visit.appointments && visit.appointments.length > 0) {
        for (const appointment of visit.appointments) {
          if (appointment.appointmentSpecialities) {
            appointment.appointmentSpecialities.forEach((aptSpec: any) => {
              appointedSpecialtyIds.add(aptSpec.specialityId);
            });
          }
        }
      }
      
      // Get visit specialty IDs
      const visitSpecialtyIds = new Set(visit.visitSpecialities.map((vs: any) => vs.specialityId));
      
      // Add non-attended appointed specialties
      const nonAttendedAppointedSpecialties: any[] = [];
      if (visit.appointments && visit.appointments.length > 0) {
        for (const appointment of visit.appointments) {
          if (appointment.appointmentSpecialities) {
            appointment.appointmentSpecialities.forEach((aptSpec: any) => {
              // Check if this appointed specialty was not attended (not in visit specialties)
              if (!visitSpecialtyIds.has(aptSpec.specialityId)) {
                nonAttendedAppointedSpecialties.push({
                  id: `not-attended-${aptSpec.id}`,
                  specialityId: aptSpec.specialityId,
                  speciality: aptSpec.speciality,
                  doctorId: aptSpec.doctorId,
                  doctor: aptSpec.doctor,
                  scheduledTime: aptSpec.scheduledTime,
                  status: 'not_attended',
                  isAppointed: true,
                  isAdded: false,
                  notAttended: true,
                  details: 'Appointed but not attended'
                });
              }
            });
          }
        }
      }
      
      // Combine attended visit specialties with non-attended appointed specialties
      const allSpecialties = [...visit.visitSpecialities, ...nonAttendedAppointedSpecialties];
      
      // Determine if badge should be shown
      let didntAttendAppointed = false;
      if (appointedSpecialtyIds.size > 0 && visit.visitSpecialities.length > 0) {
        // Check if any visit specialty matches an appointed specialty
        const hasMatchingAppointedSpecialty = Array.from(appointedSpecialtyIds).some(
          (appointedId) => visitSpecialtyIds.has(appointedId)
        );
        
        // Badge should show if none of the visit specialties match the appointed ones
        didntAttendAppointed = !hasMatchingAppointedSpecialty;
      }
      
      return {
        ...visit,
        visitSpecialities: allSpecialties,
        didntAttendAppointed
      };
    });

    res.status(200).json({
      success: true,
      data: visitsWithBadge,
      count: visitsWithBadge.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching visits:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch visits',
      error: err
    });
  }
};

export const getVisitById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const visit = await withDbRetry(async () => {
      return await prisma.visit.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            nameArabic: true,
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
        coordinator: {
          select: {
            id: true,
            name: true,
            role: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            role: true
          }
        },
        visitSpecialities: {
          select: {
            id: true,
            specialityId: true,
            doctorId: true,
            scheduledTime: true,
            status: true,
            details: true,
            doctorName: true,
            serviceTime: true,
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
      }
    });
    });

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found'
      });
    }

    res.status(200).json({
      success: true,
      data: visit
    });
  } catch (err) {
    console.error('Error fetching visit:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch visit',
      error: err
    });
  }
};

export const getVisitsByPatient = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;
    
    const visits = await prisma.visit.findMany({
      where: { patientId },
      include: {
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            nameArabic: true,
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
        coordinator: {
          select: {
            id: true,
            name: true,
            role: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            role: true
          }
        },
        visitSpecialities: {
          select: {
            id: true,
            specialityId: true,
            doctorId: true,
            scheduledTime: true,
            status: true,
            details: true,
            doctorName: true,
            serviceTime: true,
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
        visitDate: 'desc'
      }
    });

    res.status(200).json({
      success: true,
      data: visits,
      count: visits.length
    });
  } catch (err) {
    console.error('Error fetching patient visits:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch patient visits',
      error: err
    });
  }
};

export const getVisitsByHospital = async (req: Request, res: Response) => {
  try {
    const { hospitalId } = req.params;
    
    const visits = await prisma.visit.findMany({
      where: { hospitalId },
      include: {
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            nameArabic: true,
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
        coordinator: {
          select: {
            id: true,
            name: true,
            role: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            role: true
          }
        },
        visitSpecialities: {
          select: {
            id: true,
            specialityId: true,
            doctorId: true,
            scheduledTime: true,
            status: true,
            details: true,
            doctorName: true,
            serviceTime: true,
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
        visitDate: 'desc'
      }
    });

    res.status(200).json({
      success: true,
      data: visits,
      count: visits.length
    });
  } catch (err) {
    console.error('Error fetching hospital visits:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hospital visits',
      error: err
    });
  }
};

export const getVisitByFilter = async (req: Request, res: Response) => {
  try {
    const { filterName } = req.params;
    const filterRequestData = req.body;
    const { filterData } = filterRequestData;
    
    const visits = await prisma.visit.findMany({
      where: {
        [filterName]: filterData,
      },
      include: {
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            nameArabic: true,
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
        coordinator: {
          select: {
            id: true,
            name: true,
            role: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            role: true
          }
        },
        visitSpecialities: {
          select: {
            id: true,
            specialityId: true,
            doctorId: true,
            scheduledTime: true,
            status: true,
            details: true,
            doctorName: true,
            serviceTime: true,
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
        visitDate: 'desc'
      }
    });

    res.status(200).json({
      success: true,
      data: visits,
      count: visits.length
    });
  } catch (err) {
    console.error('Error fetching visits by filter:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch visits',
      error: err
    });
  }
};

// Generate hospital report for a specific month/year
export const generateHospitalReport = async (req: Request, res: Response) => {
  try {
    const { hospitalId } = req.params;
    const { month, year } = req.query;

    if (!hospitalId || !month || !year) {
      return res.status(400).json({
        success: false,
        error: 'Hospital ID, month, and year are required'
      });
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthIndex = monthNames.indexOf(month as string);
    const yearNum = parseInt(year as string);

    if (monthIndex === -1 || isNaN(yearNum)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid month or year'
      });
    }

    // Use UTC dates to prevent timezone shifts
    const startDate = new Date(Date.UTC(yearNum, monthIndex, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(yearNum, monthIndex + 1, 1, 0, 0, 0, 0));

    // Fetch visits for this hospital in the selected month
    const visits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: {
          hospitalId,
          visitDate: {
            gte: startDate,
            lt: endDate
          }
        },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
              phoneNumber: true,
              insuranceType: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: {
          visitDate: 'asc'
        }
      });
    });

    if (visits.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        count: 0
      });
    }

    // Get unique patients and their first visit in the month
    const uniquePatients = new Map<string, {
      patientId: string;
      firstVisitInMonth: any;
      patient: any;
    }>();

    visits.forEach((visit: any) => {
      const patientId = visit.patientId;
      if (!uniquePatients.has(patientId)) {
        uniquePatients.set(patientId, {
          patientId,
          firstVisitInMonth: visit,
          patient: visit.patient
        });
      }
    });

    // Get all patient IDs for batch checking first visits
    const patientIds = Array.from(uniquePatients.keys());

    // Batch fetch all visits for these patients to check first visit ever status
    const allPatientVisits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: {
          patientId: { in: patientIds }
        },
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

    // Group visits by patient
    const visitsByPatient = new Map<string, typeof allPatientVisits>();
    allPatientVisits.forEach((visit: any) => {
      if (!visitsByPatient.has(visit.patientId)) {
        visitsByPatient.set(visit.patientId, []);
      }
      visitsByPatient.get(visit.patientId)!.push(visit);
    });

    // Get MRNs for these patients at this hospital
    const mrns = await withDbRetry(async () => {
      return await prisma.patientHospitalMRN.findMany({
        where: {
          patientId: { in: patientIds },
          hospitalId
        },
        select: {
          patientId: true,
          mrn: true
        }
      });
    });

    const mrnMap = new Map<string, string>();
    mrns.forEach((mrn: { patientId: string; mrn: string }) => {
      mrnMap.set(mrn.patientId, mrn.mrn);
    });

    // Process each patient to determine type
    const reportData = Array.from(uniquePatients.values()).map(({ patientId, firstVisitInMonth, patient }) => {
      const firstVisitCreatedAt = new Date(firstVisitInMonth.createdAt);
      
      // Get all visits for this patient
      const patientAllVisits = visitsByPatient.get(patientId) || [];
      
      // Check if first visit ever
      const previousVisits = patientAllVisits.filter(
        (v: any) => v.id !== firstVisitInMonth.id &&
             new Date(v.createdAt).getTime() < firstVisitCreatedAt.getTime()
      );
      const isFirstVisitEver = previousVisits.length === 0;

      // Check if first visit to this hospital
      const previousVisitsToHospital = patientAllVisits.filter(
        (v: any) => v.id !== firstVisitInMonth.id &&
             v.hospitalId === hospitalId &&
             new Date(v.createdAt).getTime() < firstVisitCreatedAt.getTime()
      );
      const isFirstVisitToHospital = previousVisitsToHospital.length === 0;

      // Classify patient type
      const patientType: 'new' | 'follow-up' = 
        (isFirstVisitEver || isFirstVisitToHospital) ? 'new' : 'follow-up';

      const insuranceType = patient.insuranceType?.name || 
                           (typeof patient.insuranceType === 'string' ? patient.insuranceType : 'N/A');

      return {
        id: patientId,
        patientName: patient.nameEnglish || 'Unknown Patient',
        firstVisitDate: firstVisitInMonth.visitDate.toISOString(),
        patientPhone: patient.phoneNumber || 'N/A',
        patientNationalId: patient.nationalId || 'N/A',
        insuranceType: insuranceType,
        mrnNumber: mrnMap.get(patientId) || 'N/A',
        patientType
      };
    });

    // Sort by first visit date
    reportData.sort((a, b) => 
      new Date(a.firstVisitDate).getTime() - new Date(b.firstVisitDate).getTime()
    );

    res.status(200).json({
      success: true,
      data: reportData,
      count: reportData.length
    });
  } catch (err) {
    console.error('Error generating hospital report:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to generate report',
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
};

export const createVisit = async (req: Request, res: Response) => {
  try {
    const visitData = req.body;
    const { visit, specialties, coordinatorId, salesId, appointmentId } = visitData;
    

    // Validate required fields
    if (!visit.patientId || !visit.hospitalId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: patientId, hospitalId'
      });
    }

    // Find existing employees for coordinator and sales roles
    let actualCoordinatorId = coordinatorId;
    let actualSalesId = salesId;

    if (coordinatorId && coordinatorId !== 'default-coordinator-id') {
      const coordinator = await prisma.employee.findFirst({
        where: { 
          id: coordinatorId,
          employeeRoles: {
            some: { role: 'coordinator', isActive: true }
          }
        }
      });
      if (!coordinator) {
        // Find any active coordinator
        const anyCoordinator = await prisma.employee.findFirst({
          where: { 
            employeeRoles: {
              some: { role: 'coordinator', isActive: true }
            }
          }
        });
        actualCoordinatorId = anyCoordinator?.id || null;
      }
    } else {
      // Find any active coordinator
      const anyCoordinator = await prisma.employee.findFirst({
        where: { 
          employeeRoles: {
            some: { role: 'coordinator', isActive: true }
          }
        }
      });
      actualCoordinatorId = anyCoordinator?.id || null;
    }

    if (salesId && salesId !== 'default-sales-id') {
      const sales = await prisma.employee.findFirst({
        where: { 
          id: salesId,
          employeeRoles: {
            some: { role: 'sales', isActive: true }
          }
        }
      });
      if (!sales) {
        // Find any active sales person
        const anySales = await prisma.employee.findFirst({
          where: { 
            employeeRoles: {
              some: { role: 'sales', isActive: true }
            }
          }
        });
        actualSalesId = anySales?.id || null;
      }
    } else {
      // Find any active sales person
      const anySales = await prisma.employee.findFirst({
        where: { 
          employeeRoles: {
            some: { role: 'sales', isActive: true }
          }
        }
      });
      actualSalesId = anySales?.id || null;
    }

    // If we still don't have valid IDs, we need to handle this gracefully
    if (!actualCoordinatorId || !actualSalesId) {
      return res.status(400).json({
        success: false,
        message: 'No valid coordinator or sales person found. Please ensure there are active employees with coordinator and sales roles.'
      });
    }

    // Check for duplicate visit (same patient, hospital, and date)
    const visitDate = new Date(visit.visitDate);
    const visitDateStart = new Date(visitDate);
    visitDateStart.setHours(0, 0, 0, 0);
    const visitDateEnd = new Date(visitDateStart);
    visitDateEnd.setHours(23, 59, 59, 999);

    const existingVisit = await prisma.visit.findFirst({
      where: {
        patientId: visit.patientId,
        hospitalId: visit.hospitalId,
        visitDate: {
          gte: visitDateStart,
          lte: visitDateEnd,
        },
      },
      select: { id: true },
    });

    if (existingVisit) {
      // Check if this is an import context (indicated by a flag in the request)
      const isImportContext = visitData.skipDuplicates === true;
      
      if (isImportContext) {
        // For import context, return success but indicate duplicate was skipped
        return res.status(200).json({
          success: true,
          message: 'Duplicate visit skipped',
          data: { id: existingVisit.id },
          skipped: true
        });
      } else {
        // For regular creation, automatically merge into existing visit
        // Fetch the existing visit with its specialties
        const existingVisitWithDetails = await prisma.visit.findUnique({
          where: { id: existingVisit.id },
          include: {
            visitSpecialities: true
          }
        });

        if (!existingVisitWithDetails) {
          return res.status(404).json({
            success: false,
            message: 'Existing visit not found'
          });
        }

        // Merge new specialties into existing visit
        const mergedResult = await prisma.$transaction(async (tx: any) => {
          let mergedSpecialties: any[] = [];
          
          // If new specialties are provided, merge them
          if (specialties && specialties.length > 0) {
            // Find or create a default doctor for the specialty
            let defaultDoctor = await tx.doctor.findFirst({
              where: { name: 'Default Doctor' }
            });

            if (!defaultDoctor) {
              defaultDoctor = await tx.doctor.create({
                data: {
                  name: 'Default Doctor',
                  hospital: {
                    connect: {
                      id: visit.hospitalId
                    }
                  }
                }
              });
            }

            // Get existing specialties to check for duplicates
            const existingSpecialtyKeys = new Set<string>();
            existingVisitWithDetails.visitSpecialities.forEach((spec: any) => {
              const scheduledTime = new Date(spec.scheduledTime);
              const timeMinutes = scheduledTime.getUTCHours() * 60 + scheduledTime.getUTCMinutes();
              const key = `${spec.specialityId}-${spec.doctorId}-${timeMinutes}`;
              existingSpecialtyKeys.add(key);
            });

            // Create only new specialties that don't already exist
            for (const specialty of specialties) {
              const scheduledTime = new Date(specialty.scheduledTime || new Date());
              const timeMinutes = scheduledTime.getUTCHours() * 60 + scheduledTime.getUTCMinutes();
              const key = `${specialty.specialityId}-${defaultDoctor.id}-${timeMinutes}`;

              if (!existingSpecialtyKeys.has(key)) {
                const newSpecialty = await tx.visitSpeciality.create({
                  data: {
                    visitId: existingVisit.id,
                    specialityId: specialty.specialityId,
                    doctorId: defaultDoctor.id,
                    scheduledTime: scheduledTime,
                    status: specialty.status || 'scheduled',
                    details: specialty.details || '',
                    doctorName: specialty.doctorName || '',
                    serviceTime: specialty.serviceTime ? new Date(specialty.serviceTime) : null
                  }
                });
                mergedSpecialties.push(newSpecialty);
                existingSpecialtyKeys.add(key);
              }
            }
          }

          return {
            visit: existingVisitWithDetails,
            specialties: mergedSpecialties
          };
        }, {
          timeout: 10000
        });

        // Log the merge operation
        log({
          user_id: req.user?.id || 'system',
          user_name: req.user?.name || 'System',
          action: "Merge",
          entity_type: "Visit",
          entity_id: existingVisit.id,
          status: "Successful",
          description: `Visit merged automatically: ${mergedResult.specialties.length} new specialties added to existing visit`,
        });

        return res.status(200).json({
          success: true,
          message: 'Visit merged with existing visit',
          data: {
            visit: mergedResult.visit,
            specialties: mergedResult.specialties,
            commissions: [],
            merged: true
          }
        });
      }
    }

    // Store target increments to process after transaction
    const targetIncrements: Array<{ category: 'new_patients' | 'nominations'; actorId: string; date: Date }> = [];

    // Create the visit with specialties in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Create the main visit
      let newVisit = await tx.visit.create({
        data: {
          patientId: visit.patientId,
          hospitalId: visit.hospitalId,
          coordinatorId: actualCoordinatorId,
          salesId: actualSalesId,
          visitDate: new Date(visit.visitDate),
          isEmergency: visit.isEmergency || false
        }
      });

      let visitSpecialties: any[] = [];
      let commissions: any[] = [];

      // Create visit specialties if provided
      if (specialties && specialties.length > 0) {
        // Find or create a default doctor for the specialty
        let defaultDoctor = await tx.doctor.findFirst({
          where: { name: 'Default Doctor' }
        });

        if (!defaultDoctor) {
        defaultDoctor = await tx.doctor.create({
          data: {
            name: 'Default Doctor',
            hospital: {
              connect: {
                id: visit.hospitalId
              }
            }
          }
        });
        }

        // Create specialties with medical service details
        visitSpecialties = await Promise.all(
          specialties.map((specialty: any) =>
            tx.visitSpeciality.create({
              data: {
                visitId: newVisit.id,
                specialityId: specialty.specialityId,
                doctorId: defaultDoctor.id, // Use the default doctor ID
                scheduledTime: new Date(specialty.scheduledTime || new Date()),
                status: specialty.status || 'scheduled',
                
                // Medical service details
                details: specialty.details || '',
                doctorName: specialty.doctorName || '',
                serviceTime: specialty.serviceTime ? (() => {
                  // Handle time string like "2:30 PM" by creating a valid date
                  if (typeof specialty.serviceTime === 'string' && !specialty.serviceTime.includes('T')) {
                    // If it's just a time string, combine with today's date
                    const today = new Date();
                    const [time, period] = specialty.serviceTime.split(' ');
                    const [hours, minutes] = time.split(':');
                    let hour24 = parseInt(hours);
                    if (period === 'PM' && hour24 !== 12) hour24 += 12;
                    if (period === 'AM' && hour24 === 12) hour24 = 0;
                    today.setHours(hour24, parseInt(minutes), 0, 0);
                    return today;
                  }
                  // If it's already a valid ISO string, use it
                  return new Date(specialty.serviceTime);
                })() : null
              }
            })
          )
        );

        // Filter specialties by type: only "added" specialties should get commissions
        // The frontend now sends a "type" field: "added" or "appointed"
        const addedVisitSpecialties = visitSpecialties.filter((vs: any, index: number) => {
          const specialty = specialties[index];
          // Default to "added" if type is not specified (backward compatibility)
          return (specialty?.type === 'added' || !specialty?.type);
        });

        // Create commission records only for "added" specialties
        commissions = await Promise.all(
          addedVisitSpecialties.map((visitSpecialty: any) =>
            tx.commission.create({
              data: {
                employeeId: actualCoordinatorId,
                amount: 1,
                type: 'VISIT_SPECIALITY_ADDITION',
                description: `Added speciality ${visitSpecialty.specialityId} during visit ${newVisit.id}`,
                patientId: visit.patientId,
                visitSpecialityId: visitSpecialty.id,
                period: new Date().toISOString().split('T')[0]
              }
            })
          )
        );

        // Update coordinator's commission count accordingly
        if (addedVisitSpecialties.length > 0) {
          await tx.employee.update({
            where: { id: actualCoordinatorId },
            data: {
              commissions: {
                increment: addedVisitSpecialties.length
              }
            }
          });
        }

        // Mark the reference appointment as completed when visit is created (if appointmentId is provided)
        if (appointmentId) {
          const referenceAppointment = await tx.appointment.findFirst({
            where: {
              id: appointmentId,
              patientId: visit.patientId,
              status: { in: ['scheduled', 'assigned', 'completed'] }
            },
            select: {
              id: true,
              patientId: true,
              status: true,
              isNewPatientAtCreation: true,
              createdById: true,
              salesPersonId: true,
            }
          });

          if (referenceAppointment) {
            await tx.appointment.update({
              where: { id: appointmentId },
              data: { status: 'completed' }
            });
            
            // After appointment is completed, create data entry task if needed for new patients
            // This is for new patients created through appointments - only create task after appointment is completed
            if (referenceAppointment.isNewPatientAtCreation) {
              try {
                const { assignDataEntryTaskForPatient, getPatientMissingFields } = await import('../services/taskAutomation.service');
                const patient = await tx.patient.findUnique({
                  where: { id: visit.patientId },
                });
                
                if (patient) {
                  const { missingFields } = getPatientMissingFields(patient);
                  if (missingFields.length > 0) {
                    const createdById = referenceAppointment.createdById || referenceAppointment.salesPersonId || 'system';
                    await assignDataEntryTaskForPatient(patient.id, createdById, null);
                    console.log(`Created data entry task for patient ${patient.id} after appointment ${appointmentId} was completed via visit creation`);
                  }
                }
              } catch (e) {
                console.warn(`Data entry task assignment skipped for appointment ${appointmentId}:`, (e as Error).message);
              }
            }
          }
        }

        // New patient commission logic: Only create commission when patient makes first visit
        // OR when existing patient visits a new hospital for the first time
        try {
          // Get patient with sales person info
          const patient = await tx.patient.findUnique({
            where: { id: visit.patientId },
            select: {
              id: true,
              nameEnglish: true,
              salesPersonId: true
            }
          });

          if (patient && patient.salesPersonId) {
            // Check if visit has specialties (skip legacy visits with no specialties)
            const visitSpecialtiesCount = visitSpecialties.length;

            // Only create commission if visit has specialties (skip legacy visits)
            if (visitSpecialtiesCount === 0) {
              // Skip legacy visits without specialties - don't create commission
              // Continue to next part of transaction
            } else {

            // Check if patient has any previous visits (to any hospital)
            // Include legacy visits when determining if this is "first visit"
            // But only create commission if current visit has specialties
            const previousVisits = await tx.visit.findMany({
              where: {
                patientId: visit.patientId,
                id: { not: newVisit.id } // Exclude current visit
              },
              select: { id: true, hospitalId: true },
              take: 1 // We only need to know if any exist
            });

            let shouldCreateCommission = false;

            if (previousVisits.length === 0) {
              // No previous visits at all - this is the patient's first visit ever
              // Only create commission if this visit has specialties
              shouldCreateCommission = true;
            } else {
              // Patient has previous visits - check if this is first visit to THIS hospital
              const visitsToThisHospital = await tx.visit.findFirst({
                where: {
                  patientId: visit.patientId,
                  hospitalId: visit.hospitalId,
                  id: { not: newVisit.id } // Exclude current visit
                },
                select: { id: true }
              });

              if (!visitsToThisHospital) {
                // First visit to this hospital (regardless of whether previous visits had specialties)
                // Only create commission if this visit has specialties
                shouldCreateCommission = true;
              }
            }

            if (shouldCreateCommission) {
              // Create PATIENT_CREATION commission for the sales person
              // Use visit date for commission period, not current date
              const visitDate = new Date(newVisit.visitDate);
              const commissionDate = visitDate.toISOString().split('T')[0];
              const newPatientCommission = await tx.commission.create({
                data: {
                  employeeId: patient.salesPersonId,
                  amount: 1,
                  type: 'PATIENT_CREATION',
                  period: commissionDate,
                  description: `Patient creation commission for ${patient.nameEnglish || 'Patient'} (first visit${previousVisits.length === 0 ? '' : ' to new hospital'})`,
                  patientId: patient.id
                }
              });

              // Increment commission count for the sales person
              await tx.employee.update({
                where: { id: patient.salesPersonId },
                data: {
                  commissions: {
                    increment: 1
                  }
                }
              });

              // Store commission info for target increment after transaction
              // incrementTarget uses its own transaction, so it must be called after this transaction commits
              targetIncrements.push({
                category: 'new_patients',
                actorId: patient.salesPersonId,
                date: visitDate
              });

              // Add to commissions array for return
              commissions.push(newPatientCommission);
            }
            }
          }
        } catch (e) {
          console.warn('New patient commission handling skipped:', (e as Error).message);
          // Don't fail the visit creation if commission logic fails
        }

        // NOMINATION_CONVERSION commission logic: Only create when converted patient makes first visit
        try {
          // Check if this patient was converted from a nomination
          const nomination = await tx.nomination.findFirst({
            where: {
              convertedToPatientId: visit.patientId
            },
            select: {
              id: true,
              coordinatorId: true,
              nominatedPatientName: true
            }
          });

          if (nomination && nomination.coordinatorId) {
            // Check if this is the patient's first visit (same logic as PATIENT_CREATION)
            const previousVisits = await tx.visit.findMany({
              where: {
                patientId: visit.patientId,
                id: { not: newVisit.id } // Exclude current visit
              },
              select: { id: true },
              take: 1 // We only need to know if any exist
            });

            // Only create commission if this is the first visit (no previous visits)
            if (previousVisits.length === 0) {
              // Check if NOMINATION_CONVERSION commission already exists for this patient
              const existingCommission = await tx.commission.findFirst({
                where: {
                  patientId: visit.patientId,
                  type: 'NOMINATION_CONVERSION'
                }
              });

              if (!existingCommission) {
                // Create NOMINATION_CONVERSION commission for the coordinator
                const commissionDate = new Date().toISOString().split('T')[0];
                const nominationCommission = await tx.commission.create({
                  data: {
                    employeeId: nomination.coordinatorId,
                    amount: 1,
                    type: 'NOMINATION_CONVERSION',
                    period: commissionDate,
                    description: `Nomination conversion commission for ${nomination.nominatedPatientName} (first visit)`,
                    patientId: visit.patientId
                  }
                });

                // Increment commission count for the coordinator
                await tx.employee.update({
                  where: { id: nomination.coordinatorId },
                  data: {
                    commissions: {
                      increment: 1
                    }
                  }
                });

                // Store target increment for after transaction
                const visitDate = new Date(newVisit.visitDate);
                targetIncrements.push({
                  category: 'nominations',
                  actorId: nomination.coordinatorId,
                  date: visitDate
                });

                // Add to commissions array for return
                commissions.push(nominationCommission);
              }
            }
          }
        } catch (e) {
          console.warn('Nomination conversion commission handling skipped:', (e as Error).message);
          // Don't fail the visit creation if commission logic fails
        }
      }

      return { visit: newVisit, specialties: visitSpecialties, commissions };
    }, {
      timeout: 10000, // 10 seconds timeout
    });

    // Process target increments after transaction commits
    // This ensures targets are updated even if the transaction succeeded
    for (const increment of targetIncrements) {
      try {
        await incrementTarget({
          category: increment.category,
          actorId: increment.actorId,
          date: increment.date
        });
      } catch (e) {
        console.error(`Target increment (${increment.category}) failed for employee ${increment.actorId}:`, (e as Error).message);
        // Log but don't fail the request - commission was created successfully
      }
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Create",
      entity_type: "Visit",
      entity_id: result.visit.id,
      status: "Successful",
      description: "Visit Created Successfully",
    });

    res.status(201).json({
      success: true,
      data: result,
      message: `Visit created successfully with ${result.specialties.length} specialties and ${result.commissions.length} commission records`
    });
  } catch (err) {
    console.error('Error creating visit:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Create",
      entity_type: "Visit",
      entity_id: null,
      status: "Failed",
      description: "Failed to Create Visit: " + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to create visit',
      error: err
    });
  }
};

export const updateVisit = async (req: Request, res: Response) => {
  const updateData = req.body;
  try {
    const { id } = req.params;
    const { visit, specialties, coordinatorId, salesId } = updateData;

    // Validate visit exists
    const existingVisit = await prisma.visit.findUnique({
      where: { id }
    });

    if (!existingVisit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found'
      });
    }

    // Update visit and specialties in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Update the main visit
      const updatedVisit = await tx.visit.update({
        where: { id },
        data: {
          ...(visit.patientId && { patientId: visit.patientId }),
          ...(visit.hospitalId && { hospitalId: visit.hospitalId }),
          ...(coordinatorId && { coordinatorId: coordinatorId }),
          ...(salesId && { salesId: salesId }),
          ...(visit.visitDate && { visitDate: new Date(visit.visitDate) }),
          ...(visit.isEmergency !== undefined && { isEmergency: visit.isEmergency })
        }
      });

      // Handle specialties if provided
      if (specialties) {
        // Delete existing specialties
        await tx.visitSpeciality.deleteMany({
          where: { visitId: id }
        });

        // Create new specialties
        if (specialties.length > 0) {
          await Promise.all(
            specialties.map((specialty: any) =>
              tx.visitSpeciality.create({
                data: {
                  visitId: id,
                  specialityId: specialty.specialityId,
                  doctorId: specialty.doctorId,
                  scheduledTime: new Date(specialty.scheduledTime),
                  status: specialty.status || 'scheduled',
                  
                  // Medical service details
                  details: specialty.details || '',
                  doctorName: specialty.doctorName || '',
                  serviceTime: specialty.serviceTime ? (() => {
                    // Handle time string like "2:30 PM" by creating a valid date
                    if (typeof specialty.serviceTime === 'string' && !specialty.serviceTime.includes('T')) {
                      // If it's just a time string, combine with today's date
                      const today = new Date();
                      const [time, period] = specialty.serviceTime.split(' ');
                      const [hours, minutes] = time.split(':');
                      let hour24 = parseInt(hours);
                      if (period === 'PM' && hour24 !== 12) hour24 += 12;
                      if (period === 'AM' && hour24 === 12) hour24 = 0;
                      today.setHours(hour24, parseInt(minutes), 0, 0);
                      return today;
                    }
                    // If it's already a valid ISO string, use it
                    return new Date(specialty.serviceTime);
                  })() : null
                }
              })
            )
          );
        }
      }

      return updatedVisit;
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Update",
      entity_type: "Visit",
      entity_id: result.id,
      status: "Successful",
      description: "Visit Data Updated Successfully",
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Visit updated successfully'
    });
  } catch (err) {
    console.error('Error updating visit:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Update",
      entity_type: "Visit",
      entity_id: updateData.visit.id,
      status: "Failed",
      description: "Failed to Update Visit Data: " + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to update visit',
      error: err
    });
  }
};

export const deleteVisit = async (req: Request, res: Response) => {
  try {
    const visitId = req.params.id;

    // Start a transaction to delete visit and related data
    await prisma.$transaction(async (tx: any) => {
      // Delete visit specialties first (due to foreign key constraints)
      await tx.visitSpeciality.deleteMany({
        where: { visitId: visitId },
      });

      // Delete the visit
      await tx.visit.delete({
        where: { id: visitId },
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete",
      entity_type: "Visit",
      entity_id: visitId,
      status: "Successful",
      description: "Visit Deleted Successfully",
    });

    res.status(200).json({
      success: true,
      message: "Visit deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting visit:", err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete",
      entity_type: "Visit",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to Delete Visit: " + err,
    });

    res.status(500).json({
      success: false,
      message: "Failed to delete visit",
      error: err,
    });
  }
};

export const deduplicateVisits = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Use the service function for deduplication
    const result = await deduplicateVisitsProgrammatically({
      userId: userId,
      userName: req.user?.name || 'System'
    });

    // Log the deduplication operation
    log({
      user_id: userId,
      user_name: req.user?.name || 'System',
      action: "Deduplicate",
      entity_type: "Visit",
      entity_id: null,
      status: "Successful",
      description: `Merged duplicate visits: ${result.visitsDeleted} duplicates merged, ${result.visitsKept} visits kept, ${result.specialtiesMerged} specialties merged`,
    });

    res.status(200).json({
      success: true,
      message: `Visit merge completed successfully`,
      data: result
    });
  } catch (err) {
    console.error("Error merging duplicate visits:", err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Deduplicate",
      entity_type: "Visit",
      entity_id: null,
      status: "Failed",
      description: "Failed to merge duplicate visits: " + (err instanceof Error ? err.message : String(err)),
    });

    res.status(500).json({
      success: false,
      message: "Failed to merge duplicate visits",
      error: err instanceof Error ? err.message : String(err)
    });
  }
};

// --- File-based Log Reading Functions ---

// Parse a single log line from the file-based logger
const parseLogLine = (line: string) => {
  const parts = line.split('\t');
  if (parts.length < 10) return null;
  
  const date = parts[0] || '';
  const time = parts[1] || '';
  const userId = parts[2] || '';
  const sessionId = parts[3] || '';
  const userName = parts[4] || '';
  const action = parts[5] || '';
  const entityId = parts[6] || null;
  const entityType = parts[7] || '';
  const status = (parts[8] as 'Successful' | 'Failed') || 'Successful';
  const description = parts[9] || '';
  
  // Create a proper ISO timestamp for date comparison
  // Format: YYYY-MM-DDTHH:mm:ss.000Z
  const timestamp = `${date}T${time}.000Z`;
  
  // Format date and time from log file
  const dateStr = date; // Already in YYYY-MM-DD format
  const timeStr = time; // Already in HH:mm:ss format
  
  // Format action for better display
  const formatAction = (action: string) => {
    const actionMap: Record<string, string> = {
      'CREATE_VISIT': 'Created Visit',
      'UPDATE_VISIT': 'Updated Visit',
      'DELETE_VISIT': 'Deleted Visit',
      'CREATE_PATIENT': 'Created Patient',
      'UPDATE_PATIENT': 'Updated Patient',
      'DELETE_PATIENT': 'Deleted Patient',
      'CREATE_EMPLOYEE': 'Created Employee',
      'UPDATE_EMPLOYEE': 'Updated Employee',
      'DELETE_EMPLOYEE': 'Deleted Employee',
      'LOGIN': 'Logged In',
      'LOGOUT': 'Logged Out'
    };
    return actionMap[action] || action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  };
  
  // Format entity type for better display
  const formatEntityType = (entityType: string) => {
    const entityMap: Record<string, string> = {
      'VISIT': 'Visit',
      'PATIENT': 'Patient',
      'EMPLOYEE': 'Employee',
      'HOSPITAL': 'Hospital',
      'APPOINTMENT': 'Appointment',
      'TASK': 'Task',
      'TARGET': 'Target'
    };
    return entityMap[entityType] || entityType;
  };
  
  // Format description for better display
  const formatDescription = (desc: string, action: string, entityType: string, entityId: string | null) => {
    if (desc && desc.trim()) {
      return desc;
    }
    
    // Generate user-friendly description based on action and entity
    const entityName = entityId ? ` (ID: ${entityId})` : '';
    const actionLower = action.toLowerCase();
    
    if (actionLower.includes('create')) {
      return `New ${formatEntityType(entityType)} was created${entityName}`;
    } else if (actionLower.includes('update')) {
      return `${formatEntityType(entityType)} was updated${entityName}`;
    } else if (actionLower.includes('delete')) {
      return `${formatEntityType(entityType)} was deleted${entityName}`;
    } else if (actionLower.includes('login')) {
      return `User logged into the system`;
    } else if (actionLower.includes('logout')) {
      return `User logged out of the system`;
    }
    
    return `${formatAction(action)} performed on ${formatEntityType(entityType)}${entityName}`;
  };
  
  return {
    id: parts[1] || `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: timestamp,
    date: dateStr,
    time: timeStr,
    userId: userId,
    userName: userName || 'Unknown User',
    action: formatAction(action),
    entityId: entityId,
    entityType: formatEntityType(entityType),
    status: status,
    description: formatDescription(description, action, entityType, entityId)
  };
};
