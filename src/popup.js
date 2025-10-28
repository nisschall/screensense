const statusEl = document.querySelector('[data-role="status"]');
const fileEl = document.querySelector('[data-role="file"]');
const descriptionEl = document.querySelector('[data-role="description"]');
const enhancedEl = document.querySelector('[data-role="enhanced"]');
const timestampEl = document.querySelector('[data-role="timestamp"]');
const shortcutEl = document.querySelector('[data-role="shortcut"]');
const categoryEl = document.querySelector('[data-role="category"]');
const toastEl = document.querySelector('[data-role="toast"]');
const enhanceBtn = document.querySelector('[data-action="enhance"]');
const deleteBtn = document.querySelector('[data-action="delete"]');
const closeBtn = document.querySelector('[data-action="close"]');
const actionsSection = document.querySelector('[data-role="actions"]');
const actionsListEl = document.querySelector('[data-role="actions-list"]');
const resourcesSection = document.querySelector('[data-role="resources"]');
const resourcesListEl = document.querySelector('[data-role="resources-list"]');

let toastTimer = null;
let state = {
  status: 'idle',
  aiStatus: 'idle',
  actions: [],
  resources: []
};

function formatTimestamp(isoString) {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function parseCategory(text) {
  if (!text) return null;
  const match = text.match(/Category:\s*([^|]+)/i);
  if (!match) return null;
  
  const category = match[1].trim().toLowerCase();
  
  if (category.includes('work') || category.includes('code') || category.includes('ide')) {
    return { type: 'work', label: 'Work Tools' };
  } else if (category.includes('entertainment') || category.includes('video') || category.includes('gaming')) {
    return { type: 'entertainment', label: 'Entertainment' };
  } else if (category.includes('communication') || category.includes('email') || category.includes('messaging')) {
    return { type: 'communication', label: 'Communication' };
  } else if (category.includes('productivity') || category.includes('document') || category.includes('spreadsheet')) {
    return { type: 'productivity', label: 'Productivity' };
  } else if (category.includes('browser') || category.includes('web')) {
    return { type: 'browser', label: 'Browser' };
  }
  return { type: 'other', label: 'Other' };
}

function extractAction(text) {
  if (!text) return text;
  const match = text.match(/Action:\s*(.+)/i);
  return match ? match[1].trim() : text;
}

function renderActions(actions = []) {
  if (!actionsSection || !actionsListEl) {
    return;
  }

  actionsListEl.innerHTML = '';
  const list = Array.isArray(actions) ? actions : [];

  if (list.length === 0) {
    actionsSection.hidden = true;
    return;
  }

  actionsSection.hidden = false;

  list.forEach(action => {
    const item = document.createElement('div');
    item.className = 'popup__action';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'popup__action-button';
    button.textContent = action?.title || 'Suggested action';
    button.addEventListener('click', () => handleActionClick(action));
    item.appendChild(button);

    if (action?.notes) {
      const notes = document.createElement('p');
      notes.className = 'popup__action-notes';
      notes.textContent = action.notes;
      item.appendChild(notes);
    }

    if (action?.command) {
      const command = document.createElement('code');
      command.className = 'popup__action-command';
      command.textContent = action.command;
      item.appendChild(command);
    }

    actionsListEl.appendChild(item);
  });
}

function renderResources(resources = []) {
  if (!resourcesSection || !resourcesListEl) {
    return;
  }

  resourcesListEl.innerHTML = '';
  const list = Array.isArray(resources) ? resources : [];

  if (list.length === 0) {
    resourcesSection.hidden = true;
    return;
  }

  resourcesSection.hidden = false;

  list.forEach(resource => {
    const item = document.createElement('div');
    item.className = 'popup__resource';

    const title = document.createElement('div');
    title.className = 'popup__resource-title';
    title.textContent = resource?.title || resource?.url || 'Resource';
    item.appendChild(title);

    if (resource?.reason) {
      const reason = document.createElement('p');
      reason.className = 'popup__resource-reason';
      reason.textContent = resource.reason;
      item.appendChild(reason);
    }

    if (resource?.url) {
      const url = document.createElement('code');
      url.className = 'popup__resource-url';
      url.textContent = resource.url;
      item.appendChild(url);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'popup__resource-button';
      button.textContent = 'Review resource';
      button.addEventListener('click', () => handleResourceClick(resource));
      item.appendChild(button);
    }

    resourcesListEl.appendChild(item);
  });
}

function updateUI(patch = {}) {
  state = { ...state, ...patch };

  const statusMap = {
    captured: 'Screenshot captured',
    'ai-complete': 'AI summary ready',
    'ai-enhanced': 'Enhanced summary ready',
    'ai-error': 'AI error',
    'ai-skipped': 'AI skipped',
    enhancing: 'Enhancing...',
    deleted: 'Deleted'
  };

  const aiStatusMap = {
    pending: 'Analyzing…',
    complete: 'AI summary ready',
    enhanced: 'Enhanced summary ready',
    error: 'AI error',
    disabled: 'AI disabled',
    skipped: 'AI skipped',
    enhancing: 'Enhancing…'
  };

  const statusText = state.message || statusMap[state.status] || aiStatusMap[state.aiStatus] || 'Ready';
  statusEl.textContent = statusText;

  fileEl.textContent = state.fileName
    ? `File: ${state.fileName}`
    : 'Waiting for screenshot…';

  if (state.aiDescription) {
    const category = parseCategory(state.aiDescription);
    const actionText = extractAction(state.aiDescription);
    
    if (category && categoryEl) {
      categoryEl.textContent = category.label;
      categoryEl.setAttribute('data-type', category.type);
      categoryEl.hidden = false;
    } else if (categoryEl) {
      categoryEl.hidden = true;
    }
    
    descriptionEl.innerHTML = marked.parse(actionText);
  } else if (state.aiStatus === 'pending' || state.status === 'captured') {
    descriptionEl.textContent = 'AI is analyzing the screenshot…';
    if (categoryEl) categoryEl.hidden = true;
  } else {
    descriptionEl.textContent = 'AI summary unavailable.';
    if (categoryEl) categoryEl.hidden = true;
  }

  if (state.aiEnhancedDescription) {
    enhancedEl.hidden = false;
    enhancedEl.innerHTML = marked.parse(state.aiEnhancedDescription);
  } else {
    enhancedEl.hidden = true;
    enhancedEl.textContent = '';
  }

  timestampEl.textContent = state.timestamp ? `Captured at ${formatTimestamp(state.timestamp)}` : '';
  shortcutEl.textContent = state.shortcut ? `Shortcut: ${state.shortcut}` : '';

  enhanceBtn.disabled = !state.canEnhance;
  deleteBtn.disabled = !state.canDelete;

  renderActions(state.actions || []);
  renderResources(state.resources || []);
}

function showToast(message, type) {
  if (!toastEl) {
    return;
  }

  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.remove('popup__toast--error', 'popup__toast--success');

  if (type === 'error') {
    toastEl.classList.add('popup__toast--error');
  } else if (type === 'success') {
    toastEl.classList.add('popup__toast--success');
  }

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

async function handleEnhance() {
  enhanceBtn.disabled = true;
  showToast('Enhancing…');

  try {
    const result = await window.screensense.requestEnhance();
    if (result?.ok) {
      showToast('Enhanced summary ready.', 'success');
    } else {
      const reason = result?.error || 'Unable to enhance screenshot.';
      showToast(reason, 'error');
      enhanceBtn.disabled = false;
    }
  } catch (error) {
    showToast(error.message || 'Enhancement failed.', 'error');
    enhanceBtn.disabled = false;
  }
}

async function handleDelete() {
  if (!window.confirm('Delete this screenshot?')) {
    return;
  }

  deleteBtn.disabled = true;
  try {
    const result = await window.screensense.requestDelete();
    if (result?.ok) {
      showToast('Screenshot deleted.', 'success');
      setTimeout(() => window.screensense.requestClose(), 800);
    } else {
      const reason = result?.error || 'Failed to delete screenshot.';
      showToast(reason, 'error');
      deleteBtn.disabled = false;
    }
  } catch (error) {
    showToast(error.message || 'Failed to delete screenshot.', 'error');
    deleteBtn.disabled = false;
  }
}

async function handleActionClick(action) {
  if (!window.screensense?.requestAction) {
    showToast('Action handler unavailable.', 'error');
    return;
  }

  try {
    const result = await window.screensense.requestAction(action);
    if (result?.ok) {
      if (result.copied) {
        showToast('Command copied to clipboard.', 'success');
      } else {
        showToast('Action acknowledged.', 'success');
      }
    } else if (result?.error) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    showToast(error.message || 'Unable to process action.', 'error');
  }
}

async function handleResourceClick(resource) {
  if (!window.screensense?.requestResource) {
    showToast('Resource handler unavailable.', 'error');
    return;
  }

  try {
    const result = await window.screensense.requestResource(resource);
    if (result?.ok) {
      if (result.opened) {
        showToast('Resource opened in browser.', 'success');
      } else if (result.copied) {
        showToast('Resource URL copied to clipboard.', 'success');
      }
    } else if (result?.error) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    showToast(error.message || 'Unable to open resource.', 'error');
  }
}

if (window.screensense?.onUpdate) {
  const unsubscribe = window.screensense.onUpdate(payload => {
    updateUI(payload);
  });
  window.addEventListener('beforeunload', unsubscribe);
}

if (enhanceBtn) {
  enhanceBtn.addEventListener('click', handleEnhance);
}

if (deleteBtn) {
  deleteBtn.addEventListener('click', handleDelete);
}

if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    window.screensense.requestClose();
  });
}

updateUI();
