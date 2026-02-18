// Waits for the Next.js dev server, then launches Electron
const { spawn } = require("child_process");
const path = require("path");
const waitOn = require("wait-on");

const fs = require('fs');

// Auto-fix: Ensure electron is renamed to electron-dist to avoid module shadowing
const electronPath = path.resolve(__dirname, '..', 'node_modules', 'electron');
const electronDistPath = path.resolve(__dirname, '..', 'node_modules', 'electron-dist');

if (fs.existsSync(electronPath) && !fs.existsSync(electronDistPath)) {
    console.log("🔧 Renaming node_modules/electron -> electron-dist for dev mode...");
    try {
        fs.renameSync(electronPath, electronDistPath);
    } catch (err) {
        console.error("❌ Failed to rename electron folder. Please run as Administrator or rename manually.");
        process.exit(1);
    }
}

// Get electron binary path (handles spaces in the path)
const electronBin = require("electron-dist");

const DEV_URL = "http://localhost:3001";

console.log("⏳ Waiting for Next.js dev server at", DEV_URL, "...");
console.log("   (This can take up to 2 minutes on first run with Turbopack)");

waitOn({
    resources: [DEV_URL],
    timeout: 120000,          // Increased to 120s for slow builds/Turbopack
    interval: 1000,          // Check every 1s
    validateStatus: function (status) {
        return status >= 200 && status < 300; // Only accept 200 series
    }
})
    .then(() => {
        console.log("✅ Next.js is ready! Launching Electron...");
        console.log("   Binary:", electronBin);

        // Use spawn with the path as first arg — handles spaces correctly
        const child = spawn(electronBin, ["."], {
            cwd: path.resolve(__dirname, ".."),
            stdio: "inherit",
            shell: false, // Don't use shell — prevents path-with-spaces issues
            env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true", ELECTRON_RUN_AS_NODE: undefined },
        });

        child.on("error", (err) => {
            console.error("❌ Failed to start Electron:", err.message);
            process.exit(1);
        });

        child.on("close", (code) => {
            console.log("Electron closed with code", code);
            process.exit(code || 0);
        });
    })
    .catch((err) => {
        console.error("❌ Timed out waiting for Next.js:", err.message);
        process.exit(1);
    });
