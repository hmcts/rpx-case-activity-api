const config = require('config');
const debug = require('debug')('rpx-case-activity-api:redis-client');
const Redis = require('ioredis');

module.exports = require('./instantiator')(debug);
