# MedFlow AI — Frontend & Desktop App

A Next.js 16 application packaged as a native desktop app using Electron.

## 🚀 Quick Start (Development)

To run the application in development mode with hot-reloading:

```bash
# In the frontend directory (d:\Xaeon proj\followup-AI-frontend-main)
npm run electron:dev
```

This will:
1. Start the Next.js dev server on `http://localhost:3001`
2. Launch the Electron desktop window

**Note:** You can edit files in `src/` and the Electron app will hot-reload automatically.

## 📦 Build for Production

To create a standalone `.exe` installer:

```bash
# Run as Administrator if on Windows (required for symlinks)
npm run electron:build
```

The installer will be generated in `dist/`.

> **Troubleshooting:**
> If the build fails with permission errors, verify you are running your terminal as **Administrator** or have **Developer Mode** enabled in Windows settings. This is required for `electron-builder` to extract signing tools correctly.

## 🛠 Project Structure

- `src/` - Next.js application source code
- `desktop-app/` - Electron main process code (`main.js`)
- `scripts/` - Custom build and launch scripts