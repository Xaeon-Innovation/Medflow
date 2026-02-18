import { Request, Response } from 'express';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

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
  const timestamp = `${date}T${time}.000Z`;
  
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
      'CREATE_HOSPITAL': 'Created Hospital',
      'UPDATE_HOSPITAL': 'Updated Hospital',
      'DELETE_HOSPITAL': 'Deleted Hospital',
      'CREATE_APPOINTMENT': 'Created Appointment',
      'UPDATE_APPOINTMENT': 'Updated Appointment',
      'DELETE_APPOINTMENT': 'Deleted Appointment',
      'CREATE_SPECIALITY': 'Created Speciality',
      'UPDATE_SPECIALITY': 'Updated Speciality',
      'DELETE_SPECIALITY': 'Deleted Speciality',
      'CREATE_TASK': 'Created Task',
      'UPDATE_TASK': 'Updated Task',
      'DELETE_TASK': 'Deleted Task',
      'CREATE_TARGET': 'Created Target',
      'UPDATE_TARGET': 'Updated Target',
      'DELETE_TARGET': 'Deleted Target',
      'CREATE_TRANSACTION': 'Created Transaction',
      'UPDATE_TRANSACTION': 'Updated Transaction',
      'DELETE_TRANSACTION': 'Deleted Transaction',
      'CREATE_NOMINATION': 'Created Nomination',
      'UPDATE_NOMINATION': 'Updated Nomination',
      'DELETE_NOMINATION': 'Deleted Nomination',
      'LOGIN': 'User Login',
      'LOGOUT': 'User Logout',
      'ASSIGN_ROLE': 'Assigned Role',
      'UNASSIGN_ROLE': 'Unassigned Role',
      'CREATE_COMMISSION': 'Created Commission',
      'UPDATE_COMMISSION': 'Updated Commission',
      'DELETE_COMMISSION': 'Deleted Commission',
      'CREATE_INSURANCE_TYPE': 'Created Insurance Type',
      'UPDATE_INSURANCE_TYPE': 'Updated Insurance Type',
      'DELETE_INSURANCE_TYPE': 'Deleted Insurance Type',
      'CREATE_TASK_TYPE': 'Created Task Type',
      'UPDATE_TASK_TYPE': 'Updated Task Type',
      'DELETE_TASK_TYPE': 'Deleted Task Type',
      'Create': 'Created',
      'Update': 'Updated',
      'Delete': 'Deleted'
    };
    
    return actionMap[action] || action;
  };

  return {
    id: `${userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp,
    date,
    time,
    userId,
    userName,
    action: formatAction(action),
    entityId,
    entityType,
    status,
    description
  };
};

// Get file-based logs
export const getFileLogs = async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      userId,
      action,
      entityType,
      status,
      limit = 100,
      offset = 0
    } = req.query;

    const logsDir = path.join(__dirname, '../../logs');
    
    if (!fs.existsSync(logsDir)) {
      return res.status(200).json({
        success: true,
        data: [],
        total: 0
      });
    }

    // Get all log files
    const files = await fsPromises.readdir(logsDir);
    let logFiles = files.filter(file => file.includes('_Logs') && !file.includes('Request'));

    // Filter log files by month if startDate is provided
    if (startDate) {
      // Parse date string directly to avoid timezone issues
      // Format: YYYY-MM-DD
      const dateMatch = (startDate as string).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateMatch) {
        const targetYear = parseInt(dateMatch[1], 10);
        const targetMonth = parseInt(dateMatch[2], 10) - 1; // Convert to 0-based month
        
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const targetMonthName = monthNames[targetMonth];
        const targetFileName = `${targetMonthName}_${targetYear}_Logs`;
        
        // Read the month file and any suffixed variants (e.g. Jan_2026_Logs, Jan_2026_Logs-20260131)
        logFiles = logFiles.filter(file => file === targetFileName || file.startsWith(targetFileName + '-'));
      } else {
        console.error(`[Logs] Invalid date format: ${startDate}`);
      }
    }

    let allLogs: any[] = [];

    // Parse filtered log files
    for (const file of logFiles) {
      try {
        const filePath = path.join(logsDir, file);
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        
        // Process lines to handle multi-line log entries
        let currentLogLine = '';
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          // Check if this line starts with a date (YYYY-MM-DD format)
          if (/^\d{4}-\d{2}-\d{2}\t/.test(trimmedLine)) {
            // This is a new log entry, process the previous one if it exists
            if (currentLogLine) {
              const log = parseLogLine(currentLogLine);
              if (log) allLogs.push(log);
            }
            currentLogLine = trimmedLine;
          } else {
            // This is a continuation of the previous log entry (like error messages)
            currentLogLine += ' ' + trimmedLine;
          }
        }
        
        // Process the last log entry
        if (currentLogLine) {
          const log = parseLogLine(currentLogLine);
          if (log) allLogs.push(log);
        }
      } catch (fileError) {
        console.error(`Error reading log file ${file}:`, fileError);
      }
    }
    
    // Sort by timestamp (newest first)
    allLogs.sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.time}.000Z`);
      const dateB = new Date(`${b.date}T${b.time}.000Z`);
      return dateB.getTime() - dateA.getTime();
    });

    // Apply filters
    let filteredLogs = allLogs;

    if (startDate) {
      // Compare dates as strings (YYYY-MM-DD format) to avoid timezone issues
      const startDateStr = startDate as string;
      filteredLogs = filteredLogs.filter(log => {
        return log.date >= startDateStr;
      });
    }

    if (endDate) {
      // Compare dates as strings (YYYY-MM-DD format) to avoid timezone issues
      const endDateStr = endDate as string;
      filteredLogs = filteredLogs.filter(log => {
        return log.date <= endDateStr;
      });
    }

    if (userId) {
      filteredLogs = filteredLogs.filter(log => 
        log.userId.toLowerCase().includes((userId as string).toLowerCase()) ||
        log.userName.toLowerCase().includes((userId as string).toLowerCase())
      );
    }

    if (action) {
      filteredLogs = filteredLogs.filter(log => 
        log.action.toLowerCase().includes((action as string).toLowerCase())
      );
    }

    if (entityType) {
      filteredLogs = filteredLogs.filter(log => 
        log.entityType.toLowerCase().includes((entityType as string).toLowerCase())
      );
    }

    if (status) {
      filteredLogs = filteredLogs.filter(log => 
        log.status === status
      );
    }

    // Apply pagination
    const total = filteredLogs.length;
    const paginatedLogs = filteredLogs.slice(
      Number(offset), 
      Number(offset) + Number(limit)
    );

    // Add cache-busting headers
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    res.status(200).json({
      success: true,
      data: paginatedLogs,
      total,
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (error) {
    console.error('Error fetching file logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch logs',
      error: error
    });
  }
};
