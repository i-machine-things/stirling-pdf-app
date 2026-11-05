const __dbg = (name, data) => { try { require('fs').writeFileSync('C:\\stirling-debug-' + name + '.log', String(data) + '\n', { flag: 'a' }); } catch (e) {} };
__dbg('top', 'main.js top reached, pid=' + process.pid + ', isPackaged check pending');
process.on('uncaughtException', (e) => { __dbg('crash', e && e.stack || e); });
process.on('unhandledRejection', (e) => { __dbg('rejection', e && e.stack || e); });
process.on('exit', (code) => { __dbg('exit', 'exit event code=' + code); });
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

// disableHardwareAcceleration() alone is the fix for WSLg's GPU process failing
// to start during dev. Previously this also added --disable-gpu, --disable-
// software-rasterizer, and --disable-gpu-compositing on top, which removed the
// software (SwiftShader) fallback too -- on a real desktop GPU that leaves no
// render path at all, so the app silently exited with no window and no crash
// log. disableHardwareAcceleration() by itself keeps that fallback available.
app.disableHardwareAcceleration();

// Dev: jar + runtime state both live in ../backend next to this checkout.
// Packaged: the jar ships read-only as an extraResource; runtime state (configs,
// logs, uploaded files) needs a writable dir instead, so that lives under userData.
const BACKEND_JAR = app.isPackaged
  ? path.join(process.resourcesPath, 'Stirling-PDF.jar')
  : path.join(__dirname, '..', 'backend', 'Stirling-PDF.jar');
const BACKEND_WORKDIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'backend')
  : path.join(__dirname, '..', 'backend');

// Loopback-only: the no-login backend has no auth, so it must not be reachable
// from other devices on the network while the app is running.
const BACKEND_ADDRESS = '127.0.0.1';
const APP_URL = `http://${BACKEND_ADDRESS}:8080`;
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

  backendProcess = spawn(javaBin, ['-jar', BACKEND_JAR, `--server.address=${BACKEND_ADDRESS}`], {
    cwd: BACKEND_WORKDIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // { end: false } so one stream finishing (e.g. stdout at exit) doesn't end
  // logStream while the other is still writing — that would throw a
  // write-after-end error with no handler for it. Close logStream ourselves
  // once the child is fully gone instead.
  backendProcess.stdout.pipe(logStream, { end: false });
  backendProcess.stderr.pipe(logStream, { end: false });

  backendProcess.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`Stirling-PDF backend exited with code ${code} (signal ${signal})`);
    }
  });

  backendProcess.on('close', () => {
    backendProcess = null;
    logStream.end();
  });

  backendProcess.on('error', (err) => {
    dialog.showErrorBox('Stirling PDF', `Failed to start backend (${javaBin}):\n${err.message}`);
  });
}

function waitForBackend(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    function poll() {
      // If the child already died (crash, bad jar, port in use) there's no point
      // continuing to poll until the timeout — bail out immediately.
      if (!backendProcess) {
        resolve(false);
        return;
      }
      const req = http.get(APP_URL, (res) => {
        res.resume();
        // Only a real 200 counts as "ready" — a transient error response during
        // startup (or anything else on this port) must not end the poll early.
        if (res.statusCode === 200) {
          resolve(true);
        } else if (Date.now() > deadline) {
          resolve(false);
        } else {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
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
  __dbg('boot', 'boot() entered, isPackaged=' + app.isPackaged);
  startBackend();
  __dbg('boot', 'startBackend() returned');
  __dbg('boot', 'about to createWindow()');
  createWindow();
  __dbg('boot', 'createWindow() returned');

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

  app.whenReady().then(boot).catch((err) => {
    // boot() can throw before createWindow() runs (e.g. mkdirSync failing on
    // BACKEND_WORKDIR) — without this, that's an unhandled rejection and the
    // app just sits running with no window and no indication why.
    dialog.showErrorBox('Stirling PDF', `Failed to start: ${err.message}`);
    app.quit();
  });

  app.on('window-all-closed', () => {
    killBackend();
    app.quit();
  });

  app.on('before-quit', killBackend);
}
