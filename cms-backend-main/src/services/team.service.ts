import { withDbRetry, prisma } from '../utils/database.utils';

export interface CreateTeamData {
  name: string;
  leaderId: string;
  targetData?: Array<{
    type: 'daily' | 'weekly' | 'monthly';
    category: string;
    description: string;
    targetValue: number;
    startDate: Date;
    endDate: Date;
  }>;
}

export interface TeamMemberProgress {
  employeeId: string;
  employeeName: string;
  role: string;
  progress: number;
  targetValue?: number;
}

/**
 * Create a new team with optional target
 */
export const createTeam = async (data: CreateTeamData, createdById: string) => {
  try {
    // Validate leader is sales or coordinator
    // Handle both UUID and employeeId (EMP009 format)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.leaderId);
    
    const leader = await withDbRetry(async () => {
      if (isUUID) {
        return await prisma.employee.findUnique({
          where: { id: data.leaderId },
          include: {
            employeeRoles: {
              where: { isActive: true },
              select: { role: true }
            }
          }
        });
      } else {
        return await prisma.employee.findFirst({
          where: { employeeId: data.leaderId },
          include: {
            employeeRoles: {
              where: { isActive: true },
              select: { role: true }
            }
          }
        });
      }
    });

    if (!leader) {
      throw new Error('Leader not found');
    }

    const leaderRoles = leader.employeeRoles?.map(er => er.role) || [];
    const isSalesOrCoordinator = leaderRoles.includes('sales') || leaderRoles.includes('coordinator');
    
    if (!isSalesOrCoordinator) {
      throw new Error('Team leader must be a sales person or coordinator');
    }

    // Save leader's original name and update to "Team Name Original Name" format
    const leaderOriginalName = leader.name;

    // Create team and optionally create target
    const result = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // Update leader's name to "Team Name Original Name" format
        // Use leader.id (UUID) for the update since we now have the full leader object
        await tx.employee.update({
          where: { id: leader.id },
          data: { name: `${data.name} ${leaderOriginalName}` }
        });

        const team = await tx.team.create({
          data: {
            name: data.name,
            leaderId: leader.id, // Use leader.id (UUID) instead of data.leaderId
            leaderOriginalName: leaderOriginalName,
            isActive: true
          }
        });

        const createdTargets: any[] = [];
        if (data.targetData && data.targetData.length > 0) {
          // Create multiple targets for the team
          for (const targetDataItem of data.targetData) {
            const target = await tx.target.create({
              data: {
                assignedToId: leader.id, // Team target assigned to leader for tracking (use UUID)
                assignedById: createdById,
                type: targetDataItem.type,
                category: targetDataItem.category,
                description: targetDataItem.description,
                targetValue: targetDataItem.targetValue,
                currentValue: 0,
                startDate: targetDataItem.startDate,
                endDate: targetDataItem.endDate,
                teamId: team.id,
                isActive: true
              }
            });
            createdTargets.push(target);
          }
        }

        return { team, targets: createdTargets };
      });
    });

    return result;
  } catch (error) {
    console.error('Error creating team:', error);
    throw error;
  }
};

/**
 * Get team by ID with members and target
 */
export const getTeamById = async (teamId: string) => {
  try {
    const team = await withDbRetry(async () => {
      return await prisma.team.findUnique({
        where: { id: teamId },
        include: {
          leader: {
            select: {
              id: true,
              name: true,
              employeeId: true,
              role: true,
              employeeRoles: {
                where: { isActive: true },
                select: { role: true }
              }
            }
          },
          targets: {
            include: {
              progress: {
                orderBy: { date: 'desc' },
                take: 30
              }
            },
            where: { isActive: true },
            orderBy: { createdAt: 'desc' }
          },
          members: {
            where: { isActive: true },
            include: {
              employee: {
                select: {
                  id: true,
                  name: true,
                  employeeId: true,
                  role: true,
                  employeeRoles: {
                    where: { isActive: true },
                    select: { role: true }
                  }
                }
              }
            },
            orderBy: { joinedAt: 'desc' }
          }
        }
      });
    });

    return team;
  } catch (error) {
    console.error('Error fetching team:', error);
    throw error;
  }
};

/**
 * Get all teams for a leader
 */
export const getTeamsByLeader = async (leaderId: string) => {
  try {
    const teams = await withDbRetry(async () => {
      return await prisma.team.findMany({
        where: {
          leaderId: leaderId,
          isActive: true
        },
        include: {
          leader: {
            select: {
              id: true,
              name: true,
              employeeId: true,
              role: true,
              employeeRoles: {
                where: { isActive: true },
                select: { role: true }
              }
            }
          },
          targets: {
            where: { isActive: true },
            orderBy: { createdAt: 'desc' }
          },
          members: {
            where: { isActive: true },
            include: {
              employee: {
                select: {
                  id: true,
                  name: true,
                  employeeId: true,
                  role: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    });

    return teams;
  } catch (error) {
    console.error('Error fetching teams by leader:', error);
    throw error;
  }
};

/**
 * Get team for a member (enforces single team membership)
 */
export const getTeamByMember = async (employeeId: string) => {
  try {
    const teamMember = await withDbRetry(async () => {
      return await prisma.teamMember.findFirst({
        where: {
          employeeId: employeeId,
          isActive: true
        },
        include: {
          team: {
            include: {
              leader: {
                select: {
                  id: true,
                  name: true,
                  employeeId: true
                }
              },
              targets: {
                where: { isActive: true },
                orderBy: { createdAt: 'desc' }
              },
              members: {
                where: { isActive: true },
                include: {
                  employee: {
                    select: {
                      id: true,
                      name: true,
                      employeeId: true,
                      role: true
                    }
                  }
                }
              }
            }
          }
        }
      });
    });

    return teamMember?.team || null;
  } catch (error) {
    console.error('Error fetching team by member:', error);
    throw error;
  }
};

/**
 * Add member to team (validates single team membership)
 */
export const addTeamMember = async (teamId: string, employeeId: string) => {
  try {
    // Check if employee is already in a team
    const existingMembership = await withDbRetry(async () => {
      return await prisma.teamMember.findFirst({
        where: {
          employeeId: employeeId,
          isActive: true
        }
      });
    });

    if (existingMembership) {
      throw new Error('Employee is already a member of another team');
    }

    // Validate employee is sales or coordinator
    // Handle both UUID and employeeId (EMP009 format)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId);
    
    const employee = await withDbRetry(async () => {
      if (isUUID) {
        return await prisma.employee.findUnique({
          where: { id: employeeId },
          include: {
            employeeRoles: {
              where: { isActive: true },
              select: { role: true }
            }
          }
        });
      } else {
        return await prisma.employee.findFirst({
          where: { employeeId: employeeId },
          include: {
            employeeRoles: {
              where: { isActive: true },
              select: { role: true }
            }
          }
        });
      }
    });

    if (!employee) {
      throw new Error('Employee not found');
    }

    const employeeRoles = employee.employeeRoles?.map(er => er.role) || [];
    const isSalesOrCoordinator = employeeRoles.includes('sales') || employeeRoles.includes('coordinator');
    
    if (!isSalesOrCoordinator) {
      throw new Error('Only sales and coordinator employees can be team members');
    }

    // Check if employee is the team leader
    const team = await withDbRetry(async () => {
      return await prisma.team.findUnique({
        where: { id: teamId }
      });
    });

    if (!team) {
      throw new Error('Team not found');
    }

    // Use employee.id (UUID) for comparison and creation
    if (team.leaderId === employee.id) {
      throw new Error('Team leader cannot be added as a member');
    }

    // Add member
    const teamMember = await withDbRetry(async () => {
      return await prisma.teamMember.create({
        data: {
          teamId: teamId,
          employeeId: employee.id, // Use employee.id (UUID) instead of employeeId parameter
          isActive: true
        },
        include: {
          employee: {
            select: {
              id: true,
              name: true,
              employeeId: true,
              role: true
            }
          }
        }
      });
    });

    return teamMember;
  } catch (error) {
    console.error('Error adding team member:', error);
    throw error;
  }
};

/**
 * Remove member from team
 */
export const removeTeamMember = async (teamId: string, employeeId: string) => {
  try {
    const teamMember = await withDbRetry(async () => {
      return await prisma.teamMember.updateMany({
        where: {
          teamId: teamId,
          employeeId: employeeId
        },
        data: {
          isActive: false
        }
      });
    });

    return teamMember;
  } catch (error) {
    console.error('Error removing team member:', error);
    throw error;
  }
};

/**
 * Update team target(s) - can update existing by category or create new ones
 */
export const updateTeamTarget = async (teamId: string, targetData: Array<{
  type: 'daily' | 'weekly' | 'monthly';
  category: string;
  description: string;
  targetValue: number;
  startDate: Date;
  endDate: Date;
}> | {
  type: 'daily' | 'weekly' | 'monthly';
  category: string;
  description: string;
  targetValue: number;
  startDate: Date;
  endDate: Date;
}, assignedById: string) => {
  try {
    const team = await getTeamById(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    // Normalize to array
    const targetDataArray = Array.isArray(targetData) ? targetData : [targetData];

    const result = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const createdOrUpdatedTargets = [];

        for (const td of targetDataArray) {
          // Check if target with this category already exists for this team
          const existingTarget = await tx.target.findFirst({
            where: {
              teamId: teamId,
              category: td.category,
              isActive: true
            }
          });

          if (existingTarget) {
            // Update existing target
            const updated = await tx.target.update({
              where: { id: existingTarget.id },
              data: {
                type: td.type,
                description: td.description,
                targetValue: td.targetValue,
                startDate: td.startDate,
                endDate: td.endDate,
                updatedAt: new Date()
              }
            });
            createdOrUpdatedTargets.push(updated);
          } else {
            // Create new target
            const target = await tx.target.create({
              data: {
                assignedToId: team.leaderId,
                assignedById: assignedById,
                type: td.type,
                category: td.category,
                description: td.description,
                targetValue: td.targetValue,
                currentValue: 0,
                startDate: td.startDate,
                endDate: td.endDate,
                teamId: teamId,
                isActive: true
              }
            });
            createdOrUpdatedTargets.push(target);
          }
        }

        return createdOrUpdatedTargets.length === 1 ? createdOrUpdatedTargets[0] : createdOrUpdatedTargets;
      });
    });

    return result;
  } catch (error) {
    console.error('Error updating team target:', error);
    throw error;
  }
};

/**
 * Calculate team progress for a specific target category
 */
export const getTeamProgressByCategory = async (teamId: string, category: string, startDate?: Date, endDate?: Date) => {
  try {
    const team = await getTeamById(teamId);
    if (!team || !team.targets || team.targets.length === 0) {
      return { currentValue: 0, targetValue: 0, progress: 0, category };
    }

    // Find target with matching category
    const target = team.targets.find(t => t.category === category && t.isActive);
    if (!target) {
      return { currentValue: 0, targetValue: 0, progress: 0, category };
    }
    // Use UUIDs for member IDs (from employee.id, not employeeId)
    const memberUuids = team.members.map(m => m.employee.id);

    // Get leader's target for the same category and type
    const leaderTarget = await withDbRetry(async () => {
      return await prisma.target.findFirst({
        where: {
          assignedToId: team.leaderId,
          category: target.category,
          type: target.type,
          isActive: true,
          ...(startDate && endDate ? {
            startDate: { lte: endDate },
            endDate: { gte: startDate }
          } : {})
        }
      });
    });

    // Calculate leader's actual progress based on target category and role
    const leaderRoles = team.leader.employeeRoles?.map(er => er.role) || [];
    let leaderProgress = 0;
    if (leaderTarget) {
      if (target.category === 'new_patients' && leaderRoles.includes('sales')) {
        // Use actual new patient visits count for sales employees
        const { getActualNewPatientVisitsCount } = await import('../utils/newPatientVisits.utils');
        const leaderStartDate = startDate || leaderTarget.startDate;
        const leaderEndDate = endDate || leaderTarget.endDate;
        leaderProgress = await getActualNewPatientVisitsCount(team.leaderId, leaderStartDate, leaderEndDate);
      } else {
        // Use target's currentValue for other categories or non-sales
        leaderProgress = leaderTarget.currentValue || 0;
      }
    }

    // Calculate progress for all members (even if they don't have individual targets)
    let totalCurrentValue = leaderProgress;
    const teamStartDate = startDate || target.startDate;
    const teamEndDate = endDate || target.endDate;
    
    for (const member of team.members) {
      const memberRoles = member.employee.employeeRoles?.map(er => er.role) || [];
      let memberProgress = 0;
      
      if (target.category === 'new_patients' && memberRoles.includes('sales')) {
        // Use actual new patient visits count for sales employees
        const { getActualNewPatientVisitsCount } = await import('../utils/newPatientVisits.utils');
        memberProgress = await getActualNewPatientVisitsCount(member.employee.id, teamStartDate, teamEndDate);
      } else {
        // For members without individual targets or non-sales, calculate from commissions
        switch (target.category) {
          case 'new_patients':
            memberProgress = await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: member.employee.id,
                  type: 'PATIENT_CREATION',
                  createdAt: {
                    gte: teamStartDate,
                    lte: teamEndDate
                  }
                }
              });
            });
            break;
          case 'follow_up_patients':
            memberProgress = await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: member.employee.id,
                  type: 'FOLLOW_UP',
                  createdAt: {
                    gte: teamStartDate,
                    lte: teamEndDate
                  }
                }
              });
            });
            break;
          case 'specialties':
            memberProgress = await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: member.employee.id,
                  type: 'VISIT_SPECIALITY_ADDITION',
                  createdAt: {
                    gte: teamStartDate,
                    lte: teamEndDate
                  }
                }
              });
            });
            break;
          case 'nominations':
            memberProgress = await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: member.employee.id,
                  type: 'NOMINATION_CONVERSION',
                  createdAt: {
                    gte: teamStartDate,
                    lte: teamEndDate
                  }
                }
              });
            });
            break;
          default:
            memberProgress = 0;
        }
      }
      
      totalCurrentValue += memberProgress;
    }

    // Update team target currentValue
    await withDbRetry(async () => {
      await prisma.target.update({
        where: { id: target.id },
        data: { currentValue: totalCurrentValue }
      });
    });

    const progress = target.targetValue > 0 
      ? (totalCurrentValue / target.targetValue) * 100 
      : 0;

    return {
      currentValue: totalCurrentValue,
      targetValue: target.targetValue,
      progress: Math.min(progress, 100),
      category: target.category
    };
  } catch (error) {
    console.error('Error calculating team progress by category:', error);
    throw error;
  }
};

/**
 * Calculate team progress for all target categories
 */
export const getAllTeamProgress = async (teamId: string, startDate?: Date, endDate?: Date) => {
  try {
    const team = await getTeamById(teamId);
    if (!team || !team.targets || team.targets.length === 0) {
      return [];
    }

    const results = [];
    for (const target of team.targets.filter(t => t.isActive)) {
      const progress = await getTeamProgressByCategory(teamId, target.category, startDate, endDate);
      results.push(progress);
    }

    return results;
  } catch (error) {
    console.error('Error calculating all team progress:', error);
    throw error;
  }
};

/**
 * Calculate team progress - backward compatible, uses first active target or specific category
 */
export const getTeamProgress = async (teamId: string, startDate?: Date, endDate?: Date, category?: string) => {
  try {
    if (category) {
      return await getTeamProgressByCategory(teamId, category, startDate, endDate);
    }

    const team = await getTeamById(teamId);
    if (!team || !team.targets || team.targets.length === 0) {
      return { currentValue: 0, targetValue: 0, progress: 0 };
    }

    // For backward compatibility, use the first active target
    const target = team.targets.find(t => t.isActive) || team.targets[0];
    return await getTeamProgressByCategory(teamId, target.category, startDate, endDate);
  } catch (error) {
    console.error('Error calculating team progress:', error);
    throw error;
  }
};

/**
 * Get team appointments with pagination and filters
 */
export const getTeamAppointments = async (teamId: string, filters?: {
  status?: string;
  startDate?: Date;
  endDate?: Date;
  memberId?: string;
  role?: 'sales' | 'coordinator';
  patientType?: 'new' | 'existing' | 'follow-up';
  page?: number;
  limit?: number;
}) => {
  try {
    const team = await getTeamById(teamId);
    if (!team) {
      return { appointments: [], total: 0, page: 1, limit: 20, pages: 0 };
    }

    // Get all member IDs
    const allMemberIds = team.members.map(m => m.employeeId);
    const leaderId = team.leaderId;
    const allMemberIdsIncludingLeader = [...allMemberIds, leaderId];

    // Get sales member IDs
    const salesMemberIds = team.members
      .filter(m => {
        const roles = m.employee.employeeRoles?.map(er => er.role) || [];
        return roles.includes('sales');
      })
      .map(m => m.employeeId);
    
    // Get coordinator member IDs (including leader if they have coordinator role)
    const coordinatorMemberIds: string[] = [];
    if (team.leader.employeeRoles?.some(er => er.role === 'coordinator')) {
      coordinatorMemberIds.push(leaderId);
    }
    team.members.forEach(m => {
      const roles = m.employee.employeeRoles?.map(er => er.role) || [];
      if (roles.includes('coordinator')) {
        coordinatorMemberIds.push(m.employeeId);
      }
    });

    // Determine which member IDs to use based on role filter
    let memberIds: string[] = [];
    if (filters?.memberId) {
      // If memberId is specified, check if they're in the team and include them
      // regardless of role (they might have both sales and coordinator roles)
      if (allMemberIdsIncludingLeader.includes(filters.memberId)) {
        memberIds = [filters.memberId];
      } else {
        return { appointments: [], total: 0, page: filters?.page || 1, limit: filters?.limit || 20, pages: 0 };
      }
    } else if (filters?.role === 'sales') {
      memberIds = salesMemberIds;
    } else if (filters?.role === 'coordinator') {
      memberIds = coordinatorMemberIds;
    } else {
      // No role filter and no memberId - use all members
      memberIds = allMemberIdsIncludingLeader;
    }

    if (memberIds.length === 0) {
      return { appointments: [], total: 0, page: filters?.page || 1, limit: filters?.limit || 20, pages: 0 };
    }

    // Build where clause based on role
    const whereClause: any = {};
    
    if (filters?.memberId) {
      // When filtering by specific member, include both sales and coordinator relations
      // (member might have both roles)
      whereClause.OR = [
        { salesPersonId: { in: memberIds } },
        { createdById: { in: memberIds } }
      ];
    } else if (filters?.role === 'sales') {
      whereClause.salesPersonId = { in: memberIds };
    } else if (filters?.role === 'coordinator') {
      whereClause.createdById = { in: memberIds };
    } else {
      // No role filter - include both sales and coordinator relations
      whereClause.OR = [
        { salesPersonId: { in: memberIds } },
        { createdById: { in: memberIds } }
      ];
    }

    if (filters?.status) {
      whereClause.status = filters.status;
    }

    if (filters?.startDate || filters?.endDate) {
      whereClause.scheduledDate = {};
      if (filters.startDate) {
        whereClause.scheduledDate.gte = filters.startDate;
      }
      if (filters.endDate) {
        whereClause.scheduledDate.lte = filters.endDate;
      }
    }

    // Patient type filter
    if (filters?.patientType === 'new') {
      whereClause.isNewPatientAtCreation = true;
    } else if (filters?.patientType === 'existing') {
      whereClause.isNewPatientAtCreation = false;
      whereClause.createdFromFollowUpTaskId = null;
    } else if (filters?.patientType === 'follow-up') {
      whereClause.createdFromFollowUpTaskId = { not: null };
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    // Get total count
    const total = await withDbRetry(async () => {
      return await prisma.appointment.count({ where: whereClause });
    });

    const appointments = await withDbRetry(async () => {
      return await prisma.appointment.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true
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
        orderBy: { scheduledDate: 'desc' }
      });
    });

    const pages = Math.ceil(total / limit);

    return {
      appointments,
      total,
      page,
      limit,
      pages
    };
  } catch (error) {
    console.error('Error fetching team appointments:', error);
    throw error;
  }
};

/**
 * Get team visits with pagination and filters
 */
export const getTeamVisits = async (teamId: string, filters?: {
  startDate?: Date;
  endDate?: Date;
  memberId?: string;
  role?: 'sales' | 'coordinator';
  patientType?: 'new' | 'existing' | 'follow-up';
  page?: number;
  limit?: number;
}) => {
  try {
    const team = await getTeamById(teamId);
    if (!team) {
      return { visits: [], total: 0, page: 1, limit: 20, pages: 0 };
    }

    // Get all member IDs including leader
    const allMemberIds = team.members.map(m => m.employeeId);
    const leaderId = team.leaderId;
    const allMemberIdsIncludingLeader = [...allMemberIds, leaderId];

    // Filter by member if specified
    let memberIds: string[] = [];
    if (filters?.memberId) {
      if (allMemberIdsIncludingLeader.includes(filters.memberId)) {
        memberIds = [filters.memberId];
      } else {
        return { visits: [], total: 0, page: filters?.page || 1, limit: filters?.limit || 20, pages: 0 };
      }
    } else {
      memberIds = allMemberIdsIncludingLeader;
    }

    if (memberIds.length === 0) {
      return { visits: [], total: 0, page: filters?.page || 1, limit: filters?.limit || 20, pages: 0 };
    }

    // Special handling for sales + new patient filter - use same logic as sales performance page
    if (filters?.role === 'sales' && filters?.patientType === 'new') {
      // Get all sales member IDs (including leader if they have sales role)
      const salesMemberIds: string[] = [];
      if (team.leader.employeeRoles?.some(er => er.role === 'sales')) {
        salesMemberIds.push(leaderId);
      }
      team.members.forEach(m => {
        const roles = m.employee.employeeRoles?.map(er => er.role) || [];
        if (roles.includes('sales')) {
          salesMemberIds.push(m.employeeId);
        }
      });

      // Filter by member if specified
      const filteredSalesMemberIds = filters?.memberId
        ? (salesMemberIds.includes(filters.memberId) ? [filters.memberId] : [])
        : salesMemberIds;

      if (filteredSalesMemberIds.length === 0) {
        return { visits: [], total: 0, page: filters?.page || 1, limit: filters?.limit || 20, pages: 0 };
      }

      // Use getActualNewPatientVisits for each sales member to get correct visit IDs
      const { getActualNewPatientVisits } = await import('../utils/newPatientVisits.utils');
      const allNewPatientVisitIds = new Set<string>();
      
      for (const salesMemberId of filteredSalesMemberIds) {
        const visitIds = await getActualNewPatientVisits(
          salesMemberId,
          filters?.startDate,
          filters?.endDate
        );
        visitIds.forEach(id => allNewPatientVisitIds.add(id));
      }

      if (allNewPatientVisitIds.size === 0) {
        return { visits: [], total: 0, page: filters?.page || 1, limit: filters?.limit || 20, pages: 0 };
      }

      const page = filters?.page || 1;
      const limit = filters?.limit || 20;
      const skip = (page - 1) * limit;
      const visitIdsArray = Array.from(allNewPatientVisitIds);

      // Get total count
      const total = visitIdsArray.length;

      // Get visits by IDs with pagination
      const visits = await withDbRetry(async () => {
        return await prisma.visit.findMany({
          where: {
            id: { in: visitIdsArray }
          },
          skip,
          take: limit,
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nameArabic: true,
                nationalId: true
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
                employeeId: true
              }
            },
            sales: {
              select: {
                id: true,
                name: true,
                employeeId: true
              }
            },
            appointments: {
              select: {
                id: true,
                isNewPatientAtCreation: true,
                createdFromFollowUpTaskId: true
              },
              take: 1,
              orderBy: { createdAt: 'desc' }
            },
            visitSpecialities: {
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
          orderBy: { visitDate: 'desc' }
        });
      });

      const pages = Math.ceil(total / limit);

      return {
        visits,
        total,
        page,
        limit,
        pages
      };
    }

    // Build where clause based on role (for non-sales-new-patient cases)
    const whereClause: any = {};
    
    if (filters?.memberId) {
      // When filtering by specific member, include both sales and coordinator relations
      // (member might have both roles)
      whereClause.OR = [
        { coordinatorId: { in: memberIds } },
        { salesId: { in: memberIds } }
      ];
    } else if (filters?.role === 'sales') {
      whereClause.salesId = { in: memberIds };
    } else if (filters?.role === 'coordinator') {
      whereClause.coordinatorId = { in: memberIds };
    } else {
      // No role filter - include both sales and coordinator relations
      whereClause.OR = [
        { coordinatorId: { in: memberIds } },
        { salesId: { in: memberIds } }
      ];
    }

    if (filters?.startDate || filters?.endDate) {
      whereClause.visitDate = {};
      if (filters.startDate) {
        whereClause.visitDate.gte = filters.startDate;
      }
      if (filters.endDate) {
        whereClause.visitDate.lte = filters.endDate;
      }
    }

    // Patient type filter - need to check related appointments
    if (filters?.patientType) {
      whereClause.appointments = {};
      if (filters.patientType === 'new') {
        whereClause.appointments.some = { isNewPatientAtCreation: true };
      } else if (filters.patientType === 'existing') {
        whereClause.appointments.some = {
          isNewPatientAtCreation: false,
          createdFromFollowUpTaskId: null
        };
      } else if (filters.patientType === 'follow-up') {
        whereClause.appointments.some = {
          createdFromFollowUpTaskId: { not: null }
        };
      }
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    // Get total count
    const total = await withDbRetry(async () => {
      return await prisma.visit.count({ where: whereClause });
    });

    const visits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true
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
              employeeId: true
            }
          },
          sales: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          appointments: {
            select: {
              id: true,
              isNewPatientAtCreation: true,
              createdFromFollowUpTaskId: true
            },
            take: 1,
            orderBy: { createdAt: 'desc' }
          },
          visitSpecialities: {
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
        orderBy: { visitDate: 'desc' }
      });
    });

    const pages = Math.ceil(total / limit);

    return {
      visits,
      total,
      page,
      limit,
      pages
    };
  } catch (error) {
    console.error('Error fetching team visits:', error);
    throw error;
  }
};

/**
 * Get individual progress for each team member
 */
export const getTeamMembersProgress = async (teamId: string, startDate?: Date, endDate?: Date): Promise<TeamMemberProgress[]> => {
  try {
    const team = await getTeamById(teamId);
    if (!team || !team.targets || team.targets.length === 0) {
      return [];
    }

    // Use the first active target for members progress (backward compatibility)
    // In the future, this could be made category-specific
    const target = team.targets.find(t => t.isActive) || team.targets[0];
    if (!target) {
      return [];
    }
    const memberProgress: TeamMemberProgress[] = [];

    // Get leader's target and add as first entry
    const leaderTarget = await withDbRetry(async () => {
      return await prisma.target.findFirst({
        where: {
          assignedToId: team.leaderId,
          category: target.category,
          type: target.type,
          isActive: true,
          ...(startDate && endDate ? {
            startDate: { lte: endDate },
            endDate: { gte: startDate }
          } : {})
        }
      });
    });

    const leaderRoles = team.leader.employeeRoles?.map(er => er.role) || [];
    const leaderPrimaryRole = leaderRoles[0] || team.leader.role;
    const leaderAllRoles = leaderRoles.length > 0 ? leaderRoles : (team.leader.role ? [team.leader.role] : []);

    // Calculate leader's actual progress based on target category and role
    let leaderProgress = 0;
    if (leaderTarget) {
      if (target.category === 'new_patients' && leaderRoles.includes('sales')) {
        // Use actual new patient visits count for sales employees
        const { getActualNewPatientVisitsCount } = await import('../utils/newPatientVisits.utils');
        const leaderStartDate = startDate || leaderTarget.startDate;
        const leaderEndDate = endDate || leaderTarget.endDate;
        leaderProgress = await getActualNewPatientVisitsCount(team.leaderId, leaderStartDate, leaderEndDate);
      } else {
        // Use target's currentValue for other categories or non-sales
        leaderProgress = leaderTarget.currentValue || 0;
      }
    }

    // Add leader as first entry
    memberProgress.push({
      employeeId: team.leader.employeeId || team.leader.id, // Fallback to UUID if employeeId is null
      employeeName: team.leader.name,
      role: leaderAllRoles.join(', '), // Show all roles
      progress: leaderProgress,
      targetValue: leaderTarget?.targetValue
    });

    // Add members
    for (const member of team.members) {
      // Get member's target for the same category and type
      const memberTarget = await withDbRetry(async () => {
        return await prisma.target.findFirst({
          where: {
            assignedToId: member.employee.id, // Use UUID, not employeeId
            category: target.category,
            type: target.type,
            isActive: true,
            ...(startDate && endDate ? {
              startDate: { lte: endDate },
              endDate: { gte: startDate }
            } : {})
          }
        });
      });

      const roles = member.employee.employeeRoles?.map(er => er.role) || [];
      const allRoles = roles.length > 0 ? roles : (member.employee.role ? [member.employee.role] : []);

      // Calculate member's actual progress based on target category and role
      // Calculate progress even if member doesn't have an individual target
      let memberActualProgress = 0;
      
      // Use team target's date range if member doesn't have individual target
      const memberStartDate = startDate || (memberTarget?.startDate || target.startDate);
      const memberEndDate = endDate || (memberTarget?.endDate || target.endDate);
      
      if (target.category === 'new_patients' && roles.includes('sales')) {
        // Use actual new patient visits count for sales employees
        const { getActualNewPatientVisitsCount } = await import('../utils/newPatientVisits.utils');
        memberActualProgress = await getActualNewPatientVisitsCount(member.employee.id, memberStartDate, memberEndDate);
      } else if (memberTarget) {
        // If member has a target, use its currentValue
        memberActualProgress = memberTarget.currentValue || 0;
      } else {
        // Calculate progress from commissions if no individual target exists
        switch (target.category) {
          case 'new_patients':
            // For non-sales or when no target, count PATIENT_CREATION commissions
            memberActualProgress = await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: member.employee.id,
                  type: 'PATIENT_CREATION',
                  createdAt: {
                    gte: memberStartDate,
                    lte: memberEndDate
                  }
                }
              });
            });
            break;
          case 'follow_up_patients':
            memberActualProgress = await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: member.employee.id,
                  type: 'FOLLOW_UP',
                  createdAt: {
                    gte: memberStartDate,
                    lte: memberEndDate
                  }
                }
              });
            });
            break;
          case 'specialties':
            memberActualProgress = await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: member.employee.id,
                  type: 'VISIT_SPECIALITY_ADDITION',
                  createdAt: {
                    gte: memberStartDate,
                    lte: memberEndDate
                  }
                }
              });
            });
            break;
          case 'nominations':
            memberActualProgress = await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: member.employee.id,
                  type: 'NOMINATION_CONVERSION',
                  createdAt: {
                    gte: memberStartDate,
                    lte: memberEndDate
                  }
                }
              });
            });
            break;
          default:
            memberActualProgress = 0;
        }
      }

      memberProgress.push({
        employeeId: member.employee.employeeId || member.employee.id, // Fallback to UUID if employeeId is null
        employeeName: member.employee.name,
        role: allRoles.join(', '), // Show all roles
        progress: memberActualProgress,
        targetValue: memberTarget?.targetValue
      });
    }

    return memberProgress;
  } catch (error) {
    console.error('Error fetching team members progress:', error);
    throw error;
  }
};

/**
 * Get all teams (for admin)
 */
export const getAllTeams = async () => {
  try {
    const teams = await withDbRetry(async () => {
      return await prisma.team.findMany({
        where: { isActive: true },
        include: {
          leader: {
            select: {
              id: true,
              name: true,
              employeeId: true,
              role: true,
              employeeRoles: {
                where: { isActive: true },
                select: { role: true }
              }
            }
          },
          targets: {
            where: { isActive: true },
            orderBy: { createdAt: 'desc' }
          },
          members: {
            where: { isActive: true },
            include: {
              employee: {
                select: {
                  id: true,
                  name: true,
                  employeeId: true,
                  role: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    });

    return teams;
  } catch (error) {
    console.error('Error fetching all teams:', error);
    throw error;
  }
};

/**
 * Helper function to update leader name format
 */
const updateLeaderName = async (leaderId: string, teamName: string, originalName: string) => {
  await withDbRetry(async () => {
    await prisma.employee.update({
      where: { id: leaderId },
      data: { name: `${teamName} ${originalName}` }
    });
  });
};

/**
 * Helper function to restore leader's original name
 */
const restoreLeaderName = async (leaderId: string, originalName: string) => {
  await withDbRetry(async () => {
    await prisma.employee.update({
      where: { id: leaderId },
      data: { name: originalName }
    });
  });
};

/**
 * Update team
 */
export const updateTeam = async (teamId: string, data: { name?: string; leaderId?: string; isActive?: boolean }) => {
  try {
    const result = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const existingTeam = await tx.team.findUnique({
          where: { id: teamId },
          include: { leader: true }
        });

        if (!existingTeam) {
          throw new Error('Team not found');
        }

        // Handle leader change
        if (data.leaderId && data.leaderId !== existingTeam.leaderId) {
          // Validate new leader
          // Handle both UUID and employeeId (EMP009 format)
          const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.leaderId);
          
          const newLeader = isUUID
            ? await tx.employee.findUnique({
                where: { id: data.leaderId },
                include: {
                  employeeRoles: {
                    where: { isActive: true },
                    select: { role: true }
                  }
                }
              })
            : await tx.employee.findFirst({
                where: { employeeId: data.leaderId },
                include: {
                  employeeRoles: {
                    where: { isActive: true },
                    select: { role: true }
                  }
                }
              });

          if (!newLeader) {
            throw new Error('New leader not found');
          }

          const leaderRoles = newLeader.employeeRoles?.map(er => er.role) || [];
          const isSalesOrCoordinator = leaderRoles.includes('sales') || leaderRoles.includes('coordinator');
          
          if (!isSalesOrCoordinator) {
            throw new Error('Team leader must be a sales person or coordinator');
          }

          // Check if new leader is already a team member (use UUID)
          const existingMembership = await tx.teamMember.findFirst({
            where: {
              employeeId: newLeader.id, // Use newLeader.id (UUID) instead of data.leaderId
              isActive: true
            }
          });

          if (existingMembership) {
            throw new Error('New leader is already a member of another team');
          }

          // Restore old leader's original name
          if (existingTeam.leaderOriginalName) {
            await restoreLeaderName(existingTeam.leaderId, existingTeam.leaderOriginalName);
          }

          // Save new leader's original name and update name format
          const newLeaderOriginalName = newLeader.name;
          const teamName = data.name || existingTeam.name;
          await updateLeaderName(newLeader.id, teamName, newLeaderOriginalName); // Use newLeader.id (UUID)

          // Update team with new leader
          const updatedTeam = await tx.team.update({
            where: { id: teamId },
            data: {
              ...(data.name && { name: data.name }),
              leaderId: newLeader.id, // Use newLeader.id (UUID) instead of data.leaderId
              leaderOriginalName: newLeaderOriginalName,
              ...(data.isActive !== undefined && { isActive: data.isActive })
            }
          });

          return updatedTeam;
        } else if (data.name && data.name !== existingTeam.name) {
          // If only team name changed, update leader's name format
          if (existingTeam.leaderOriginalName) {
            await updateLeaderName(existingTeam.leaderId, data.name, existingTeam.leaderOriginalName);
          }

          return await tx.team.update({
            where: { id: teamId },
            data: {
              name: data.name,
              ...(data.isActive !== undefined && { isActive: data.isActive })
            }
          });
        } else {
          // Just update isActive or other fields
          return await tx.team.update({
            where: { id: teamId },
            data: {
              ...(data.isActive !== undefined && { isActive: data.isActive })
            }
          });
        }
      });
    });

    return result;
  } catch (error) {
    console.error('Error updating team:', error);
    throw error;
  }
};

/**
 * Get teams analysis for admin dashboard
 */
export const getTeamsAnalysis = async (month?: number, year?: number) => {
  try {
    const teams = await getAllTeams();
    const analysis = [];

    // Calculate date range if month/year provided
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    if (month && year) {
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0, 23, 59, 59, 999);
    }

    for (const team of teams) {
      // Get all targets for the team
      const targets = team.targets || [];
      
      // Get members progress (same for all targets)
      const membersProgress = targets.length > 0 ? await getTeamMembersProgress(team.id, startDate, endDate) : [];

      // Calculate statistics (same for all targets)
      const totalMembers = (team.members?.length || 0) + 1; // +1 for leader
      const averageProgress = membersProgress.length > 0
        ? membersProgress.reduce((sum, m) => sum + m.progress, 0) / membersProgress.length
        : 0;

      // Count members by role
      const salesCount = membersProgress.filter(m => m.role.includes('sales')).length;
      const coordinatorCount = membersProgress.filter(m => m.role.includes('coordinator')).length;

      // Process each target separately
      if (targets.length === 0) {
        // Team with no targets
        analysis.push({
          teamId: team.id,
          teamName: team.name,
          leaderName: team.leader?.name || 'Unknown',
          totalMembers,
          salesCount,
          coordinatorCount,
          targetCategory: 'N/A',
          targetValue: 0,
          currentValue: 0,
          completionRate: 0,
          averageProgress: Math.round(averageProgress * 100) / 100,
          status: 'not_started'
        });
      } else {
        // Create one entry per target category
        for (const target of targets.filter(t => t.isActive)) {
          const progress = await getTeamProgressByCategory(team.id, target.category, startDate, endDate);
          
          const completionRate = progress && progress.targetValue > 0
            ? Math.min((progress.currentValue / progress.targetValue) * 100, 100)
            : 0;

          analysis.push({
            teamId: team.id,
            teamName: team.name,
            leaderName: team.leader?.name || 'Unknown',
            totalMembers,
            salesCount,
            coordinatorCount,
            targetCategory: target.category || 'N/A',
            targetValue: progress?.targetValue || 0,
            currentValue: progress?.currentValue || 0,
            completionRate: Math.round(completionRate * 100) / 100,
            averageProgress: Math.round(averageProgress * 100) / 100,
            status: completionRate >= 100 ? 'completed' : completionRate > 0 ? 'in_progress' : 'not_started'
          });
        }
      }
    }

    // Sort by completion rate (descending)
    analysis.sort((a, b) => b.completionRate - a.completionRate);

    // Calculate overall statistics
    const totalTeams = analysis.length;
    const totalMembers = analysis.reduce((sum, a) => sum + a.totalMembers, 0);
    const totalTargetValue = analysis.reduce((sum, a) => sum + a.targetValue, 0);
    const totalCurrentValue = analysis.reduce((sum, a) => sum + a.currentValue, 0);
    const overallCompletionRate = totalTargetValue > 0
      ? Math.min((totalCurrentValue / totalTargetValue) * 100, 100)
      : 0;
    const completedTeams = analysis.filter(a => a.status === 'completed').length;
    const inProgressTeams = analysis.filter(a => a.status === 'in_progress').length;
    const notStartedTeams = analysis.filter(a => a.status === 'not_started').length;

    return {
      teams: analysis,
      summary: {
        totalTeams,
        totalMembers,
        totalTargetValue,
        totalCurrentValue,
        overallCompletionRate: Math.round(overallCompletionRate * 100) / 100,
        completedTeams,
        inProgressTeams,
        notStartedTeams
      }
    };
  } catch (error) {
    console.error('Error fetching teams analysis:', error);
    throw error;
  }
};

/**
 * Delete team (soft delete)
 */
export const deleteTeam = async (teamId: string) => {
  try {
    const result = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId }
        });

        if (!team) {
          throw new Error('Team not found');
        }

        // Restore leader's original name
        if (team.leaderOriginalName) {
          await restoreLeaderName(team.leaderId, team.leaderOriginalName);
        }

        // Soft delete team
        return await tx.team.update({
          where: { id: teamId },
          data: { isActive: false }
        });
      });
    });

    return result;
  } catch (error) {
    console.error('Error deleting team:', error);
    throw error;
  }
};
