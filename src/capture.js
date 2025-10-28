const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const screenshotDesktop = require('screenshot-desktop');
const { format } = require('date-fns');

async function ensureDirectoryExists(dirPath) {
  await fsPromises.mkdir(dirPath, { recursive: true });
}

async function captureScreenshot(baseFolder) {
  const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
  const fileName = `Screenshot_${timestamp}.png`;
  const folderPath = path.resolve(baseFolder);
  await ensureDirectoryExists(folderPath);
  const filePath = path.join(folderPath, fileName);

  const img = await screenshotDesktop({ format: 'png' });
  await fsPromises.writeFile(filePath, img);

  return {
    filePath,
    fileName
  };
}

module.exports = {
  captureScreenshot
};
