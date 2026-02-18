const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");

const DEV_URL = "http://localhost:3001";
let mainWindow = null;

function createWindow() {
    const isDev = !app.isPackaged;

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: "MedFlow AI",
        backgroundColor: "#0a0f1a",
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.once("ready-to-show", () => mainWindow.show());

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });

    if (isDev) {
        mainWindow.loadURL(DEV_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, "..", "out", "index.html"));
    }

    mainWindow.on("closed", () => { mainWindow = null; });
}

function buildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: "MedFlow AI",
            submenu: [
                { label: "About MedFlow AI", role: "about" },
                { type: "separator" },
                { label: "Quit", accelerator: "CmdOrCtrl+Q", role: "quit" },
            ],
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" }, { role: "redo" }, { type: "separator" },
                { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
            ],
        },
        {
            label: "View",
            submenu: [
                { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
                { type: "separator" }, { role: "togglefullscreen" },
            ],
        },
        { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
    ]));
}

app.whenReady().then(() => {
    ipcMain.handle("get-version", () => app.getVersion());
    ipcMain.on("window-minimize", () => mainWindow && mainWindow.minimize());
    ipcMain.on("window-maximize", () => {
        if (mainWindow && mainWindow.isMaximized()) mainWindow.unmaximize();
        else if (mainWindow) mainWindow.maximize();
    });
    ipcMain.on("window-close", () => mainWindow && mainWindow.close());

    buildMenu();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
