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
// eslint-disable-next-line no-console
console.log(`[${new Date().toISOString()}] Starting on port ${port}`);
logger.warn(`Starting on port ${port}`);
app.set('port', port);

/**
 * Create HTTP server.
 */
const server = http.createServer(app);

/**
 * Create the socket server.
 *
 * This runs on the same server, in parallel to the RESTful interface. At the present
 * time, interoperability is turned off to keep them isolated but, with a couple of
 * tweaks, it can easily be enabled:
 *
 *   * Adjust the prefixes in socket/redis/keys.js to be the same as the RESTful ones.
 *     * This will immediately allow the RESTful interface to see what people on sockets
 *       are viewing/editing.
 *   * Add redis.publish(...) calls in service/activity-service.js.
 *     * To notify those on sockets when someone is viewing or editing a case.
 */
const redis = require('./app/redis/redis-client');
require('./app/socket')(server, redis);

/**
 * Listen on provided port, on all network interfaces.
 */

// eslint-disable-next-line no-console
console.log(`[${new Date().toISOString()}] Listening on port ${port}`);
logger.warn(`Listening on port ${port}`);
server.listen(port);

// eslint-disable-next-line no-console
console.log(`[${new Date().toISOString()}] Server started on port ${port}`);
logger.warn(`Server started on port ${port}`);

// eslint-disable-next-line no-console
console.log(`[${new Date().toISOString()}] Registering onServerError handler`);
logger.warn('Registering onServerError handler');

server.on('error', onServerError(port, (message) => {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] ${message}`);
  logger.warn(message);
}, process.exit));

// eslint-disable-next-line no-console
console.log(`[${new Date().toISOString()}] Registering onListening handler`);
logger.warn('Registering onListening handler');

server.on('listening', onListening(server, debug));
