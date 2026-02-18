import { prisma } from '../utils/database.utils';
import { withDbRetry } from '../utils/database.utils';
import { getTransactionAppointmentType, AppointmentType } from '../utils/appointment.utils';

export interface CreateTransactionData {
  patientId: string;
  hospitalId: string;
  month: string;
  year: string;
  totalRevenue: number;
  companyShare: number;
  eligibleAmount: number;
  referralShare: number;
  recordedById: string;
  source?: 'manual' | 'excel';
  status?: string;
  visitSpecialityIds?: string[];
  mrn?: string;
}

export interface BulkTransactionData {
  transactions: CreateTransactionData[];
}

export interface TransactionFilter {
  hospitalId?: string;
  month?: string;
  year?: string;
  patientId?: string;
  source?: 'manual' | 'excel';
  search?: string;
  page?: number;
  limit?: number;
  isNew?: boolean;
}

export interface PatientWithVisits {
  patient: {
    id: string;
    nameEnglish: string | null;
    nameArabic: string | null;
    nationalId: string;
    phoneNumber: string | null;
  };
  visits: Array<{
    id: string;
    visitDate: Date;
    hospital: {
      id: string;
      name: string;
    };
    visitSpecialities: Array<{
      id: string;
      speciality: {
        id: string;
        name: string;
      };
      doctor: {
        id: string;
        name: string;
      };
      doctorName: string | null;
      scheduledTime: Date;
      status: string;
    }>;
  }>;
}

// Get transactions with filters
export const getTransactionsByHospitalMonth = async (filter: TransactionFilter) => {
  try {
    const page = filter.page || 1;
    const limit = filter.limit || 50;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      ...(filter.hospitalId && { hospitalId: filter.hospitalId }),
      ...(filter.month && { month: filter.month }),
      ...(filter.year && { year: filter.year }),
      ...(filter.patientId && { patientId: filter.patientId }),
      ...(filter.source && { source: filter.source }),
    };

    // Add search logic for patient fields
    if (filter.search) {
      where.AND = [
        {
          patient: {
            OR: [
              { nameEnglish: { contains: filter.search, mode: 'insensitive' } },
              { nameArabic: { contains: filter.search, mode: 'insensitive' } },
              { nationalId: { contains: filter.search, mode: 'insensitive' } },
              { phoneNumber: { contains: filter.search, mode: 'insensitive' } },
            ]
          }
        }
      ];
    }

    // When filtering by isNew, we need to fetch all matching transactions to:
    // 1. Calculate isNew for all of them
    // 2. Filter correctly
    // 3. Paginate the filtered results accurately
    // For accurate pagination and totals, fetch all matching transactions (with safety limit)
    const isFilteringByIsNew = filter.isNew !== undefined;
    
    // If filtering by isNew, fetch all matching transactions (up to a safety limit)
    // This ensures accurate pagination and total counts
    // If not filtering by isNew, use normal pagination with skip/take
    const MAX_FETCH_LIMIT = 10000; // Safety limit to prevent performance issues
    
    const transactions = await withDbRetry(async () => {
      const queryOptions: any = {
        where,
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
              phoneNumber: true,
            }
          },
          hospital: {
            select: {
              id: true,
              name: true,
            }
          },
          recordedBy: {
            select: {
              id: true,
              name: true,
            }
          },
          visitSpecialities: {
            include: {
              visitSpeciality: {
                include: {
                  speciality: {
                    select: {
                      id: true,
                      name: true,
                    }
                  },
                  doctor: {
                    select: {
                      id: true,
                      name: true,
                    }
                  },
                  visit: {
                    include: {
                      appointments: {
                        select: {
                          id: true,
                          isNewPatientAtCreation: true,
                          createdFromFollowUpTaskId: true,
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      };

      if (isFilteringByIsNew) {
        // When filtering by isNew, fetch all matching transactions (up to safety limit)
        // We can't use skip here because we need to calculate isNew for all transactions first
        queryOptions.take = MAX_FETCH_LIMIT;
      } else {
        // When not filtering by isNew, use proper database-level pagination
        queryOptions.skip = skip;
        queryOptions.take = limit;
      }

      return await prisma.transaction.findMany(queryOptions);
    });

    // Calculate visit counts and determine if transaction is "New" or "Follow Up"
    const transactionsWithVisitCounts = await Promise.all(
      transactions.map(async (transaction) => {
        // Convert month name to date range
        const monthNames = [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const monthIndex = monthNames.indexOf(transaction.month || '');
        const yearNum = parseInt(transaction.year || '');
        
        let visitCount = 0;
        let isNew = false;
        
        if (monthIndex !== -1 && !isNaN(yearNum)) {
          // Use UTC dates to avoid timezone issues
          // Start: First moment of the month in UTC (00:00:00 UTC)
          const startDate = new Date(Date.UTC(yearNum, monthIndex, 1, 0, 0, 0, 0));
          // End: First moment of the next month in UTC (exclusive - visits must be < this)
          const endDate = new Date(Date.UTC(yearNum, monthIndex + 1, 1, 0, 0, 0, 0));
          
          // Count all visits for this patient at this hospital in this month/year
          // This includes legacy visits (visits without specialties)
          // Use gte and lt to ensure we only count visits within the exact month
          visitCount = await withDbRetry(async () => {
            return await prisma.visit.count({
              where: {
                patientId: transaction.patientId,
                hospitalId: transaction.hospitalId,
                visitDate: {
                  gte: startDate,
                  lt: endDate, // Less than first moment of next month (exclusive)
                }
              }
            });
          });

          // Determine if this is a "New" transaction (first visit to this hospital in this month/year)
          // or "Follow Up" (subsequent visits)
          const firstVisit = await withDbRetry(async () => {
            return await prisma.visit.findFirst({
              where: {
                patientId: transaction.patientId,
                hospitalId: transaction.hospitalId,
              },
              orderBy: {
                visitDate: 'asc'
              },
              select: {
                visitDate: true
              }
            });
          });

          if (firstVisit) {
            const firstVisitDate = new Date(firstVisit.visitDate);
            const firstVisitMonth = firstVisitDate.getMonth() + 1; // 1-12
            const firstVisitYear = firstVisitDate.getFullYear();
            const transactionMonth = monthIndex + 1; // monthIndex is 0-11, so +1 gives 1-12
            
            // Transaction is "New" if its month/year matches the first visit's month/year
            isNew = (firstVisitMonth === transactionMonth && firstVisitYear === yearNum);
          }
        }
        
        // Determine appointment type by checking visitSpecialities -> visit -> appointments
        let appointmentType: AppointmentType = 'unknown';
        try {
          appointmentType = await getTransactionAppointmentType(transaction as any);
        } catch (error) {
          console.warn('Error determining appointment type for transaction:', transaction.id, error);
        }
        
        return {
          ...transaction,
          visitCount,
          isNew,
          appointmentType
        };
      })
    );

    // Apply isNew filter if provided
    let filteredTransactions = transactionsWithVisitCounts;
    if (filter.isNew !== undefined) {
      filteredTransactions = transactionsWithVisitCounts.filter(t => t.isNew === filter.isNew);
    }

    // Get total count for filtered results
    let total: number;
    if (isFilteringByIsNew) {
      // When filtering by isNew, use the count of filtered transactions
      // If we hit the MAX_FETCH_LIMIT, we might have more, so estimate
      const hitFetchLimit = transactions.length >= MAX_FETCH_LIMIT;
      
      if (hitFetchLimit) {
        // We hit the safety limit, estimate total based on ratio
        const baseTotal = await withDbRetry(async () => {
          return await prisma.transaction.count({ where });
        });
        const filterRatio = transactionsWithVisitCounts.length > 0 
          ? filteredTransactions.length / transactionsWithVisitCounts.length 
          : 0.5; // Default to 50% if no transactions
        total = Math.max(filteredTransactions.length, Math.ceil(baseTotal * filterRatio));
      } else {
        // We fetched all matching transactions, so filtered count is accurate
        total = filteredTransactions.length;
      }
    } else {
      // If not filtering by isNew, get accurate count from database
      total = await withDbRetry(async () => {
        return await prisma.transaction.count({ where });
      });
    }

    // Apply pagination after filtering
    let paginatedTransactions: typeof filteredTransactions;
    if (isFilteringByIsNew) {
      // When filtering by isNew, we fetched all transactions and filtered them
      // Now we need to paginate the filtered results in memory
      paginatedTransactions = filteredTransactions.slice(skip, skip + limit);
    } else {
      // When not filtering by isNew, database already paginated the results
      // We just need to apply the isNew calculation (which doesn't filter, just adds the field)
      paginatedTransactions = filteredTransactions;
    }
    
    const totalPages = Math.ceil(total / limit);

    return {
      transactions: paginatedTransactions,
      pagination: {
        page,
        limit,
        total,
        pages: totalPages
      }
    };
  } catch (error) {
    console.error('Error fetching transactions:', error);
    throw error;
  }
};

// Get patients with visits for transaction entry
export const getPatientsWithVisitsForTransaction = async (
  hospitalId: string,
  month: string,
  year: string
): Promise<PatientWithVisits[]> => {
  try {
    // Convert month name to month number (0-11)
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthIndex = monthNames.indexOf(month);
    if (monthIndex === -1) {
      throw new Error(`Invalid month: ${month}`);
    }

    const yearNum = parseInt(year);
    const startDate = new Date(yearNum, monthIndex, 1);
    const endDate = new Date(yearNum, monthIndex + 1, 0, 23, 59, 59, 999);

    const visits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: {
          hospitalId: hospitalId,
          visitDate: {
            gte: startDate,
            lte: endDate,
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
            }
          },
          hospital: {
            select: {
              id: true,
              name: true,
            }
          },
          visitSpecialities: {
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true,
                }
              },
              doctor: {
                select: {
                  id: true,
                  name: true,
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

    // Group visits by patient
    const patientMap = new Map<string, PatientWithVisits>();

    visits.forEach(visit => {
      const patientId = visit.patientId;
      
      if (!patientMap.has(patientId)) {
        patientMap.set(patientId, {
          patient: visit.patient,
          visits: []
        });
      }

      const patientData = patientMap.get(patientId)!;
      patientData.visits.push({
        id: visit.id,
        visitDate: visit.visitDate,
        hospital: visit.hospital,
        visitSpecialities: visit.visitSpecialities.map(vs => ({
          id: vs.id,
          speciality: vs.speciality,
          doctor: vs.doctor,
          doctorName: vs.doctorName,
          scheduledTime: vs.scheduledTime,
          status: vs.status,
        }))
      });
    });

    return Array.from(patientMap.values());
  } catch (error) {
    console.error('Error fetching patients with visits:', error);
    throw error;
  }
};

// Create transaction with visit specialty links
export const createTransaction = async (data: CreateTransactionData) => {
  try {
    const transaction = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // Create transaction
        const newTransaction = await tx.transaction.create({
          data: {
            patientId: data.patientId,
            hospitalId: data.hospitalId,
            month: data.month,
            year: data.year,
            totalRevenue: data.totalRevenue,
            companyShare: data.companyShare,
            eligibleAmount: data.eligibleAmount,
            referralShare: data.referralShare,
            recordedById: data.recordedById,
            source: data.source || 'manual',
            status: data.status || 'active',
          },
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nameArabic: true,
                nationalId: true,
              }
            },
            hospital: {
              select: {
                id: true,
                name: true,
              }
            }
          }
        });

        // Link visit specialties if provided
        if (data.visitSpecialityIds && data.visitSpecialityIds.length > 0) {
          await tx.transactionVisitSpeciality.createMany({
            data: data.visitSpecialityIds.map(visitSpecialityId => ({
              transactionId: newTransaction.id,
              visitSpecialityId: visitSpecialityId,
            })),
            skipDuplicates: true
          });
        }

        // Fetch the complete transaction with visit specialties
        const completeTransaction = await tx.transaction.findUnique({
          where: { id: newTransaction.id },
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nameArabic: true,
                nationalId: true,
              }
            },
            hospital: {
              select: {
                id: true,
                name: true,
              }
            },
            visitSpecialities: {
              include: {
                visitSpeciality: {
                  include: {
                    speciality: {
                      select: {
                        id: true,
                        name: true,
                      }
                    },
                    doctor: {
                      select: {
                        id: true,
                        name: true,
                      }
                    },
                    visit: {
                      select: {
                        id: true,
                        visitDate: true,
                      }
                    }
                  }
                }
              }
            }
          }
        });

        return completeTransaction;
      });
    });

    return transaction;
  } catch (error) {
    console.error('Error creating transaction:', error);
    throw error;
  }
};

// Bulk create transactions from Excel import
export const bulkCreateTransactions = async (transactions: CreateTransactionData[]) => {
  try {
    const results = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const createdTransactions = [];

        for (const transactionData of transactions) {
          // Save MRN if provided
          if (transactionData.mrn && transactionData.mrn.trim()) {
            try {
              await tx.patientHospitalMRN.upsert({
                where: {
                  patientId_hospitalId: {
                    patientId: transactionData.patientId,
                    hospitalId: transactionData.hospitalId
                  }
                },
                update: {
                  mrn: transactionData.mrn.trim(),
                  updatedAt: new Date()
                },
                create: {
                  patientId: transactionData.patientId,
                  hospitalId: transactionData.hospitalId,
                  mrn: transactionData.mrn.trim()
                }
              });
            } catch (mrnError) {
              // Log error but don't fail the transaction creation
              console.error('Error saving MRN:', mrnError);
            }
          }

          // Check if transaction already exists for this patient/hospital/month/year
          const existing = await tx.transaction.findFirst({
            where: {
              patientId: transactionData.patientId,
              hospitalId: transactionData.hospitalId,
              month: transactionData.month,
              year: transactionData.year,
            }
          });

          if (existing) {
            // Update existing transaction
            const updated = await tx.transaction.update({
              where: { id: existing.id },
              data: {
                totalRevenue: transactionData.totalRevenue,
                companyShare: transactionData.companyShare,
                eligibleAmount: transactionData.eligibleAmount,
                referralShare: transactionData.referralShare,
                source: transactionData.source || 'excel',
                updatedAt: new Date(),
              }
            });
            createdTransactions.push(updated);
          } else {
            // Create new transaction
            const newTransaction = await tx.transaction.create({
              data: {
                patientId: transactionData.patientId,
                hospitalId: transactionData.hospitalId,
                month: transactionData.month,
                year: transactionData.year,
                totalRevenue: transactionData.totalRevenue,
                companyShare: transactionData.companyShare,
                eligibleAmount: transactionData.eligibleAmount,
                referralShare: transactionData.referralShare,
                recordedById: transactionData.recordedById,
                source: transactionData.source || 'excel',
                status: transactionData.status || 'active',
              }
            });

            // Link visit specialties if provided
            if (transactionData.visitSpecialityIds && transactionData.visitSpecialityIds.length > 0) {
              await tx.transactionVisitSpeciality.createMany({
                data: transactionData.visitSpecialityIds.map(visitSpecialityId => ({
                  transactionId: newTransaction.id,
                  visitSpecialityId: visitSpecialityId,
                })),
                skipDuplicates: true
              });
            }

            createdTransactions.push(newTransaction);
          }
        }

        return createdTransactions;
      });
    });

    return results;
  } catch (error) {
    console.error('Error bulk creating transactions:', error);
    throw error;
  }
};

// Link transaction to visit specialties
export const linkTransactionToVisitSpecialities = async (
  transactionId: string,
  visitSpecialityIds: string[]
) => {
  try {
    await withDbRetry(async () => {
      // Remove existing links
      await prisma.transactionVisitSpeciality.deleteMany({
        where: { transactionId }
      });

      // Create new links
      if (visitSpecialityIds.length > 0) {
        await prisma.transactionVisitSpeciality.createMany({
          data: visitSpecialityIds.map(visitSpecialityId => ({
            transactionId,
            visitSpecialityId,
          })),
          skipDuplicates: true
        });
      }
    });

    return true;
  } catch (error) {
    console.error('Error linking transaction to visit specialties:', error);
    throw error;
  }
};

// Get transaction with full details
export const getTransactionWithDetails = async (transactionId: string) => {
  try {
    const transaction = await withDbRetry(async () => {
      return await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
              phoneNumber: true,
            }
          },
          hospital: {
            select: {
              id: true,
              name: true,
            }
          },
          recordedBy: {
            select: {
              id: true,
              name: true,
            }
          },
          visitSpecialities: {
            include: {
              visitSpeciality: {
                include: {
                  speciality: {
                    select: {
                      id: true,
                      name: true,
                    }
                  },
                  doctor: {
                    select: {
                      id: true,
                      name: true,
                    }
                  },
                  visit: {
                    select: {
                      id: true,
                      visitDate: true,
                    }
                  }
                }
              }
            }
          }
        }
      });
    });

    if (!transaction) {
      return null;
    }

    // Calculate visit count including legacy visits and determine if transaction is "New"
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthIndex = monthNames.indexOf(transaction.month || '');
    const yearNum = parseInt(transaction.year || '');
    
    let visitCount = 0;
    let isNew = false;
    
    if (monthIndex !== -1 && !isNaN(yearNum)) {
      // Use UTC dates to avoid timezone issues
      // Start: First moment of the month in UTC (00:00:00 UTC)
      const startDate = new Date(Date.UTC(yearNum, monthIndex, 1, 0, 0, 0, 0));
      // End: First moment of the next month in UTC (exclusive - visits must be < this)
      const endDate = new Date(Date.UTC(yearNum, monthIndex + 1, 1, 0, 0, 0, 0));
      
      visitCount = await withDbRetry(async () => {
        return await prisma.visit.count({
          where: {
            patientId: transaction.patientId,
            hospitalId: transaction.hospitalId,
            visitDate: {
              gte: startDate,
              lt: endDate, // Less than first moment of next month (exclusive)
            }
          }
        });
      });

      // Determine if this is a "New" transaction (first visit to this hospital in this month/year)
      const firstVisit = await withDbRetry(async () => {
        return await prisma.visit.findFirst({
          where: {
            patientId: transaction.patientId,
            hospitalId: transaction.hospitalId,
          },
          orderBy: {
            visitDate: 'asc'
          },
          select: {
            visitDate: true
          }
        });
      });

      if (firstVisit) {
        const firstVisitDate = new Date(firstVisit.visitDate);
        const firstVisitMonth = firstVisitDate.getMonth() + 1; // 1-12
        const firstVisitYear = firstVisitDate.getFullYear();
        const transactionMonth = monthIndex + 1; // monthIndex is 0-11, so +1 gives 1-12
        
        // Transaction is "New" if its month/year matches the first visit's month/year
        isNew = (firstVisitMonth === transactionMonth && firstVisitYear === yearNum);
      }
    }

    return {
      ...transaction,
      visitCount,
      isNew
    };
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    throw error;
  }
};

// Get transaction summary/aggregates
export const getTransactionSummary = async (filter: TransactionFilter) => {
  try {
    const summary = await withDbRetry(async () => {
      // Build where clause (same as getTransactionsByHospitalMonth)
      const where: any = {
        ...(filter.hospitalId && { hospitalId: filter.hospitalId }),
        ...(filter.month && { month: filter.month }),
        ...(filter.year && { year: filter.year }),
        ...(filter.patientId && { patientId: filter.patientId }),
        ...(filter.source && { source: filter.source }),
      };

      // Add search logic for patient fields
      if (filter.search) {
        where.AND = [
          {
            patient: {
              OR: [
                { nameEnglish: { contains: filter.search, mode: 'insensitive' } },
                { nameArabic: { contains: filter.search, mode: 'insensitive' } },
                { nationalId: { contains: filter.search, mode: 'insensitive' } },
                { phoneNumber: { contains: filter.search, mode: 'insensitive' } },
              ]
            }
          }
        ];
      }

      // Fetch transactions with patient info (needed for isNew calculation and search)
      const transactions = await prisma.transaction.findMany({
        where,
        select: {
          id: true,
          patientId: true,
          hospitalId: true,
          month: true,
          year: true,
          totalRevenue: true,
          companyShare: true,
          eligibleAmount: true,
          referralShare: true,
          patient: {
            select: {
              id: true,
            }
          },
        }
      });

      // If filtering by isNew, calculate isNew for each transaction and filter
      let filteredTransactions = transactions;
      if (filter.isNew !== undefined) {
        const transactionsWithIsNew = await Promise.all(
          transactions.map(async (transaction) => {
            const monthNames = [
              'January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December'
            ];
            const monthIndex = monthNames.indexOf(transaction.month || '');
            const yearNum = parseInt(transaction.year || '');
            
            let isNew = false;
            
            if (monthIndex !== -1 && !isNaN(yearNum)) {
              const firstVisit = await prisma.visit.findFirst({
                where: {
                  patientId: transaction.patientId,
                  hospitalId: transaction.hospitalId,
                },
                orderBy: {
                  visitDate: 'asc'
                },
                select: {
                  visitDate: true
                }
              });

              if (firstVisit) {
                const firstVisitDate = new Date(firstVisit.visitDate);
                const firstVisitMonth = firstVisitDate.getMonth() + 1;
                const firstVisitYear = firstVisitDate.getFullYear();
                const transactionMonth = monthIndex + 1;
                
                isNew = (firstVisitMonth === transactionMonth && firstVisitYear === yearNum);
              }
            }
            
            return {
              ...transaction,
              isNew
            };
          })
        );

        filteredTransactions = transactionsWithIsNew.filter(t => t.isNew === filter.isNew);
      }

      const totals = filteredTransactions.reduce((acc, t) => ({
        totalRevenue: acc.totalRevenue + t.totalRevenue,
        companyShare: acc.companyShare + t.companyShare,
        eligibleAmount: acc.eligibleAmount + t.eligibleAmount,
        referralShare: acc.referralShare + t.referralShare,
      }), {
        totalRevenue: 0,
        companyShare: 0,
        eligibleAmount: 0,
        referralShare: 0,
      });

      return {
        count: filteredTransactions.length,
        totals,
        averageRevenue: filteredTransactions.length > 0 ? totals.totalRevenue / filteredTransactions.length : 0,
      };
    });

    return summary;
  } catch (error) {
    console.error('Error fetching transaction summary:', error);
    throw error;
  }
};

// Get summary for all hospitals
export const getAllHospitalsSummary = async (filter: { month?: string; year?: string; isNew?: boolean }) => {
  try {
    const summary = await withDbRetry(async () => {
      // Build where clause (without hospitalId constraint)
      const where: any = {
        ...(filter.month && { month: filter.month }),
        ...(filter.year && { year: filter.year }),
      };

      // Fetch all transactions matching filters
      const transactions = await prisma.transaction.findMany({
        where,
        select: {
          id: true,
          patientId: true,
          hospitalId: true,
          month: true,
          year: true,
          totalRevenue: true,
          companyShare: true,
          eligibleAmount: true,
          referralShare: true,
          hospital: {
            select: {
              id: true,
              name: true,
            }
          },
          patient: {
            select: {
              id: true,
            }
          },
        }
      });

      // Calculate isNew for each transaction if needed
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];

      const transactionsWithIsNew = await Promise.all(
        transactions.map(async (transaction) => {
          const monthIndex = monthNames.indexOf(transaction.month || '');
          const yearNum = parseInt(transaction.year || '');
          
          let isNew = false;
          
          if (monthIndex !== -1 && !isNaN(yearNum)) {
            const firstVisit = await prisma.visit.findFirst({
              where: {
                patientId: transaction.patientId,
                hospitalId: transaction.hospitalId,
              },
              orderBy: {
                visitDate: 'asc'
              },
              select: {
                visitDate: true
              }
            });

            if (firstVisit) {
              const firstVisitDate = new Date(firstVisit.visitDate);
              const firstVisitMonth = firstVisitDate.getMonth() + 1;
              const firstVisitYear = firstVisitDate.getFullYear();
              const transactionMonth = monthIndex + 1;
              
              isNew = (firstVisitMonth === transactionMonth && firstVisitYear === yearNum);
            }
          }
          
          return {
            ...transaction,
            isNew
          };
        })
      );

      // Filter by isNew if specified
      let filteredTransactions = transactionsWithIsNew;
      if (filter.isNew !== undefined) {
        filteredTransactions = transactionsWithIsNew.filter(t => t.isNew === filter.isNew);
      }

      // Group by hospitalId
      const hospitalMap = new Map<string, {
        hospitalId: string;
        hospitalName: string;
        totalRevenue: number;
        companyShare: number;
        eligibleAmount: number;
        referralShare: number;
        totalTransactions: number;
        newTransactions: number;
        followUpTransactions: number;
      }>();

      filteredTransactions.forEach(transaction => {
        const hospitalId = transaction.hospitalId;
        const hospitalName = transaction.hospital.name;

        if (!hospitalMap.has(hospitalId)) {
          hospitalMap.set(hospitalId, {
            hospitalId,
            hospitalName,
            totalRevenue: 0,
            companyShare: 0,
            eligibleAmount: 0,
            referralShare: 0,
            totalTransactions: 0,
            newTransactions: 0,
            followUpTransactions: 0,
          });
        }

        const hospitalSummary = hospitalMap.get(hospitalId)!;
        hospitalSummary.totalRevenue += transaction.totalRevenue;
        hospitalSummary.companyShare += transaction.companyShare;
        hospitalSummary.eligibleAmount += transaction.eligibleAmount;
        hospitalSummary.referralShare += transaction.referralShare;
        hospitalSummary.totalTransactions += 1;
        
        if (transaction.isNew) {
          hospitalSummary.newTransactions += 1;
        } else {
          hospitalSummary.followUpTransactions += 1;
        }
      });

      // Convert map to array
      return Array.from(hospitalMap.values());
    });

    return summary;
  } catch (error) {
    console.error('Error fetching all hospitals summary:', error);
    throw error;
  }
};

// Get transactions by sales person (where patient's salesPersonId matches)
export const getTransactionsBySalesPerson = async (
  salesPersonId: string,
  filter: TransactionFilter = {}
) => {
  try {
    const transactions = await withDbRetry(async () => {
      return await prisma.transaction.findMany({
        where: {
          patient: {
            salesPersonId: salesPersonId,
          },
          ...(filter.hospitalId && { hospitalId: filter.hospitalId }),
          ...(filter.month && { month: filter.month }),
          ...(filter.year && { year: filter.year }),
          ...(filter.patientId && { patientId: filter.patientId }),
          ...(filter.source && { source: filter.source }),
        },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
            }
          },
          hospital: {
            select: {
              id: true,
              name: true,
            }
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    });

    // Calculate total referral share
    const totalReferralShare = transactions.reduce((sum, t) => sum + t.referralShare, 0);

    return {
      transactions,
      totalReferralShare,
      count: transactions.length,
    };
  } catch (error) {
    console.error('Error fetching transactions by sales person:', error);
    throw error;
  }
};

export default {
  getTransactionsByHospitalMonth,
  getPatientsWithVisitsForTransaction,
  createTransaction,
  bulkCreateTransactions,
  linkTransactionToVisitSpecialities,
  getTransactionWithDetails,
  getTransactionSummary,
  getAllHospitalsSummary,
  getTransactionsBySalesPerson,
};
