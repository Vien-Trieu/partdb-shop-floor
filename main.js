const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

const isDev = !app.isPackaged;
let win;

function startBackend() {
  if (isDev) {
    console.log(
      "⚙️ Dev mode: assuming backend is run separately on http://localhost:3002",
    );
    return;
  }

  // Correct path: executable was packaged into resources/backend/
  const exeName =
    process.platform === "win32" ? "partdb-backend.exe" : "partdb-backend";
  const backendExe = path.join(process.resourcesPath, "backend", exeName);

  console.log(
    "🔍 Backend launch attempt. resourcesPath:",
    process.resourcesPath,
  );
  console.log("🔍 Expected backend executable at:", backendExe);

  if (!fs.existsSync(backendExe)) {
    const msg = `Backend executable not found at ${backendExe}`;
    console.error("❌", msg);
    dialog.showErrorBox("Backend Missing", msg);
    return;
  }

  const backendProcess = spawn(backendExe, [], {
    cwd: path.dirname(backendExe),
    stdio: "inherit",
    env: { ...process.env, PORT: "3002" },
  });

  backendProcess.on("error", (err) => {
    console.error("❌ Failed to spawn backend:", err);
    dialog.showErrorBox("Backend Spawn Failed", err.message);
  });

  backendProcess.on("exit", (code, signal) => {
    console.log(`🔚 Backend exited. code=${code} signal=${signal}`);
  });
}

function createWindow() {
  if (win) return;

  console.log("🛠 Launching Electron app...");
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (isDev) {
    console.log("⚙️ Development mode: loading Vite server");
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    console.log("🚀 Production mode: starting backend and loading frontend");
    startBackend();
    win.loadFile(path.join(__dirname, "client/dist/index.html"));
  }
}

app.whenReady().then(createWindow).catch(console.error);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
