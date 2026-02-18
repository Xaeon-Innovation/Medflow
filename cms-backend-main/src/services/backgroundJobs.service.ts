import cron from 'node-cron';
import { autoCreateMissingCommissions } from './autoCommission.service';
import { checkAndSendAppointmentNotifications } from './appointmentNotification.service';
import { createBackup, cleanupOldBackups } from './backup.service';

/**
 * Background job service to run periodic tasks
 */
export function startBackgroundJobs() {
  console.log('[Background Jobs] Starting background job scheduler...');

  let autoCommissionRunning = false;
  let appointmentNotificationsRunning = false;

  // Run auto-commission creation every 5 minutes
  // This ensures new visits get commissions and targets updated automatically
  // Staggered and less frequent to reduce load
  cron.schedule('*/15 * * * *', async () => {
    try {
      if (autoCommissionRunning) {
        console.log('[Background Jobs] Auto-commission job skipped (previous run still running)');
        return;
      }
      autoCommissionRunning = true;
      console.log('[Background Jobs] Running auto-commission creation job...');
      const result = await autoCreateMissingCommissions();
      console.log('[Background Jobs] Auto-commission job completed:', result);
    } catch (error) {
      console.error('[Background Jobs] Error in auto-commission job:', error);
    } finally {
      autoCommissionRunning = false;
    }
  });

  // Run appointment notification check every 5 minutes
  // This checks for appointment coordination tasks with appointments starting within 2 hours
  // Offset by 2 minutes so it doesn't align with other periodic jobs
  cron.schedule('2-59/5 * * * *', async () => {
    try {
      if (appointmentNotificationsRunning) {
        console.log('[Background Jobs] Appointment notification job skipped (previous run still running)');
        return;
      }
      appointmentNotificationsRunning = true;
      console.log('[Background Jobs] Running appointment notification check...');
      const result = await checkAndSendAppointmentNotifications();
      console.log(`[Background Jobs] Appointment notification job completed: ${result.sent} sent, ${result.skipped} skipped`);
    } catch (error) {
      console.error('[Background Jobs] Error in appointment notification job:', error);
    } finally {
      appointmentNotificationsRunning = false;
    }
  });

  // Run daily database backup at 2:00 AM
  // Schedule can be configured via BACKUP_SCHEDULE environment variable (default: "0 2 * * *)
  // Backups are handled at the OS level (systemd timer + pg_dump) for reliability.
  // Keep this disabled by default to avoid extra load and duplication.
  if (process.env.ENABLE_APP_DB_BACKUP === 'true') {
    const backupSchedule = process.env.BACKUP_SCHEDULE || '0 2 * * *';
    cron.schedule(backupSchedule, async () => {
      try {
        console.log('[Background Jobs] Running daily database backup...');
        const backup = await createBackup();
        console.log(`[Background Jobs] Backup created successfully: ${backup.fileName} (${backup.sizeFormatted})`);
        
        // Clean up old backups after creating new one
        const cleanupResult = cleanupOldBackups();
        if (cleanupResult.deleted > 0) {
          console.log(`[Background Jobs] Cleaned up ${cleanupResult.deleted} old backup(s), freed ${(cleanupResult.freedSpace / 1024 / 1024).toFixed(2)} MB`);
        }
      } catch (error) {
        console.error('[Background Jobs] Error in daily backup job:', error);
      }
    });
  }

  // Also run immediately on startup to catch any missed commissions
  setTimeout(async () => {
    try {
      console.log('[Background Jobs] Running initial auto-commission creation...');
      const result = await autoCreateMissingCommissions();
      console.log('[Background Jobs] Initial auto-commission completed:', result);
    } catch (error) {
      console.error('[Background Jobs] Error in initial auto-commission:', error);
    }
  }, 30000); // Wait 30 seconds after server startup

  // Also run appointment notification check on startup (after a delay)
  setTimeout(async () => {
    try {
      console.log('[Background Jobs] Running initial appointment notification check...');
      const result = await checkAndSendAppointmentNotifications();
      console.log(`[Background Jobs] Initial appointment notification check completed: ${result.sent} sent, ${result.skipped} skipped`);
    } catch (error) {
      console.error('[Background Jobs] Error in initial appointment notification check:', error);
    }
  }, 35000); // Wait 35 seconds after server startup

  console.log('[Background Jobs] Background jobs started successfully');
}

