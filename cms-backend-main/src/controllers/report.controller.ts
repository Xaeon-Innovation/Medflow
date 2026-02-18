import { Request, Response } from 'express';
import { prisma, withDbRetry } from '../utils/database.utils';
import { getVisitAppointmentTypeById } from '../utils/appointment.utils';
import { getDubaiRangeFromStrings } from '../utils/date.utils';

/**
 * Get grand total statistics aggregated across all hospitals
 */
export const getReportsSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const startDateStr = req.query.startDate as string | undefined;
    const endDateStr = req.query.endDate as string | undefined;

    // Use shared Dubai timezone date utilities
    const dateRange = getDubaiRangeFromStrings(startDateStr, endDateStr);

    // Build date filters using Dubai UTC ranges
    const visitDateFilter: any = {};
    const appointmentDateFilter: any = {}; // Will filter by scheduledDate to align with visitDate
    const transactionDateFilter: any = {};

    if (dateRange.start) {
      visitDateFilter.gte = dateRange.start;
      appointmentDateFilter.gte = dateRange.start; // Filter by scheduledDate, not createdAt
      transactionDateFilter.gte = dateRange.start;
    }

    if (dateRange.end) {
      visitDateFilter.lte = dateRange.end;
      appointmentDateFilter.lte = dateRange.end; // Filter by scheduledDate, not createdAt
      transactionDateFilter.lte = dateRange.end;
    }

    const summary = await withDbRetry(async () => {
      // Get all visits in date range
      const visits = await prisma.visit.findMany({
        where: Object.keys(visitDateFilter).length > 0 ? { visitDate: visitDateFilter } : {},
        include: {
          patient: {
            select: {
              id: true,
              dob: true,
              nationalId: true,
            },
          },
          hospital: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Classify visits and track unique patients
      let newPatientVisits = 0;
      let existingPatientVisits = 0;
      let followUpVisits = 0;
      let notBookedExistingVisits = 0;
      
      // Track unique patient IDs for each category
      const uniqueNewPatients = new Set<string>();
      const uniqueExistingPatients = new Set<string>();
      const uniqueFollowUpPatients = new Set<string>();
      const uniqueNotBookedExistingPatients = new Set<string>();

      for (const visit of visits) {
        // Check if visit is from follow-up task
        const visitDateStart = new Date(visit.visitDate);
        visitDateStart.setHours(0, 0, 0, 0);
        const visitDateEnd = new Date(visit.visitDate);
        visitDateEnd.setHours(23, 59, 59, 999);

        const appointment = await prisma.appointment.findFirst({
          where: {
            patientId: visit.patientId,
            hospitalId: visit.hospitalId,
            scheduledDate: {
              gte: visitDateStart,
              lte: visitDateEnd,
            },
          },
          select: {
            createdFromFollowUpTaskId: true,
            isNotBooked: true,
          },
        });

        if (appointment?.createdFromFollowUpTaskId) {
          followUpVisits++;
          uniqueFollowUpPatients.add(visit.patientId);
        } else {
          // Check if first visit ever or first to hospital
          const previousVisits = await prisma.visit.findFirst({
            where: {
              patientId: visit.patientId,
              id: { not: visit.id },
              OR: [
                { visitDate: { lt: visit.visitDate } },
                {
                  visitDate: visit.visitDate,
                  createdAt: { lt: visit.createdAt },
                },
              ],
            },
            select: { id: true },
          });

          const previousVisitsToHospital = await prisma.visit.findFirst({
            where: {
              patientId: visit.patientId,
              hospitalId: visit.hospitalId,
              id: { not: visit.id },
              OR: [
                { visitDate: { lt: visit.visitDate } },
                {
                  visitDate: visit.visitDate,
                  createdAt: { lt: visit.createdAt },
                },
              ],
            },
            select: { id: true },
          });

          const isFirstVisitEver = !previousVisits;
          const isFirstVisitToHospital = !previousVisitsToHospital;

          if (isFirstVisitEver || isFirstVisitToHospital) {
            newPatientVisits++;
            uniqueNewPatients.add(visit.patientId);
          } else {
            // Existing patient visit
            // Check if it's a not booked existing patient visit
            if (appointment?.isNotBooked === true) {
              notBookedExistingVisits++;
              uniqueNotBookedExistingPatients.add(visit.patientId);
            } else {
              // Only count as existing if it's booked (not not-booked)
              existingPatientVisits++;
              uniqueExistingPatients.add(visit.patientId);
            }
          }
        }
      }

      // Get appointment counts by status
      // Filter by scheduledDate to align with visitDate filtering
      const appointmentsByStatus = await prisma.appointment.groupBy({
        by: ['status'],
        where: Object.keys(appointmentDateFilter).length > 0 ? { scheduledDate: appointmentDateFilter } : {},
        _count: {
          id: true,
        },
      });

      const appointmentStatusCounts: Record<string, number> = {
        scheduled: 0,
        completed: 0,
        cancelled: 0,
        no_show: 0,
        assigned: 0,
      };

      appointmentsByStatus.forEach((item) => {
        appointmentStatusCounts[item.status] = item._count.id;
      });

      const totalAppointments = Object.values(appointmentStatusCounts).reduce((sum, count) => sum + count, 0);

      // Get revenue from transactions
      const transactions = await prisma.transaction.findMany({
        where: Object.keys(transactionDateFilter).length > 0
          ? {
              createdAt: transactionDateFilter,
            }
          : {},
        select: {
          totalRevenue: true,
          companyShare: true,
          eligibleAmount: true,
          referralShare: true,
        },
      });

      const totalRevenue = transactions.reduce((sum, t) => sum + t.totalRevenue, 0);
      const totalCompanyShare = transactions.reduce((sum, t) => sum + t.companyShare, 0);
      const totalEligibleAmount = transactions.reduce((sum, t) => sum + t.eligibleAmount, 0);
      const totalReferralShare = transactions.reduce((sum, t) => sum + t.referralShare, 0);

      // Get unique specialties and doctors across all hospitals
      const visitSpecialities = await prisma.visitSpeciality.findMany({
        where: {
          visit: Object.keys(visitDateFilter).length > 0 ? { visitDate: visitDateFilter } : {},
        },
        include: {
          speciality: {
            select: {
              id: true,
              name: true,
            },
          },
          doctor: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const uniqueSpecialties = new Set(visitSpecialities.map((vs) => vs.speciality.id));
      const uniqueDoctors = new Set(visitSpecialities.map((vs) => vs.doctor.id));

      return {
        totalVisits: {
          new: {
            total: newPatientVisits,
            uniquePatients: uniqueNewPatients.size,
          },
          existing: {
            total: existingPatientVisits,
            uniquePatients: uniqueExistingPatients.size,
          },
          followUp: {
            total: followUpVisits,
            uniquePatients: uniqueFollowUpPatients.size,
          },
          notBookedExisting: {
            total: notBookedExistingVisits,
            uniquePatients: uniqueNotBookedExistingPatients.size,
          },
          total: newPatientVisits + existingPatientVisits + notBookedExistingVisits + followUpVisits,
        },
        totalAppointments: {
          total: totalAppointments,
          byStatus: appointmentStatusCounts,
        },
        totalRevenue: {
          totalRevenue,
          companyShare: totalCompanyShare,
          eligibleAmount: totalEligibleAmount,
          referralShare: totalReferralShare,
        },
        totalUniqueSpecialties: uniqueSpecialties.size,
        totalUniqueDoctors: uniqueDoctors.size,
      };
    });

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Error fetching reports summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports summary',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get detailed statistics for all hospitals
 */
export const getHospitalsReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const startDateStr = req.query.startDate as string | undefined;
    const endDateStr = req.query.endDate as string | undefined;

    // Use shared Dubai timezone date utilities
    const dateRange = getDubaiRangeFromStrings(startDateStr, endDateStr);

    // Build date filters using Dubai UTC ranges
    const visitDateFilter: any = {};
    const appointmentDateFilter: any = {}; // Will filter by scheduledDate to align with visitDate
    const transactionDateFilter: any = {};

    if (dateRange.start) {
      visitDateFilter.gte = dateRange.start;
      appointmentDateFilter.gte = dateRange.start; // Filter by scheduledDate, not createdAt
      transactionDateFilter.gte = dateRange.start;
    }

    if (dateRange.end) {
      visitDateFilter.lte = dateRange.end;
      appointmentDateFilter.lte = dateRange.end; // Filter by scheduledDate, not createdAt
      transactionDateFilter.lte = dateRange.end;
    }

    const hospitalsReport = await withDbRetry(async () => {
      // Get all hospitals
      const hospitals = await prisma.hospital.findMany({
        orderBy: {
          name: 'asc',
        },
        select: {
          id: true,
          name: true,
        },
      });

      const hospitalsData = await Promise.all(
        hospitals.map(async (hospital) => {
          // Get visits for this hospital
          const visits = await prisma.visit.findMany({
            where: {
              hospitalId: hospital.id,
              ...(Object.keys(visitDateFilter).length > 0 ? { visitDate: visitDateFilter } : {}),
            },
            include: {
              patient: {
                select: {
                  id: true,
                  dob: true,
                  nationalId: true,
                },
              },
            },
          });

          // Classify visits and track unique patients
          let newPatientVisits = 0;
          let existingPatientVisits = 0;
          let followUpVisits = 0;
          let notBookedExistingVisits = 0;
          
          // Track unique patient IDs for each category
          const uniqueNewPatients = new Set<string>();
          const uniqueExistingPatients = new Set<string>();
          const uniqueFollowUpPatients = new Set<string>();
          const uniqueNotBookedExistingPatients = new Set<string>();

          for (const visit of visits) {
            // Check if visit is from follow-up task
            const visitDateStart = new Date(visit.visitDate);
            visitDateStart.setHours(0, 0, 0, 0);
            const visitDateEnd = new Date(visit.visitDate);
            visitDateEnd.setHours(23, 59, 59, 999);

            const appointment = await prisma.appointment.findFirst({
              where: {
                patientId: visit.patientId,
                hospitalId: visit.hospitalId,
                scheduledDate: {
                  gte: visitDateStart,
                  lte: visitDateEnd,
                },
              },
              select: {
                createdFromFollowUpTaskId: true,
                isNotBooked: true,
              },
            });

            if (appointment?.createdFromFollowUpTaskId) {
              followUpVisits++;
              uniqueFollowUpPatients.add(visit.patientId);
            } else {
              // Check if first visit ever or first to hospital
              const previousVisits = await prisma.visit.findFirst({
                where: {
                  patientId: visit.patientId,
                  id: { not: visit.id },
                  OR: [
                    { visitDate: { lt: visit.visitDate } },
                    {
                      visitDate: visit.visitDate,
                      createdAt: { lt: visit.createdAt },
                    },
                  ],
                },
                select: { id: true },
              });

              const previousVisitsToHospital = await prisma.visit.findFirst({
                where: {
                  patientId: visit.patientId,
                  hospitalId: visit.hospitalId,
                  id: { not: visit.id },
                  OR: [
                    { visitDate: { lt: visit.visitDate } },
                    {
                      visitDate: visit.visitDate,
                      createdAt: { lt: visit.createdAt },
                    },
                  ],
                },
                select: { id: true },
              });

              const isFirstVisitEver = !previousVisits;
              const isFirstVisitToHospital = !previousVisitsToHospital;

              if (isFirstVisitEver || isFirstVisitToHospital) {
                newPatientVisits++;
                uniqueNewPatients.add(visit.patientId);
              } else {
                // Existing patient visit
                existingPatientVisits++;
                uniqueExistingPatients.add(visit.patientId);
                // Check if it's a not booked existing patient visit
                if (appointment?.isNotBooked === true) {
                  notBookedExistingVisits++;
                  uniqueNotBookedExistingPatients.add(visit.patientId);
                }
              }
            }
          }

          // Get appointment counts by status for this hospital
          // Filter by scheduledDate to align with visitDate filtering
          const appointmentsByStatus = await prisma.appointment.groupBy({
            by: ['status'],
            where: {
              hospitalId: hospital.id,
              ...(Object.keys(appointmentDateFilter).length > 0 ? { scheduledDate: appointmentDateFilter } : {}),
            },
            _count: {
              id: true,
            },
          });

          const appointmentStatusCounts: Record<string, number> = {
            scheduled: 0,
            completed: 0,
            cancelled: 0,
            no_show: 0,
            assigned: 0,
          };

          appointmentsByStatus.forEach((item) => {
            appointmentStatusCounts[item.status] = item._count.id;
          });

          const totalAppointments = Object.values(appointmentStatusCounts).reduce((sum, count) => sum + count, 0);

          // Get revenue from transactions for this hospital
          const transactions = await prisma.transaction.findMany({
            where: {
              hospitalId: hospital.id,
              ...(Object.keys(transactionDateFilter).length > 0
                ? {
                    createdAt: transactionDateFilter,
                  }
                : {}),
            },
            select: {
              totalRevenue: true,
              companyShare: true,
              eligibleAmount: true,
              referralShare: true,
            },
          });

          const totalRevenue = transactions.reduce((sum, t) => sum + t.totalRevenue, 0);
          const totalCompanyShare = transactions.reduce((sum, t) => sum + t.companyShare, 0);
          const totalEligibleAmount = transactions.reduce((sum, t) => sum + t.eligibleAmount, 0);
          const totalReferralShare = transactions.reduce((sum, t) => sum + t.referralShare, 0);

          // Get visit specialities for this hospital with counts
          const visitSpecialities = await prisma.visitSpeciality.findMany({
            where: {
              visit: {
                hospitalId: hospital.id,
                ...(Object.keys(visitDateFilter).length > 0 ? { visitDate: visitDateFilter } : {}),
              },
            },
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true,
                },
              },
              doctor: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });

          // Count visits per specialty
          const specialtyCounts = new Map<string, { name: string; count: number }>();
          visitSpecialities.forEach((vs) => {
            if (vs.speciality) {
              const existing = specialtyCounts.get(vs.speciality.id);
              if (existing) {
                existing.count += 1;
              } else {
                specialtyCounts.set(vs.speciality.id, {
                  name: vs.speciality.name,
                  count: 1,
                });
              }
            }
          });

          // Count visits per doctor
          const doctorCounts = new Map<string, { name: string; count: number }>();
          visitSpecialities.forEach((vs) => {
            if (vs.doctor) {
              const existing = doctorCounts.get(vs.doctor.id);
              if (existing) {
                existing.count += 1;
              } else {
                doctorCounts.set(vs.doctor.id, {
                  name: vs.doctor.name,
                  count: 1,
                });
              }
            }
          });

          // Convert to arrays and sort by count (descending)
          const specialtiesList = Array.from(specialtyCounts.values())
            .sort((a, b) => b.count - a.count)
            .map((item) => ({
              name: item.name,
              count: item.count,
            }));

          const doctorsList = Array.from(doctorCounts.values())
            .sort((a, b) => b.count - a.count)
            .map((item) => ({
              name: item.name,
              count: item.count,
            }));

          return {
            hospitalId: hospital.id,
            hospitalName: hospital.name,
            visits: {
              new: {
                total: newPatientVisits,
                uniquePatients: uniqueNewPatients.size,
              },
              existing: {
                total: existingPatientVisits,
                uniquePatients: uniqueExistingPatients.size,
              },
              followUp: {
                total: followUpVisits,
                uniquePatients: uniqueFollowUpPatients.size,
              },
              notBookedExisting: {
                total: notBookedExistingVisits,
                uniquePatients: uniqueNotBookedExistingPatients.size,
              },
              total: newPatientVisits + existingPatientVisits + notBookedExistingVisits + followUpVisits,
            },
            appointments: {
              total: totalAppointments,
              byStatus: appointmentStatusCounts,
            },
            revenue: {
              totalRevenue,
              companyShare: totalCompanyShare,
              eligibleAmount: totalEligibleAmount,
              referralShare: totalReferralShare,
            },
            specialties: {
              count: specialtiesList.length,
              list: specialtiesList,
            },
            doctors: {
              count: doctorsList.length,
              list: doctorsList,
            },
          };
        })
      );

      return hospitalsData;
    });

    res.status(200).json({
      success: true,
      data: hospitalsReport,
    });
  } catch (error) {
    console.error('Error fetching hospitals report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hospitals report',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
