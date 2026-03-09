'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildHelpIndex,
  normalizeHandler
} = require('../core/help-system');

function loadHandlers(handlersDir) {
  const files = fs.readdirSync(handlersDir)
    .filter(file => file.endsWith('.js'))
    .filter(file => !file.startsWith('_'));

  const handlers = [];

  for (const file of files) {
    const fullPath = path.join(handlersDir, file);
    const mod = require(fullPath);

    if (!mod || typeof mod.run !== 'function') {
      throw new Error(`Handler ${file} must export a run() function`);
    }

    handlers.push(normalizeHandler(mod));
  }

  return handlers;
}

function buildHandlersRegistry(handlersDir) {
  const handlers = loadHandlers(handlersDir);
  const helpIndex = buildHelpIndex(handlers);

  return {
    handlers,
    helpIndex
  };
}

module.exports = {
  buildHandlersRegistry
};
