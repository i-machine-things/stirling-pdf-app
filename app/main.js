const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');

// Dev: jar + runtime state both live in ../backend next to this checkout.
// Packaged: the jar ships read-only as an extraResource; runtime state (configs,
// logs, uploaded files) needs a writable dir instead, so that lives under userData.
const BACKEND_JAR = app.isPackaged
  ? path.join(process.resourcesPath, 'Stirling-PDF.jar')
  : path.join(__dirname, '..', 'backend', 'Stirling-PDF.jar');
const BACKEND_WORKDIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'backend')
  : path.join(__dirname, '..', 'backend');

const APP_URL = 'http://localhost:8080';
const LOG_FILE = path.join(BACKEND_WORKDIR, 'stirling-backend.log');
const READY_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 500;

function resolveJavaBin() {
  const sdkmanJava = path.join(os.homedir(), '.sdkman', 'candidates', 'java', 'current', 'bin', 'java');
  if (fs.existsSync(sdkmanJava)) return sdkmanJava;
  return 'java';
}

let backendProcess = null;
let mainWindow = null;

function startBackend() {
  fs.mkdirSync(BACKEND_WORKDIR, { recursive: true });

  const javaBin = resolveJavaBin();
  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

  backendProcess = spawn(javaBin, ['-jar', BACKEND_JAR], {
    cwd: BACKEND_WORKDIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.pipe(logStream);
  backendProcess.stderr.pipe(logStream);

  backendProcess.on('exit', (code, signal) => {
    backendProcess = null;
    if (code !== null && code !== 0) {
      console.error(`Stirling-PDF backend exited with code ${code} (signal ${signal})`);
    }
  });

  backendProcess.on('error', (err) => {
    dialog.showErrorBox('Stirling PDF', `Failed to start backend (${javaBin}):\n${err.message}`);
  });
}

function waitForBackend(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    function poll() {
      const req = http.get(APP_URL, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          resolve(false);
        } else {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      });
      req.setTimeout(2000, () => req.destroy());
    }
    poll();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Stirling PDF',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        '<body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;background:#1e1e1e;color:#ddd"><p>Starting Stirling PDF&hellip;</p></body>'
      )
  );
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function boot() {
  startBackend();
  createWindow();

  const ready = await waitForBackend(READY_TIMEOUT_MS);
  if (!mainWindow) return;

  if (ready) {
    mainWindow.loadURL(APP_URL);
  } else {
    mainWindow.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          `<body style="font-family:sans-serif;padding:2rem"><h2>Stirling PDF backend did not start</h2><p>Check the log at ${LOG_FILE}</p></body>`
        )
    );
  }
}

function killBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot);

  app.on('window-all-closed', () => {
    killBackend();
    app.quit();
  });

  app.on('before-quit', killBackend);
}
