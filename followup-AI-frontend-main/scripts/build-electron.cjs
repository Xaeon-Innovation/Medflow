const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const electronDist = path.join(rootDir, 'node_modules', 'electron-dist');
const electronStd = path.join(rootDir, 'node_modules', 'electron');

// Helper to run command
function run(cmd) {
    console.log(`> ${cmd}`);
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
}

try {
    // 1. Next.js Build
    console.log('--- Step 1: Next.js Build ---');
    run('npm run build');

    // 2. Prepare Electron folder for builder
    console.log('--- Step 2: Preparing Electron package ---');
    if (fs.existsSync(electronDist) && !fs.existsSync(electronStd)) {
        console.log(`Renaming electron-dist -> electron`);
        fs.renameSync(electronDist, electronStd);
    } else if (fs.existsSync(electronStd)) {
        console.log(`Electron package already standard.`);
    } else {
        throw new Error('Could not find electron package in node_modules');
    }

    // 3. Electron Builder
    console.log('--- Step 3: Electron Builder ---');
    run('electron-builder');

    console.log('✅ Build Success!');

} catch (err) {
    console.error('❌ Build Failed:', err.message);
    process.exit(1);

} finally {
    // 4. Restore Electron folder for Dev
    console.log('--- Step 4: Restoring Dev Configuration ---');
    if (fs.existsSync(electronStd) && !fs.existsSync(electronDist)) {
        console.log(`Renaming electron -> electron-dist`);
        fs.renameSync(electronStd, electronDist);
    }
}
