#!/usr/bin/env ts-node

/**
 * Script to manually trigger appointment notifications check
 * Usage: npm run trigger:notifications
 *    or: ts-node src/scripts/triggerNotifications.ts
 */

import { PrismaClient } from '@prisma/client';
import { checkAndSendAppointmentNotifications } from '../services/appointmentNotification.service';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🚀 Triggering appointment notifications check...\n');
    
    const result = await checkAndSendAppointmentNotifications();
    
    console.log('\n✅ Check completed!');
    console.log(`   Sent: ${result.sent}`);
    console.log(`   Skipped: ${result.skipped}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
