import { Request, Response } from 'express';
import { withDbRetry, prisma } from '../utils/database.utils';
import {
  createTeam,
  getTeamById,
  getTeamsByLeader,
  getTeamByMember,
  addTeamMember,
  removeTeamMember,
  updateTeamTarget,
  getTeamProgress,
  getTeamProgressByCategory,
  getAllTeamProgress,
  getTeamAppointments,
  getTeamVisits,
  getTeamMembersProgress,
  getAllTeams,
  updateTeam,
  deleteTeam,
  getTeamsAnalysis
} from '../services/team.service';
import '../middleware/auth.middleware'; // Import to extend Request interface

// Create team (admin only)
export const createTeamController = async (req: Request, res: Response) => {
  try {
    const { name, leaderId, targetData } = req.body;
    const createdById = req.user?.id;

    if (!createdById) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!name || !leaderId) {
      return res.status(400).json({ error: 'Name and leaderId are required' });
    }

    // Handle targetData as array or single object for backward compatibility
    let processedTargetData: Array<{
      type: 'daily' | 'weekly' | 'monthly';
      category: string;
      description: string;
      targetValue: number;
      startDate: Date;
      endDate: Date;
    }> | undefined;

    if (targetData) {
      if (Array.isArray(targetData)) {
        processedTargetData = targetData.map(td => ({
          type: td.type,
          category: td.category,
          description: td.description,
          targetValue: td.targetValue,
          startDate: new Date(td.startDate),
          endDate: new Date(td.endDate)
        }));
      } else {
        // Backward compatibility: single object
        processedTargetData = [{
          type: targetData.type,
          category: targetData.category,
          description: targetData.description,
          targetValue: targetData.targetValue,
          startDate: new Date(targetData.startDate),
          endDate: new Date(targetData.endDate)
        }];
      }
    }

    const result = await createTeam(
      {
        name,
        leaderId,
        targetData: processedTargetData
      },
      createdById
    );

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Error creating team:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create team'
    });
  }
};

// Get all teams (admin) or teams for current user (leader)
export const getTeamsController = async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    const isObserver = req.user?.role === 'observer' || (req.user?.roles && req.user.roles.includes('observer'));

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let teams;
    if (isAdmin || isObserver) {
      teams = await getAllTeams();
    } else {
      teams = await getTeamsByLeader(currentUserId);
    }

    res.status(200).json({
      success: true,
      data: teams
    });
  } catch (error: any) {
    console.error('Error fetching teams:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch teams'
    });
  }
};

// Get team by ID
export const getTeamByIdController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    const isObserver = req.user?.role === 'observer' || (req.user?.roles && req.user.roles.includes('observer'));

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await getTeamById(id);

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found'
      });
    }

    // Check if user is admin, observer, team leader, or team member
    const isLeader = team.leaderId === currentUserId;
    const isMember = team.members.some(m => m.employeeId === currentUserId);

    if (!isAdmin && !isObserver && !isLeader && !isMember) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.status(200).json({
      success: true,
      data: team
    });
  } catch (error: any) {
    console.error('Error fetching team:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch team'
    });
  }
};

// Get teams analysis (admin only)
export const getTeamsAnalysisController = async (req: Request, res: Response) => {
  try {
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Admin access required'
      });
    }

    const month = req.query.month ? parseInt(req.query.month as string) : undefined;
    const year = req.query.year ? parseInt(req.query.year as string) : undefined;

    const analysis = await getTeamsAnalysis(month, year);

    res.status(200).json({
      success: true,
      data: analysis
    });
  } catch (error: any) {
    console.error('Error fetching teams analysis:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch teams analysis'
    });
  }
};

// Get team by member (for team members to find their team)
export const getTeamByMemberController = async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await getTeamByMember(currentUserId);

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'You are not a member of any team'
      });
    }

    res.status(200).json({
      success: true,
      data: team
    });
  } catch (error: any) {
    console.error('Error fetching team by member:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch team'
    });
  }
};

// Get team progress
export const getTeamProgressController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, month, year, category } = req.query;
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    const isObserver = req.user?.role === 'observer' || (req.user?.roles && req.user.roles.includes('observer'));

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await getTeamById(id);

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found'
      });
    }

    // Check if user is admin, observer, team leader, or team member
    const isLeader = team.leaderId === currentUserId;
    const isMember = team.members.some(m => m.employeeId === currentUserId);
    if (!isAdmin && !isObserver && !isLeader && !isMember) {
      return res.status(403).json({
        success: false,
        error: 'Only team members can view team progress'
      });
    }

    // Calculate date range from month/year if provided
    let start: Date | undefined;
    let end: Date | undefined;

    if (month && year) {
      const monthNum = parseInt(month as string);
      const yearNum = parseInt(year as string);
      if (monthNum >= 1 && monthNum <= 12 && yearNum > 0) {
        start = new Date(yearNum, monthNum - 1, 1);
        end = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
      }
    } else if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
    }

    // If category is specified, return progress for that category only
    // Otherwise, return progress for all categories
    let progress;
    if (category) {
      progress = await getTeamProgressByCategory(id, category as string, start, end);
    } else {
      progress = await getAllTeamProgress(id, start, end);
    }

    res.status(200).json({
      success: true,
      data: progress
    });
  } catch (error: any) {
    console.error('Error fetching team progress:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch team progress'
    });
  }
};

// Get team appointments
export const getTeamAppointmentsController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, startDate, endDate, memberId, role, patientType, page, limit } = req.query;
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await getTeamById(id);

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found'
      });
    }

    // Check if user is admin, team leader, or team member
    const isLeader = team.leaderId === currentUserId;
    const isMember = team.members.some(m => m.employeeId === currentUserId);
    
    // If memberId is provided, check if it matches the current user (members can only see their own)
    if (memberId && memberId !== currentUserId && !isAdmin && !isLeader) {
      return res.status(403).json({
        success: false,
        error: 'You can only view your own appointments'
      });
    }
    
    if (!isAdmin && !isLeader && !isMember) {
      return res.status(403).json({
        success: false,
        error: 'Only team members can view team appointments'
      });
    }

    const result = await getTeamAppointments(id, {
      status: status as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      memberId: memberId as string | undefined,
      role: role as 'sales' | 'coordinator' | undefined,
      patientType: patientType as 'new' | 'existing' | 'follow-up' | undefined,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Error fetching team appointments:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch team appointments'
    });
  }
};

// Get team visits
export const getTeamVisitsController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, memberId, role, patientType, page, limit } = req.query;
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await getTeamById(id);

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found'
      });
    }

    // Check if user is admin, team leader, or team member
    const isLeader = team.leaderId === currentUserId;
    const isMember = team.members.some(m => m.employeeId === currentUserId);
    
    // If memberId is provided, check if it matches the current user (members can only see their own)
    if (memberId && memberId !== currentUserId && !isAdmin && !isLeader) {
      return res.status(403).json({
        success: false,
        error: 'You can only view your own visits'
      });
    }
    
    if (!isAdmin && !isLeader && !isMember) {
      return res.status(403).json({
        success: false,
        error: 'Only team members can view team visits'
      });
    }

    const result = await getTeamVisits(id, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      memberId: memberId as string | undefined,
      role: role as 'sales' | 'coordinator' | undefined,
      patientType: patientType as 'new' | 'existing' | 'follow-up' | undefined,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Error fetching team visits:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch team visits'
    });
  }
};

// Get team members progress
export const getTeamMembersProgressController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, month, year } = req.query;
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    const isObserver = req.user?.role === 'observer' || (req.user?.roles && req.user.roles.includes('observer'));

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await getTeamById(id);

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found'
      });
    }

    // Check if user is admin, observer, or team leader
    const isLeader = team.leaderId === currentUserId;
    if (!isAdmin && !isObserver && !isLeader) {
      return res.status(403).json({
        success: false,
        error: 'Only team leaders can view team members progress'
      });
    }

    // Calculate date range from month/year if provided
    let start: Date | undefined;
    let end: Date | undefined;

    if (month && year) {
      const monthNum = parseInt(month as string);
      const yearNum = parseInt(year as string);
      if (monthNum >= 1 && monthNum <= 12 && yearNum > 0) {
        start = new Date(yearNum, monthNum - 1, 1);
        end = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
      }
    } else if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
    }

    const membersProgress = await getTeamMembersProgress(id, start, end);

    res.status(200).json({
      success: true,
      data: membersProgress
    });
  } catch (error: any) {
    console.error('Error fetching team members progress:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch team members progress'
    });
  }
};

// Add team member (admin only)
export const addTeamMemberController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        error: 'employeeId is required'
      });
    }

    const teamMember = await addTeamMember(id, employeeId);

    res.status(201).json({
      success: true,
      data: teamMember
    });
  } catch (error: any) {
    console.error('Error adding team member:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to add team member'
    });
  }
};

// Remove team member (admin only)
export const removeTeamMemberController = async (req: Request, res: Response) => {
  try {
    const { id, employeeId } = req.params;

    await removeTeamMember(id, employeeId);

    res.status(200).json({
      success: true,
      message: 'Team member removed successfully'
    });
  } catch (error: any) {
    console.error('Error removing team member:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to remove team member'
    });
  }
};

// Update team target (admin only)
export const updateTeamTargetController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetData } = req.body; // Can be single object or array
    const assignedById = req.user?.id;

    if (!assignedById) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Handle both single object and array for backward compatibility
    let processedTargetData: Array<{
      type: 'daily' | 'weekly' | 'monthly';
      category: string;
      description: string;
      targetValue: number;
      startDate: Date;
      endDate: Date;
    }>;

    if (Array.isArray(targetData)) {
      processedTargetData = targetData.map(td => ({
        type: td.type,
        category: td.category,
        description: td.description,
        targetValue: td.targetValue,
        startDate: new Date(td.startDate),
        endDate: new Date(td.endDate)
      }));
    } else {
      // Single object (backward compatibility)
      if (!targetData.type || !targetData.category || !targetData.description || !targetData.targetValue || !targetData.startDate || !targetData.endDate) {
        return res.status(400).json({
          success: false,
          error: 'All target fields are required'
        });
      }
      processedTargetData = [{
        type: targetData.type,
        category: targetData.category,
        description: targetData.description,
        targetValue: targetData.targetValue,
        startDate: new Date(targetData.startDate),
        endDate: new Date(targetData.endDate)
      }];
    }

    const result = await updateTeamTarget(id, processedTargetData, assignedById);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Error updating team target:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to update team target'
    });
  }
};

// Update team (admin only)
export const updateTeamController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, leaderId, isActive } = req.body;

    const team = await updateTeam(id, {
      ...(name && { name }),
      ...(leaderId && { leaderId }),
      ...(isActive !== undefined && { isActive })
    });

    res.status(200).json({
      success: true,
      data: team
    });
  } catch (error: any) {
    console.error('Error updating team:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to update team'
    });
  }
};

// Delete team (admin only)
export const deleteTeamController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await deleteTeam(id);

    res.status(200).json({
      success: true,
      message: 'Team deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting team:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to delete team'
    });
  }
};

// Get team member details (commission/visit breakdown for a specific member)
// This endpoint redirects to commission breakdown API with proper filtering
export const getTeamMemberDetailsController = async (req: Request, res: Response) => {
  try {
    const { id, memberId } = req.params;
    const { month, year, startDate, endDate } = req.query;
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await getTeamById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found'
      });
    }

    // Check if memberId belongs to this team
    const isMember = team.members.some(m => m.employeeId === memberId);
    const isLeader = team.leaderId === memberId;
    
    if (!isMember && !isLeader) {
      return res.status(404).json({
        success: false,
        error: 'Member not found in this team'
      });
    }

    // Check permissions: member can only see their own, leader/admin can see any member
    const isRequestingOwn = memberId === currentUserId;
    const isTeamLeader = team.leaderId === currentUserId;
    
    if (!isAdmin && !isTeamLeader && !isRequestingOwn) {
      return res.status(403).json({
        success: false,
        error: 'You can only view your own details'
      });
    }

    // Calculate date range
    let start: string | undefined;
    let end: string | undefined;

    if (month && year) {
      const monthNum = parseInt(month as string);
      const yearNum = parseInt(year as string);
      if (monthNum >= 1 && monthNum <= 12 && yearNum > 0) {
        const startDateObj = new Date(yearNum, monthNum - 1, 1);
        const endDateObj = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
        start = startDateObj.toISOString().split('T')[0];
        end = endDateObj.toISOString().split('T')[0];
      }
    } else if (startDate && endDate) {
      start = startDate as string;
      end = endDate as string;
    }

    console.log('Team member details request:', {
      teamId: id,
      memberId,
      month,
      year,
      startDate: start,
      endDate: end,
      calculatedStart: start,
      calculatedEnd: end
    });

    // Redirect to commission breakdown endpoint
    req.query.employeeId = memberId;
    req.query.startDate = start;
    req.query.endDate = end;
    
    // Import and call commission breakdown
    const { getCommissionBreakdown } = await import('./commission.controller');
    await getCommissionBreakdown(req, res);
  } catch (error: any) {
    console.error('Error fetching team member details:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch team member details'
    });
  }
};

// Get all team members details (commission/visit breakdown for all members)
export const getTeamAllMembersDetailsController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { month, year, startDate, endDate } = req.query;
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    const isObserver = req.user?.role === 'observer' || (req.user?.roles && req.user.roles.includes('observer'));

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await getTeamById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found'
      });
    }

    // Check permissions: admin, observer, or team leader can see all members
    const isTeamLeader = team.leaderId === currentUserId;
    if (!isAdmin && !isObserver && !isTeamLeader) {
      return res.status(403).json({
        success: false,
        error: 'Only team leaders can view all team members details'
      });
    }

    // Get all team member IDs (leader + members)
    const memberIds = [team.leaderId, ...team.members.map(m => m.employeeId)];

    // Calculate date range
    let start: string | undefined;
    let end: string | undefined;

    if (month && year) {
      const monthNum = parseInt(month as string);
      const yearNum = parseInt(year as string);
      if (monthNum >= 1 && monthNum <= 12 && yearNum > 0) {
        const startDateObj = new Date(yearNum, monthNum - 1, 1);
        const endDateObj = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
        start = startDateObj.toISOString().split('T')[0];
        end = endDateObj.toISOString().split('T')[0];
      }
    } else if (startDate && endDate) {
      start = startDate as string;
      end = endDate as string;
    }

    // Call commission breakdown for all team members
    const { getCommissionBreakdown } = await import('./commission.controller');
    
    // Create a modified request to get breakdown for all team members
    const modifiedReq = {
      ...req,
      query: {
        ...req.query,
        employeeId: undefined, // Remove employeeId to get all, then filter
        startDate: start,
        endDate: end
      }
    } as any;

    // Get breakdown for all employees, then filter to team members
    const breakdownRes = {
      status: (code: number) => ({
        json: (data: any) => {
          if (code === 200 && data.success) {
            // Filter to only team members
            const teamMembersData = data.data?.filter((e: any) => 
              memberIds.includes(e.employeeId)
            ) || [];
            
            res.status(200).json({
              success: true,
              data: teamMembersData
            });
          } else {
            res.status(code).json(data);
          }
        }
      })
    } as any;

    await getCommissionBreakdown(modifiedReq, breakdownRes);
  } catch (error: any) {
    console.error('Error fetching all team members details:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch team members details'
    });
  }
};

