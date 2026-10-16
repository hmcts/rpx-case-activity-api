#!/usr/bin/env node

/**
 * Module dependencies.
 */
require('@hmcts/properties-volume').addTo(require('config'));
const { Logger } = require('@hmcts/nodejs-logging');
const { normalizePort, onListening, onServerError } = require('./app/util/utils');
const debug = require('debug')('rpx-case-activity-api:server');
const http = require('node:http');
const app = require('./app');

const logger = Logger.getLogger('server');

/**
 * Get port from environment and store in Express.
 */
const port = normalizePort(process.env.PORT || '3460');
logger.warn(`Starting on port ${port}`);
app.set('port', port);

/**
 * Create HTTP server.
 */
const server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */

logger.warn(`Listening on port ${port}`);
server.listen(port);

logger.warn(`Server started on port ${port}`);

logger.warn('Registering onServerError handler');

server.on('error', onServerError(port, (message) => {
  logger.warn(message);
}, process.exit));

logger.warn('Registering onListening handler');

server.on('listening', onListening(server, debug));
