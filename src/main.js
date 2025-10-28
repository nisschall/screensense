const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const fs = require('fs');
const fsPromises = fs.promises;
const {
  app,
  Tray,
  Menu,
  shell,
  Notification,
  nativeImage,
  globalShortcut,
  BrowserWindow,
  ipcMain,
  screen,
  clipboard,
  dialog
} = require('electron');

const log = require('./logger');
const { loadConfig, saveConfig, CONFIG_PATH } = require('./config');
const { captureScreenshot } = require('./capture');
const { describeScreenshot } = require('./aiClient');
const { saveAiResult, removeAiResult } = require('./aiStore');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const FALLBACK_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAIElEQVR42mNkYGD4z4AFwDiqAhoGhgYGBob/BwZGAcCkAQAzswY6vj0X8gAAAABJRU5ErkJggg==';
const DEFAULT_SHORTCUTS = ['Ctrl+Shift+P', 'Ctrl+Alt+P'];
const POPUP_DIMENSIONS = { width: 420, height: 400 };
const POPUP_MARGIN = 12;

let tray = null;
let popupWindow = null;
let popupReady = false;
let pendingPopupPayload = null;

let config = loadConfig();
let aiEnabled = Boolean(config.ai_enabled);
let captureInProgress = false;
let enhanceInProgress = false;
let registeredShortcut = null;
let latestCapture = null;

function getDialogParent() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    return popupWindow;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  return null;
}

function normalizeShortcuts(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return [value.trim()].filter(Boolean);
  }
  return [];
}

function getShortcutCandidates() {
  const configured = normalizeShortcuts(config.capture_shortcut);
  return configured.length > 0 ? configured : [...DEFAULT_SHORTCUTS];
}

function getShortcutDisplay() {
  return registeredShortcut || getShortcutCandidates()[0] || 'Not set';
}

function getIconPath(enabled) {
  const file = enabled ? 'icon-on.png' : 'icon-off.png';
  const overridePath = path.resolve(__dirname, '..', 'build', file);
  if (fs.existsSync(overridePath)) {
    return overridePath;
  }
  const fallbackPath = path.resolve(__dirname, '..', 'build', 'icon.ico');
  return fs.existsSync(fallbackPath) ? fallbackPath : null;
}

function getTrayIcon(enabled) {
  const iconPath = getIconPath(enabled);
  if (iconPath) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  }
  return nativeImage.createFromBuffer(Buffer.from(FALLBACK_ICON_BASE64, 'base64'));
}

function showNotification(body) {
  if (!Notification.isSupported()) {
    log.info('Notification (fallback)', { body });
    return;
  }
  const notification = new Notification({
    title: 'ScreenSense',
    body
  });
  notification.show();
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const candidates = getShortcutCandidates();
  const displayShortcut = getShortcutDisplay();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Capture Screenshot Now',
      type: 'normal',
      accelerator: registeredShortcut ?? candidates[0] ?? undefined,
      click: () => {
        log.info('Manual capture triggered via tray menu');
        handleScreenshotTrigger();
      }
    },
    { type: 'separator' },
    {
      label: aiEnabled ? 'Disable AI' : 'Enable AI',
      type: 'normal',
      click: toggleAi
    },
    {
      label: 'Open Screenshot Folder',
      type: 'normal',
      click: () => shell.openPath(path.resolve(config.screenshot_folder))
    },
    {
      label: 'View Log',
      type: 'normal',
      click: () => {
        const logPath = log.transports.file.findLogPath();
        shell.openPath(logPath);
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      type: 'normal',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(`ScreenSense | AI ${aiEnabled ? 'ON' : 'OFF'} | Shortcut: ${displayShortcut}`);
  tray.setImage(getTrayIcon(aiEnabled));
}

function toggleAi() {
  aiEnabled = !aiEnabled;
  config.ai_enabled = aiEnabled;
  try {
    saveConfig(config);
  } catch (error) {
    log.error('Failed to persist AI toggle', error);
  }
  log.info(`AI toggled: ${aiEnabled ? 'enabled' : 'disabled'}`);
  updateTrayMenu();
  showNotification(`AI ${aiEnabled ? 'enabled' : 'disabled'}`);
  if (latestCapture) {
    sendPopupUpdate();
  }
}

function ensurePopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    return popupWindow;
  }

  popupWindow = new BrowserWindow({
    width: POPUP_DIMENSIONS.width,
    height: POPUP_DIMENSIONS.height,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    transparent: false,
    backgroundColor: '#1a1a1af2',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  popupReady = false;

  popupWindow.on('closed', () => {
    popupWindow = null;
    popupReady = false;
    pendingPopupPayload = null;
  });

  popupWindow.webContents.on('did-finish-load', () => {
    popupReady = true;
    positionPopupWindow(popupWindow);
    if (pendingPopupPayload) {
      popupWindow.webContents.send('popup:update', pendingPopupPayload);
      pendingPopupPayload = null;
    }
  });

  popupWindow.loadFile(path.join(__dirname, 'popup.html'));
  return popupWindow;
}

function positionPopupWindow(win) {
  if (!win || win.isDestroyed()) {
    return;
  }
  const { width, height } = win.getBounds();
  const targetDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = targetDisplay.workArea;
  const x = Math.round(workArea.x + workArea.width - width - POPUP_MARGIN);
  const y = Math.max(workArea.y + POPUP_MARGIN, workArea.y);
  win.setPosition(x, y, false);
}

function buildPopupPayload(partial = {}) {
  const hasDescription = Boolean(latestCapture?.aiDescription);
  const payload = {
    fileName: latestCapture?.fileName ?? null,
    filePath: latestCapture?.filePath ?? null,
    timestamp: latestCapture?.timestamp ?? new Date().toISOString(),
    aiStatus: latestCapture?.aiStatus ?? 'idle',
    aiDescription: latestCapture?.aiDescription ?? null,
    aiEnhancedDescription: latestCapture?.aiEnhancedDescription ?? null,
    actions: Array.isArray(latestCapture?.actions) ? latestCapture.actions : [],
    resources: Array.isArray(latestCapture?.resources) ? latestCapture.resources : [],
    canEnhance:
      Boolean(aiEnabled) &&
      hasDescription &&
      !enhanceInProgress &&
      ['complete', 'enhanced'].includes(latestCapture?.aiStatus),
    canDelete: Boolean(latestCapture),
    shortcut: getShortcutDisplay(),
    ...partial
  };
  return payload;
}

function sendPopupUpdate(partial = {}) {
  const payload = buildPopupPayload(partial);
  const win = ensurePopupWindow();

  if (popupReady) {
    win.webContents.send('popup:update', payload);
  } else {
    pendingPopupPayload = payload;
  }

  positionPopupWindow(win);
  if (win.isVisible()) {
    win.show();
  } else {
    win.showInactive?.();
  }
}

async function handleScreenshotTrigger() {
  if (captureInProgress) {
    log.warn('Capture already in progress; ignoring trigger');
    return;
  }

  captureInProgress = true;

  try {
    const { filePath, fileName } = await captureScreenshot(config.screenshot_folder);
    const timestamp = new Date().toISOString();
    latestCapture = {
      filePath,
      fileName,
      timestamp,
      aiStatus: aiEnabled ? 'pending' : 'disabled',
      aiDescription: null,
      aiEnhancedDescription: null,
      actions: [],
      resources: []
    };

    log.info('Screenshot captured', { filePath });
    showNotification('Screenshot captured!');

    sendPopupUpdate({
      status: 'captured',
      message: aiEnabled
        ? 'Screenshot captured. Running AI analysis...'
        : 'Screenshot captured.'
    });

    if (aiEnabled) {
      try {
        const aiResult = await describeScreenshot(filePath, config, log);
        if (aiResult && aiResult.description) {
          latestCapture.aiStatus = 'complete';
          latestCapture.aiDescription = aiResult.description;
          latestCapture.aiModel = aiResult.model;
          latestCapture.aiResponseId = aiResult.responseId;
          latestCapture.actions = Array.isArray(aiResult.actions) ? aiResult.actions : [];
          latestCapture.resources = Array.isArray(aiResult.resources) ? aiResult.resources : [];

          const entry = {
            file: fileName,
            ai_description: aiResult.description,
            timestamp,
            model: aiResult.model,
            responseId: aiResult.responseId,
            actions: latestCapture.actions,
            resources: latestCapture.resources
          };
          const aiLogPath = await saveAiResult(config, entry);
          log.info('AI result saved', { aiLogPath });
          showNotification(`AI: ${aiResult.description}`);
          sendPopupUpdate({
            status: 'ai-complete',
            message: 'AI summary ready.',
            aiDescription: aiResult.description
          });
        } else {
          latestCapture.aiStatus = 'skipped';
          latestCapture.actions = [];
          latestCapture.resources = [];
          sendPopupUpdate({
            status: 'ai-skipped',
            message: 'AI description unavailable. Check API key configuration.'
          });
        }
      } catch (error) {
        latestCapture.aiStatus = 'error';
        latestCapture.actions = [];
        latestCapture.resources = [];
        log.error('AI analysis failed', error);
        showNotification('AI analysis failed. Check logs for details.');
        sendPopupUpdate({
          status: 'ai-error',
          message: 'AI analysis failed. Check logs for details.',
          error: error.message
        });
      }
    }
  } catch (error) {
    log.error('Failed to capture screenshot', error);
    showNotification('Failed to capture screenshot. Check logs for details.');
  } finally {
    captureInProgress = false;
  }
}

function registerCaptureShortcut() {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  }

  const candidates = getShortcutCandidates();
  for (const candidate of candidates) {
    const success = globalShortcut.register(candidate, () => {
      log.info('Capture shortcut pressed', { shortcut: candidate });
      handleScreenshotTrigger();
    });
    if (success) {
      registeredShortcut = candidate;
      log.info('Capture shortcut registered', { shortcut: candidate });
      break;
    }
    log.warn('Failed to register shortcut candidate', { shortcut: candidate });
  }

  if (!registeredShortcut) {
    const display = candidates[0] || 'Not set';
    log.error('Unable to register any capture shortcuts', { candidates });
    showNotification(`ScreenSense could not register shortcut ${display}.`);
  }

  updateTrayMenu();
}

function createTray() {
  const icon = getTrayIcon(aiEnabled);
  tray = new Tray(icon);
  updateTrayMenu();
}

function watchConfigFile() {
  fs.watchFile(CONFIG_PATH, { interval: 2000 }, () => {
    try {
      const updatedConfig = loadConfig();
      config = updatedConfig;
      aiEnabled = Boolean(config.ai_enabled);
      log.info('Config reloaded from disk');
      updateTrayMenu();
      if (app.isReady()) {
        registerCaptureShortcut();
        if (latestCapture) {
          sendPopupUpdate();
        }
      }
    } catch (error) {
      log.error('Failed to reload config', error);
    }
  });
}

ipcMain.handle('popup:action', async (_event, rawAction) => {
  if (!rawAction || typeof rawAction !== 'object') {
    return { ok: false, error: 'Invalid action payload' };
  }

  const action = {
    title: typeof rawAction.title === 'string' ? rawAction.title : 'Suggested action',
    command: typeof rawAction.command === 'string' ? rawAction.command : '',
    notes: typeof rawAction.notes === 'string' ? rawAction.notes : ''
  };

  const windowForDialog = getDialogParent();
  const buttons = action.command ? ['Copy to Clipboard', 'Cancel'] : ['OK', 'Cancel'];
  const detailParts = [];

  if (action.command) {
    detailParts.push(action.command);
  }
  if (action.notes) {
    detailParts.push(action.notes);
  }

  const detail = detailParts.length > 0 ? detailParts.join('\n\n') : undefined;

  const result = await dialog.showMessageBox(windowForDialog ?? undefined, {
    type: 'question',
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    title: 'Confirm Assistant Action',
    message: action.title,
    detail,
    noLink: true,
    normalizeAccessKeys: true
  });

  if (result.response !== 0) {
    log.info('Assistant action cancelled', { title: action.title });
    return { ok: false, cancelled: true };
  }

  if (action.command) {
    clipboard.writeText(action.command);
    log.info('Assistant action copied to clipboard', { title: action.title });
    return { ok: true, copied: true };
  }

  log.info('Assistant action acknowledged', { title: action.title });
  return { ok: true, copied: false };
});

ipcMain.handle('popup:resource', async (_event, rawResource) => {
  if (!rawResource || typeof rawResource !== 'object') {
    return { ok: false, error: 'Invalid resource payload' };
  }

  const resource = {
    title: typeof rawResource.title === 'string' ? rawResource.title : 'Reference',
    url: typeof rawResource.url === 'string' ? rawResource.url : '',
    reason: typeof rawResource.reason === 'string' ? rawResource.reason : ''
  };

  if (!resource.url) {
    return { ok: false, error: 'Resource is missing a URL' };
  }

  const windowForDialog = getDialogParent();
  const buttons = ['Open Link', 'Copy URL', 'Cancel'];
  const detailParts = [resource.url];
  if (resource.reason) {
    detailParts.push(resource.reason);
  }

  const result = await dialog.showMessageBox(windowForDialog ?? undefined, {
    type: 'question',
    buttons,
    defaultId: 0,
    cancelId: 2,
    title: 'Open Suggested Resource',
    message: resource.title,
    detail: detailParts.join('\n\n'),
    noLink: true,
    normalizeAccessKeys: true
  });

  if (result.response === 0) {
    try {
      await shell.openExternal(resource.url);
      log.info('Opened assistant resource', { title: resource.title, url: resource.url });
      return { ok: true, opened: true };
    } catch (error) {
      log.error('Failed to open assistant resource', { error, url: resource.url });
      return { ok: false, error: error.message };
    }
  }

  if (result.response === 1) {
    clipboard.writeText(resource.url);
    log.info('Assistant resource URL copied', { title: resource.title, url: resource.url });
    return { ok: true, copied: true };
  }

  log.info('Assistant resource dismissed', { title: resource.title });
  return { ok: false, cancelled: true };
});

ipcMain.handle('popup:enhance', async () => {
  if (!latestCapture) {
    return { ok: false, error: 'No capture available' };
  }
  if (!aiEnabled) {
    return { ok: false, error: 'AI is disabled' };
  }
  if (enhanceInProgress) {
    return { ok: false, error: 'Enhancement already running' };
  }

  enhanceInProgress = true;
  const previousStatus = latestCapture.aiStatus;
  latestCapture.aiStatus = 'enhancing';
  sendPopupUpdate({
    status: 'enhancing',
    message: 'Requesting enhanced description...'
  });

  try {
    const result = await describeScreenshot(latestCapture.filePath, config, log, {
      promptOverride: config.ai_enhance_prompt
    });

    if (result && result.description) {
      latestCapture.aiStatus = 'enhanced';
      latestCapture.aiEnhancedDescription = result.description;
      latestCapture.aiModel = result.model;
      latestCapture.aiResponseId = result.responseId;
      if (Array.isArray(result.actions) && result.actions.length > 0) {
        latestCapture.actions = result.actions;
      }
      if (Array.isArray(result.resources) && result.resources.length > 0) {
        latestCapture.resources = result.resources;
      }

      await saveAiResult(config, {
        file: latestCapture.fileName,
        ai_description: latestCapture.aiDescription,
        ai_enhanced_description: result.description,
        timestamp: latestCapture.timestamp,
        model: result.model,
        responseId: result.responseId,
        actions: latestCapture.actions,
        resources: latestCapture.resources,
        enhanced_actions: Array.isArray(result.actions) ? result.actions : [],
        enhanced_resources: Array.isArray(result.resources) ? result.resources : []
      });

      sendPopupUpdate({
        status: 'ai-enhanced',
        message: 'Enhanced description ready.',
        aiEnhancedDescription: result.description
      });
      showNotification('AI enhancement ready.');
      return { ok: true };
    }

    latestCapture.aiStatus = 'enhanced';
    sendPopupUpdate({
      status: 'ai-enhanced',
      message: 'AI enhancement returned no additional details.'
    });
    return { ok: false, error: 'No enhanced description returned' };
  } catch (error) {
    latestCapture.aiStatus = previousStatus ?? 'complete';
    log.error('AI enhancement failed', error);
    sendPopupUpdate({
      status: 'ai-error',
      message: 'AI enhancement failed. Check logs for details.',
      error: error.message
    });
    showNotification('AI enhancement failed. Check logs for details.');
    return { ok: false, error: error.message };
  } finally {
    enhanceInProgress = false;
  }
});

ipcMain.handle('popup:delete', async () => {
  if (!latestCapture) {
    return { ok: false, error: 'Nothing to delete' };
  }

  try {
    await fsPromises.unlink(latestCapture.filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log.error('Failed to delete screenshot file', error);
      sendPopupUpdate({
        status: 'delete-error',
        message: 'Failed to delete screenshot. Check logs for details.',
        error: error.message
      });
      return { ok: false, error: error.message };
    }
  }

  try {
    await removeAiResult(config, latestCapture.fileName);
  } catch (error) {
    log.warn('Failed to prune AI log for deleted screenshot', error);
  }

  const deletedFile = latestCapture.fileName;
  latestCapture = null;
  showNotification('Screenshot deleted.');

  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.hide();
  }

  return { ok: true, deletedFile };
});

ipcMain.on('popup:close', () => {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.hide();
  }
});

app.disableHardwareAcceleration();
app.setAppUserModelId('com.screensense.app');

app.whenReady().then(() => {
  log.info('ScreenSense starting');
  createTray();
  registerCaptureShortcut();
  watchConfigFile();

  screen.on('display-metrics-changed', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      positionPopupWindow(popupWindow);
    }
  });

  app.on('second-instance', () => {
    if (tray) {
      const balloonIcon = getTrayIcon(aiEnabled);
      tray.displayBalloon({
        icon: balloonIcon,
        title: 'ScreenSense',
        content: 'App is already running in the tray.'
      });
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  if (tray) {
    tray.destroy();
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.destroy();
  }
  fs.unwatchFile(CONFIG_PATH);
  log.info('ScreenSense shutting down');
});

app.on('window-all-closed', event => {
  event.preventDefault();
});
