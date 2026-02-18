import { prisma } from "../utils/database.utils";
import { NotificationService } from "./notification.service";

/**
 * Get current time in Dubai timezone (UTC+4)
 */
function getDubaiTime(): Date {
  const now = new Date();
  // Convert UTC to Dubai time (UTC+4)
  // Get the time in Dubai timezone
  const dubaiTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Dubai' });
  // Parse it back to a Date object (this will be in local server time, but represents Dubai time)
  // Actually, we need to work with UTC and add 4 hours offset
  // Dubai is UTC+4 (no DST)
  const dubaiOffset = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
  const dubaiTime = new Date(now.getTime() + dubaiOffset);
  return dubaiTime;
}

/**
 * Convert a UTC date to Dubai time for comparison
 */
function convertToDubaiTime(utcDate: Date): Date {
  // If the date is stored in UTC, we need to interpret it as Dubai time
  // Actually, dates from DB are already in UTC, so we just need to compare correctly
  // The issue is: when user schedules 8:20 AM Dubai time, it might be stored as:
  // - 8:20 AM UTC (wrong) OR
  // - 4:20 AM UTC (correct, if stored properly)
  // We need to check how dates are stored and compare accordingly
  return utcDate;
}

/**
 * Check and send notifications for appointment coordination tasks
 * that have appointments starting within 2 hours
 */
export async function checkAndSendAppointmentNotifications(): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  
  try {
    const debug = process.env.DEBUG_LOGS === 'true';
    const dlog = (...args: any[]) => {
      if (debug) console.log(...args);
    };

    // Get current time in UTC (server time)
    const nowUTC = new Date();
    
    // Since all users are in Dubai, appointments are scheduled in Dubai time
    // When frontend sends scheduledTime via .toISOString(), it converts Dubai local time to UTC
    // So 1:00 PM Dubai = 9:00 AM UTC (Dubai is UTC+4)
    // We can compare UTC timestamps directly since both are in UTC
    
    // However, to be safe and handle any timezone issues, we'll also check
    // the Dubai time representation to ensure accuracy
    
    // Helper to get hour and minute in Dubai timezone from a UTC date
    const getDubaiHourMinute = (utcDate: Date) => {
      const dubaiTimeStr = utcDate.toLocaleString('en-US', {
        timeZone: 'Asia/Dubai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      // Format: "HH:MM"
      const [hour, minute] = dubaiTimeStr.split(':').map(Number);
      return { hour, minute };
    };
    
    // Get current time in Dubai for logging
    const nowDubai = getDubaiHourMinute(nowUTC);
    const nowDubaiMinutes = nowDubai.hour * 60 + nowDubai.minute;
    
    // Get current date in Dubai for date comparison
    const nowDubaiDateStr = nowUTC.toLocaleString('en-US', {
      timeZone: 'Asia/Dubai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const [nowMonth, nowDay, nowYear] = nowDubaiDateStr.split('/').map(Number);
    
    // Query all active Appointment Coordination tasks
    const tasks = await prisma.task.findMany({
      where: {
        status: { in: ['pending', 'in_progress'] },
        OR: [
          { taskType: 'Appointment Coordination' },
          { title: 'Appointment Coordination Required' }
        ],
        relatedEntityType: 'appointment',
        relatedEntityId: { not: null }
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            name: true
          }
        },
        taskTypeRelation: {
          select: {
            name: true
          }
        }
      }
    });
    
    // Filter to only Appointment Coordination tasks (check taskTypeRelation after fetch)
    const appointmentCoordinationTasks = tasks.filter(task => {
      const taskTypeName = task.taskTypeRelation?.name || task.taskType || '';
      return taskTypeName === 'Appointment Coordination' || 
             task.title === 'Appointment Coordination Required';
    });
    
    dlog(`[Appointment Notification] Current time (UTC): ${nowUTC.toISOString()}, Current time (Dubai): ${nowDubai.hour}:${nowDubai.minute.toString().padStart(2, '0')} on ${nowMonth}/${nowDay}/${nowYear}`);
    dlog(`[Appointment Notification] Found ${appointmentCoordinationTasks.length} appointment coordination tasks to check`);
    
    for (const task of appointmentCoordinationTasks) {
      try {
        // Check if notification already sent
        const metadata = task.metadata as any;
        if (metadata?.appointmentNotificationSent === true) {
          dlog(`[Appointment Notification] Task ${task.id} - notification already sent at ${metadata.appointmentNotificationSentAt}`);
          skipped++;
          continue;
        }
        
        if (!task.relatedEntityId) {
          skipped++;
          continue;
        }
        
        // Fetch appointment separately since Task doesn't have direct relation
        const appointment = await prisma.appointment.findUnique({
          where: { id: task.relatedEntityId },
          include: {
            appointmentSpecialities: {
              orderBy: { scheduledTime: 'asc' },
              where: {
                status: 'scheduled' // Only check scheduled specialties
              }
            },
            patient: {
              select: {
                nameEnglish: true
              }
            }
          }
        });
        
        // Get the earliest scheduled time from appointment specialties
        if (!appointment || !appointment.appointmentSpecialities || appointment.appointmentSpecialities.length === 0) {
          dlog(`[Appointment Notification] Task ${task.id} - no appointment or specialties found`);
          skipped++;
          continue;
        }
        
        const earliestSpeciality = appointment.appointmentSpecialities[0];
        const scheduledTimeUTC = new Date(earliestSpeciality.scheduledTime);
        
        // Get scheduled time in Dubai timezone
        const scheduledDubai = getDubaiHourMinute(scheduledTimeUTC);
        const scheduledDubaiMinutes = scheduledDubai.hour * 60 + scheduledDubai.minute;
        
        // Get scheduled date in Dubai
        const scheduledDubaiDateStr = scheduledTimeUTC.toLocaleString('en-US', {
          timeZone: 'Asia/Dubai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const [scheduledMonth, scheduledDay, scheduledYear] = scheduledDubaiDateStr.split('/').map(Number);
        
        // Check if same day
        const isSameDay = nowYear === scheduledYear && nowMonth === scheduledMonth && nowDay === scheduledDay;
        
        // Calculate time difference in minutes
        // Primary method: Compare UTC timestamps (most reliable)
        // scheduledTime is stored as UTC (from .toISOString()), so direct comparison works
        const timeDiffMs = scheduledTimeUTC.getTime() - nowUTC.getTime();
        const timeDiffMinutesUTC = timeDiffMs / (1000 * 60);
        
        // Secondary method: Compare Dubai time components (for same-day appointments)
        // This helps catch cases where timezone conversion might be off
        let timeDiffMinutesDubai: number | null = null;
        if (isSameDay) {
          timeDiffMinutesDubai = scheduledDubaiMinutes - nowDubaiMinutes;
        }
        
        // Use Dubai time comparison if same day and it makes sense, otherwise use UTC
        // If Dubai time diff is very different from UTC diff, there might be a timezone issue
        let finalTimeDiffMinutes = timeDiffMinutesUTC;
        if (isSameDay && timeDiffMinutesDubai !== null) {
          // If both methods give similar results (within 1 hour), use Dubai time (more accurate for same day)
          if (Math.abs(timeDiffMinutesUTC - timeDiffMinutesDubai) < 60) {
            finalTimeDiffMinutes = timeDiffMinutesDubai;
          }
          // Otherwise, there might be a timezone storage issue, use UTC as fallback
        }
        
        // Format for logging in Dubai timezone (for user-friendly display)
        const scheduledDubaiFormatted = scheduledTimeUTC.toLocaleString('en-US', { 
          timeZone: 'Asia/Dubai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        const nowDubaiFormatted = nowUTC.toLocaleString('en-US', { 
          timeZone: 'Asia/Dubai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        
        // Check if appointment is within 2 hours (between now and 2 hours from now) in Dubai time
        // Also send for appointments that just passed (within last 30 minutes) if notification wasn't sent yet
        // This catches cases where the background job wasn't running when it should have sent
        // Note: We check both UTC and Dubai time differences to handle timezone storage issues
        const timeDiffToUse = isSameDay && timeDiffMinutesDubai !== null && Math.abs(timeDiffMinutesUTC - timeDiffMinutesDubai) < 60
          ? timeDiffMinutesDubai
          : finalTimeDiffMinutes;
        
        const shouldSend = (timeDiffToUse >= 0 && timeDiffToUse <= 120) || 
                          (timeDiffToUse < 0 && timeDiffToUse >= -30 && !metadata?.appointmentNotificationSent);
        
        // Log for debugging (showing both UTC and Dubai times)
        dlog(`[Appointment Notification] Task ${task.id}, Patient: ${appointment.patient?.nameEnglish}`);
        dlog(`  Scheduled (UTC): ${scheduledTimeUTC.toISOString()}, Scheduled (Dubai): ${scheduledDubaiFormatted} (${scheduledDubai.hour}:${scheduledDubai.minute.toString().padStart(2, '0')})`);
        dlog(`  Now (UTC): ${nowUTC.toISOString()}, Now (Dubai): ${nowDubaiFormatted} (${nowDubai.hour}:${nowDubai.minute.toString().padStart(2, '0')})`);
        dlog(`  Time diff (UTC): ${timeDiffMinutesUTC.toFixed(1)} min, Time diff (Dubai same-day): ${isSameDay && timeDiffMinutesDubai !== null ? timeDiffMinutesDubai.toFixed(1) : 'N/A'} min`);
        dlog(`  Final time diff: ${finalTimeDiffMinutes.toFixed(1)} minutes, Time diff used: ${timeDiffToUse.toFixed(1)} minutes, Already sent: ${metadata?.appointmentNotificationSent || false}, Should send: ${shouldSend}`);
        
        if (shouldSend) {
          // Format time for notification in Dubai timezone
          const formattedTime = scheduledTimeUTC.toLocaleString('en-US', {
            timeZone: 'Asia/Dubai',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
          
          const patientName = appointment.patient?.nameEnglish || 'Patient';
          
          // Send notification
          await NotificationService.createNotification({
            userId: task.assignedToId,
            type: 'APPOINTMENT_REMINDER',
            title: 'Appointment Starting Soon',
            content: `Appointment coordination task for ${patientName} - appointment starts at ${formattedTime}. Please coordinate the appointment.`,
            priority: 'HIGH',
            channels: ['IN_APP'],
            metadata: {
              taskId: task.id,
              appointmentId: appointment.id,
              scheduledTime: scheduledTimeUTC.toISOString()
            }
          });
          
          // Update task metadata to track notification
          const updatedMetadata = {
            ...metadata,
            appointmentNotificationSent: true,
            appointmentNotificationSentAt: new Date().toISOString()
          };
          
          await prisma.task.update({
            where: { id: task.id },
            data: {
              metadata: updatedMetadata
            }
          });
          
          sent++;
          console.log(`[Appointment Notification] ✅ SENT notification for task ${task.id}, appointment at ${scheduledTimeUTC.toISOString()} (Dubai: ${scheduledDubaiFormatted})`);
        } else {
          skipped++;
          if (finalTimeDiffMinutes < 0) {
            dlog(`[Appointment Notification] ⏭️ Skipped task ${task.id} - appointment time has passed (${Math.abs(finalTimeDiffMinutes).toFixed(1)} minutes ago)`);
          } else if (finalTimeDiffMinutes > 120) {
            dlog(`[Appointment Notification] ⏭️ Skipped task ${task.id} - appointment is more than 2 hours away (${finalTimeDiffMinutes.toFixed(1)} minutes)`);
          } else {
            dlog(`[Appointment Notification] ⏭️ Skipped task ${task.id} - outside notification window (${finalTimeDiffMinutes.toFixed(1)} minutes, should be 0-120)`);
          }
        }
      } catch (error) {
        console.error(`Error processing notification for task ${task.id}:`, error);
        skipped++;
      }
    }
    
    console.log(`[Appointment Notification] Check completed: ${sent} sent, ${skipped} skipped`);
    return { sent, skipped };
  } catch (error) {
    console.error('Error in checkAndSendAppointmentNotifications:', error);
    return { sent, skipped };
  }
}
