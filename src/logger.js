const log = require('electron-log').create('screensense');

log.transports.console.level = 'info';
log.transports.file.level = 'info';

module.exports = log;
