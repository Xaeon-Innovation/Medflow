import { prisma } from '../utils/database.utils';
import { withDbRetry } from '../utils/database.utils';
// import dayjs from 'dayjs'; // Removed as it's not installed

export interface TargetStats {
  totalTargets: number;
  activeTargets: number;
  completedTargets: number;
  overdueTargets: number;
  totalProgress: number;
  averageProgress: number;
}

export interface TargetProgressData {
  targetId: string;
  date: string;
  progress: number;
  notes?: string;
}

export interface CreateTargetData {
  assignedToId: string;
  assignedById: string;
  type: 'daily' | 'weekly' | 'monthly';
  category: 'new_patients' | 'follow_up_patients' | 'specialties' | 'nominations' | 'custom';
  description: string;
  targetValue: number;
  startDate: Date;
  endDate: Date;
}

// Create a new target
export const createTarget = async (data: CreateTargetData) => {
  try {
    const target = await withDbRetry(async () => {
      return await prisma.target.create({
        data: {
          assignedToId: data.assignedToId,
          assignedById: data.assignedById,
          type: data.type,
          category: data.category,
          description: data.description,
          targetValue: data.targetValue,
          currentValue: 0,
          startDate: data.startDate,
          endDate: data.endDate,
          isActive: true,
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              role: true,
            }
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
            }
          }
        }
      });
    });

    return target;
  } catch (error) {
    console.error('Error creating target:', error);
    throw error;
  }
};

// Get targets for an employee
export const getEmployeeTargets = async (employeeId: string, type?: string, category?: string) => {
  try {
    const targets = await withDbRetry(async () => {
      return await prisma.target.findMany({
        where: {
          assignedToId: employeeId,
          isActive: true,
          ...(type && { type: type as any }),
          ...(category && { category }),
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              role: true,
            }
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
            }
          },
          progress: {
            orderBy: {
              date: 'desc'
            },
            take: 30 // Last 30 days of progress
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });

    return targets;
  } catch (error) {
    console.error('Error fetching employee targets:', error);
    throw error;
  }
};

// Get all targets with filtering
export const getAllTargets = async (filters: {
  type?: string;
  category?: string;
  employeeId?: string;
  isActive?: boolean;
}) => {
  try {
    const targets = await withDbRetry(async () => {
      return await prisma.target.findMany({
        where: {
          ...(filters.type && { type: filters.type as any }),
          ...(filters.category && { category: filters.category }),
          ...(filters.employeeId && { assignedToId: filters.employeeId }),
          ...(filters.isActive !== undefined && { isActive: filters.isActive }),
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              role: true,
            }
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
            }
          },
          progress: {
            orderBy: {
              date: 'desc'
            },
            take: 7 // Last 7 days of progress
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });

    // Recalculate progress for each target to ensure it's up-to-date
    // Use the calculateTargetProgress function defined in this file
    console.log(`[Target Management] Recalculating progress for ${targets.length} targets`);
    const targetsWithUpdatedProgress = await Promise.all(
      targets.map(async (target) => {
        try {
          // Calculate progress directly without updating the database (for performance)
          // We'll update the database values separately if needed
          let progress = 0;
          
          // Parse dates carefully - Prisma stores dates in UTC
          // We need to ensure we're comparing dates correctly
          // Extract the date part and create new Date objects to avoid timezone issues
          const startDate = new Date(target.startDate);
          // Set to start of day in UTC to ensure consistent comparison
          startDate.setUTCHours(0, 0, 0, 0);
          const endDate = new Date(target.endDate);
          // Set to end of day in UTC to ensure consistent comparison
          endDate.setUTCHours(23, 59, 59, 999);
          
          console.log(`[Target Progress] Calculating for target ${target.id} (${target.description}):`, {
            category: target.category,
            employeeId: target.assignedToId,
            employeeName: target.assignedTo?.name,
            dateRange: `${startDate.toISOString()} to ${endDate.toISOString()}`
          });
          

          switch (target.category) {
            case 'new_patients':
              // For sales employees, use actual new patient visits count instead of all PATIENT_CREATION commissions
              // Check if employee is a sales person
              const employee = await withDbRetry(async () => {
                return await prisma.employee.findUnique({
                  where: { id: target.assignedToId },
                  include: {
                    employeeRoles: {
                      where: { isActive: true },
                      select: { role: true }
                    }
                  }
                });
              });
              
              const employeeRoles = employee?.employeeRoles?.map(er => er.role) || [];
              const isSales = employeeRoles.includes('sales');
              
              if (isSales) {
                // Use helper function to get actual new patient visits count
                const { getActualNewPatientVisitsCount } = await import('../utils/newPatientVisits.utils');
                progress = await getActualNewPatientVisitsCount(target.assignedToId, startDate, endDate);
                console.log(`[Target Progress] Target ${target.id} (${target.description}) for ${target.assignedTo?.name}:`, {
                  category: target.category,
                  targetEmployeeId: target.assignedToId,
                  dateRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
                  matchingCount: progress,
                  isSales: isSales,
                  usingActualVisits: true
                });
              } else {
                // For non-sales employees, use commission count (shouldn't happen for new_patients, but fallback)
                progress = await withDbRetry(async () => {
                  return await prisma.commission.count({
                    where: {
                      employeeId: target.assignedToId,
                      type: 'PATIENT_CREATION',
                      createdAt: {
                        gte: startDate,
                        lte: endDate
                      }
                    }
                  });
                });
                console.log(`[Target Progress] Target ${target.id} (${target.description}) for ${target.assignedTo?.name}:`, {
                  category: target.category,
                  targetEmployeeId: target.assignedToId,
                  dateRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
                  matchingCount: progress,
                  isSales: isSales,
                  usingActualVisits: false
                });
              }
              break;
            case 'follow_up_patients':
              progress = await withDbRetry(async () => {
                return await prisma.commission.count({
                  where: {
                    employeeId: target.assignedToId,
                    type: 'FOLLOW_UP',
                    createdAt: {
                      gte: startDate,
                      lte: endDate
                    }
                  }
                });
              });
              break;
            case 'specialties':
              progress = await withDbRetry(async () => {
                return await prisma.commission.count({
                  where: {
                    employeeId: target.assignedToId,
                    type: 'VISIT_SPECIALITY_ADDITION',
                    createdAt: {
                      gte: startDate,
                      lte: endDate
                    }
                  }
                });
              });
              break;
            case 'nominations':
              progress = await withDbRetry(async () => {
                return await prisma.commission.count({
                  where: {
                    employeeId: target.assignedToId,
                    type: 'NOMINATION_CONVERSION',
                    createdAt: {
                      gte: startDate,
                      lte: endDate
                    }
                  }
                });
              });
              break;
            case 'custom':
              progress = target.currentValue;
              break;
          }

          // Update the target's currentValue in the database if it's different
          if (progress !== target.currentValue) {
            await withDbRetry(async () => {
              await prisma.target.update({
                where: { id: target.id },
                data: {
                  currentValue: progress,
                  updatedAt: new Date(),
                  ...(progress >= target.targetValue && !target.completedAt && {
                    completedAt: new Date()
                  })
                }
              });
            });
          }

          // Return target with calculated currentValue
          return {
            ...target,
            currentValue: progress
          };
        } catch (error) {
          console.error(`Error calculating progress for target ${target.id}:`, error);
          // Return target with existing currentValue if calculation fails
          return target;
        }
      })
    );

    return targetsWithUpdatedProgress;
  } catch (error) {
    console.error('Error fetching targets:', error);
    throw error;
  }
};

// Update target progress
export const updateTargetProgress = async (targetId: string, progress: number, notes?: string) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get target first to check if it's a team member's target
    const targetBeforeUpdate = await withDbRetry(async () => {
      return await prisma.target.findUnique({
        where: { id: targetId }
      });
    });

    if (!targetBeforeUpdate) {
      throw new Error('Target not found');
    }
    
    // Update or create progress record for today
    const targetProgress = await withDbRetry(async () => {
      return await prisma.targetProgress.upsert({
        where: {
          targetId_date: {
            targetId,
            date: today
          }
        },
        update: {
          progress,
          notes,
          updatedAt: new Date()
        },
        create: {
          targetId,
          date: today,
          progress,
          notes
        }
      });
    });

    // Update target current value
    const target = await withDbRetry(async () => {
      return await prisma.target.update({
        where: { id: targetId },
        data: {
          currentValue: progress,
          updatedAt: new Date(),
          ...(progress >= targetBeforeUpdate.targetValue && {
            completedAt: new Date()
          })
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              role: true,
            }
          }
        }
      });
    });

    // If this target belongs to a team member, update team target
    await updateTeamTargetIfMember(targetBeforeUpdate.assignedToId, targetBeforeUpdate.category, targetBeforeUpdate.type);

    return { target, progress: targetProgress };
  } catch (error) {
    console.error('Error updating target progress:', error);
    throw error;
  }
};

// Get target statistics
export const getTargetStats = async (employeeId?: string) => {
  try {
    const whereClause = employeeId ? { assignedToId: employeeId } : {};
    
    const stats = await withDbRetry(async () => {
      const targets = await prisma.target.findMany({
        where: whereClause,
        select: {
          id: true,
          targetValue: true,
          currentValue: true,
          endDate: true,
          isActive: true,
          completedAt: true
        }
      });

      const totalTargets = targets.length;
      const activeTargets = targets.filter(t => t.isActive && !t.completedAt).length;
      const completedTargets = targets.filter(t => t.completedAt).length;
      const overdueTargets = targets.filter(t => 
        t.isActive && 
        !t.completedAt && 
        new Date() > t.endDate
      ).length;
      
      const totalProgress = targets.reduce((sum, t) => sum + t.currentValue, 0);
      const totalTargetValue = targets.reduce((sum, t) => sum + t.targetValue, 0);
      const averageProgress = totalTargetValue > 0 ? (totalProgress / totalTargetValue) * 100 : 0;

      return {
        totalTargets,
        activeTargets,
        completedTargets,
        overdueTargets,
        totalProgress,
        averageProgress: Math.round(averageProgress * 100) / 100
      };
    });

    return stats;
  } catch (error) {
    console.error('Error fetching target stats:', error);
    throw error;
  }
};

// Auto-reset targets based on type
export const autoResetTargets = async () => {
  try {
    const now = new Date();
    const changes: any[] = [];

    // Mark all expired targets (any type) inactive so new ones can be created with new goals next cycle
    const expired = await withDbRetry(async () => {
      return await prisma.target.findMany({
        where: { isActive: true, endDate: { lt: now } },
      });
    });

    for (const t of expired) {
      await withDbRetry(async () => {
        await prisma.target.update({ where: { id: t.id }, data: { isActive: false, updatedAt: new Date() } });
      });
      changes.push({ targetId: t.id, action: 'inactivated', previousValue: t.currentValue });
    }

    return changes;
  } catch (error) {
    console.error('Error auto-resetting targets:', error);
    throw error;
  }
};

// Calculate target progress based on actual data
export const calculateTargetProgress = async (targetId: string) => {
  try {
    const target = await withDbRetry(async () => {
      return await prisma.target.findUnique({
        where: { id: targetId },
        include: {
          assignedTo: {
            select: {
              id: true,
              role: true
            }
          }
        }
      });
    });

    if (!target) {
      throw new Error('Target not found');
    }

    let progress = 0;
    const startDate = new Date(target.startDate);
    startDate.setUTCHours(0, 0, 0, 0); // Set to start of day in UTC
    const endDate = new Date(target.endDate);
    endDate.setUTCHours(23, 59, 59, 999); // Set to end of day in UTC to include the full day

    // Calculate progress based on target category using Commission records
    // This ensures targets match commissions exactly
    switch (target.category) {
      case 'new_patients':
        // For sales employees, use actual new patient visits count instead of all PATIENT_CREATION commissions
        // Check if employee is a sales person
        const employeeForTarget = await withDbRetry(async () => {
          return await prisma.employee.findUnique({
            where: { id: target.assignedToId },
            include: {
              employeeRoles: {
                where: { isActive: true },
                select: { role: true }
              }
            }
          });
        });
        
        const employeeRolesForTarget = employeeForTarget?.employeeRoles?.map(er => er.role) || [];
        const isSalesForTarget = employeeRolesForTarget.includes('sales');
        
        if (isSalesForTarget) {
          // Use helper function to get actual new patient visits count
          const { getActualNewPatientVisitsCount } = await import('../utils/newPatientVisits.utils');
          progress = await getActualNewPatientVisitsCount(target.assignedToId, startDate, endDate);
        } else {
          // For non-sales employees, use commission count (shouldn't happen for new_patients, but fallback)
          progress = await withDbRetry(async () => {
            const count = await prisma.commission.count({
              where: {
                employeeId: target.assignedToId,
                type: 'PATIENT_CREATION',
                createdAt: {
                  gte: startDate,
                  lte: endDate
                }
              }
            });
            return count;
          });
        }
        break;

      case 'follow_up_patients':
        progress = await withDbRetry(async () => {
          const count = await prisma.commission.count({
            where: {
              employeeId: target.assignedToId,
              type: 'FOLLOW_UP',
              createdAt: {
                gte: startDate,
                lte: endDate
              }
            }
          });
          return count;
        });
        break;

      case 'specialties':
        progress = await withDbRetry(async () => {
          const count = await prisma.commission.count({
            where: {
              employeeId: target.assignedToId,
              type: 'VISIT_SPECIALITY_ADDITION',
              createdAt: {
                gte: startDate,
                lte: endDate
              }
            }
          });
          return count;
        });
        break;

      case 'nominations':
        progress = await withDbRetry(async () => {
          const count = await prisma.commission.count({
            where: {
              employeeId: target.assignedToId,
              type: 'NOMINATION_CONVERSION',
              createdAt: {
                gte: startDate,
                lte: endDate
              }
            }
          });
          return count;
        });
        break;

      case 'custom':
        // For custom targets, progress is manually updated
        progress = target.currentValue;
        break;
    }

    // Update target with calculated progress
    await withDbRetry(async () => {
      await prisma.target.update({
        where: { id: targetId },
        data: {
          currentValue: progress,
          updatedAt: new Date(),
          ...(progress >= target.targetValue && {
            completedAt: new Date()
          })
        }
      });
    });

    // If this target belongs to a team member, update team target
    await updateTeamTargetIfMember(target.assignedToId, target.category, target.type);

    return progress;
  } catch (error) {
    console.error('Error calculating target progress:', error);
    throw error;
  }
};

/**
 * Update team target if the employee is a team member
 */
const updateTeamTargetIfMember = async (employeeId: string, category: string, type: string) => {
  try {
    // Check if employee is a team leader
    const teamAsLeader = await withDbRetry(async () => {
      return await prisma.team.findFirst({
        where: {
          leaderId: employeeId,
          isActive: true
        },
        include: {
          targets: {
            where: { isActive: true }
          }
        }
      });
    });

    // Check if employee is a team member
    const teamMember = await withDbRetry(async () => {
      return await prisma.teamMember.findFirst({
        where: {
          employeeId: employeeId,
          isActive: true
        },
        include: {
          team: {
            include: {
              targets: {
                where: { isActive: true }
              }
            }
          }
        }
      });
    });

    // Determine which team to update (leader takes precedence if employee is both)
    let team = teamAsLeader;
    if (!team && teamMember?.team) {
      // Fetch full team data with targets
      team = await withDbRetry(async () => {
        return await prisma.team.findUnique({
          where: { id: teamMember.team.id },
          include: {
            targets: {
              where: { isActive: true }
            }
          }
        });
      });
    }
    
    if (!team || !team.targets || team.targets.length === 0) {
      return; // Not a team leader/member or team has no targets
    }

    // Find target matching the category and type
    const teamTarget = team.targets.find(t => t.category === category && t.type === type && t.isActive);
    if (!teamTarget) {
      return; // No matching target found
    }
    
    // Only update if category and type match
    if (teamTarget.category !== category || teamTarget.type !== type) {
      return;
    }

    // Get leader's target
    const leaderTarget = await withDbRetry(async () => {
      return await prisma.target.findFirst({
        where: {
          assignedToId: team.leaderId,
          category: category,
          type: type as 'daily' | 'weekly' | 'monthly',
          isActive: true,
          startDate: { lte: teamTarget.endDate },
          endDate: { gte: teamTarget.startDate }
        }
      });
    });

    // Get all team members
    const teamMembers = await withDbRetry(async () => {
      return await prisma.teamMember.findMany({
        where: {
          teamId: team.id,
          isActive: true
        },
        select: {
          employeeId: true
        }
      });
    });

    const memberIds = teamMembers.map(m => m.employeeId);

    // Get all member targets for the same category and type
    const memberTargets = memberIds.length > 0 ? await withDbRetry(async () => {
      return await prisma.target.findMany({
        where: {
          assignedToId: { in: memberIds },
          category: category,
          type: type as 'daily' | 'weekly' | 'monthly',
          isActive: true,
          startDate: { lte: teamTarget.endDate },
          endDate: { gte: teamTarget.startDate }
        }
      });
    }) : [];

    // Sum up current values: leader + members
    let totalCurrentValue = leaderTarget?.currentValue || 0;
    for (const memberTarget of memberTargets) {
      totalCurrentValue += memberTarget.currentValue || 0;
    }

    // Update team target currentValue
    await withDbRetry(async () => {
      await prisma.target.update({
        where: { id: teamTarget.id },
        data: {
          currentValue: totalCurrentValue,
          updatedAt: new Date(),
          ...(totalCurrentValue >= teamTarget.targetValue && !teamTarget.completedAt && {
            completedAt: new Date()
          })
        }
      });
    });
  } catch (error) {
    console.error('Error updating team target:', error);
    // Don't throw - this is a background update
  }
};

// Get target progress history
export const getTargetProgressHistory = async (targetId: string, days: number = 30) => {
  try {
    const progress = await withDbRetry(async () => {
      return await prisma.targetProgress.findMany({
        where: {
          targetId,
          date: {
            gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
          }
        },
        orderBy: {
          date: 'asc'
        }
      });
    });

    return progress;
  } catch (error) {
    console.error('Error fetching target progress history:', error);
    throw error;
  }
};

// Delete target
export const deleteTarget = async (targetId: string) => {
  try {
    await withDbRetry(async () => {
      await prisma.target.delete({
        where: { id: targetId }
      });
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting target:', error);
    throw error;
  }
};

// Update target
export const updateTarget = async (targetId: string, data: Partial<CreateTargetData>) => {
  try {
    const target = await withDbRetry(async () => {
      return await prisma.target.update({
        where: { id: targetId },
        data: {
          ...(data.assignedToId && { assignedToId: data.assignedToId }),
          ...(data.type && { type: data.type }),
          ...(data.category && { category: data.category }),
          ...(data.description && { description: data.description }),
          ...(data.targetValue && { targetValue: data.targetValue }),
          ...(data.startDate && { startDate: data.startDate }),
          ...(data.endDate && { endDate: data.endDate }),
          updatedAt: new Date()
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              role: true,
            }
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
            }
          }
        }
      });
    });

    return target;
  } catch (error) {
    console.error('Error updating target:', error);
    throw error;
  }
};

const targetManagementService = {
  createTarget,
  getEmployeeTargets,
  getAllTargets,
  updateTargetProgress,
  getTargetStats,
  autoResetTargets,
  calculateTargetProgress,
  getTargetProgressHistory,
  deleteTarget,
  updateTarget,
};

export default targetManagementService;

// ---------------------
// Increment target flow
// ---------------------
type IncrementCategory = 'new_patients' | 'follow_up_patients' | 'specialties' | 'nominations';

export async function incrementTarget(args: {
  category: IncrementCategory;
  actorId: string; // employee id
  date?: Date;
}) {
  const when = args.date ? new Date(args.date) : new Date();
  when.setMilliseconds(0);

  // Find active targets for actor where date is within range
  const targets = await withDbRetry(async () => {
    return await prisma.target.findMany({
      where: {
        assignedToId: args.actorId,
        category: args.category,
        isActive: true,
        startDate: { lte: when },
        endDate: { gte: when },
      }
    });
  });

  if (targets.length === 0) return [];

  const updates = [] as any[];
  for (const t of targets) {
    // Upsert TargetProgress for the specific day
    const day = new Date(when);
    day.setHours(0, 0, 0, 0);

    const progress = await withDbRetry(async () => {
      return await prisma.targetProgress.upsert({
        where: { targetId_date: { targetId: t.id, date: day } },
        update: { progress: { increment: 1 }, updatedAt: new Date() },
        create: { targetId: t.id, date: day, progress: 1 }
      });
    });

    // Increment currentValue on Target
    const updated = await withDbRetry(async () => {
      return await prisma.target.update({
        where: { id: t.id },
        data: {
          currentValue: { increment: 1 },
          updatedAt: new Date(),
          ...(t.currentValue + 1 >= t.targetValue && { completedAt: new Date() })
        }
      });
    });

    updates.push({ target: updated, progress });
  }

  return updates;
}