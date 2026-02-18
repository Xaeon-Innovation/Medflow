/**
 * Dedicated background worker entrypoint.
 *
 * Run via PM2 as a separate process to keep API latency stable.
 */

require("dotenv").config();

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startBackgroundJobs } = require("./services/backgroundJobs.service");
  startBackgroundJobs();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error("Failed to start background jobs worker:", error);
  process.exit(1);
}

// Keep process alive; node-cron will also keep the event loop active.
setInterval(() => {}, 1 << 30);

