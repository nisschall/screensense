const fs = require('fs/promises');
const path = require('path');

async function loadExisting(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function saveAiResult(config, entry) {
  const folder = path.resolve(config.screenshot_folder);
  const filePath = path.join(folder, 'ai_results.json');
  const limit = config.log_limit || 100;

  let data = await loadExisting(filePath);

  const existingIndex = data.findIndex(item => item.file === entry.file);
  if (existingIndex >= 0) {
    data[existingIndex] = { ...data[existingIndex], ...entry };
  } else {
    data.push(entry);
  }

  if (data.length > limit) {
    data = data.slice(data.length - limit);
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

  return filePath;
}

async function removeAiResult(config, fileName) {
  const folder = path.resolve(config.screenshot_folder);
  const filePath = path.join(folder, 'ai_results.json');

  const data = await loadExisting(filePath);
  const filtered = data.filter(entry => entry.file !== fileName);

  if (filtered.length === data.length) {
    return filePath;
  }

  await fs.writeFile(filePath, JSON.stringify(filtered, null, 2), 'utf8');
  return filePath;
}

module.exports = {
  saveAiResult,
  removeAiResult
};
