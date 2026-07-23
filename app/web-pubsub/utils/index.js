const other = require('./other');
const get = require('./get');
const remove = require('./remove');
const store = require('./store');

module.exports = {
  ...other,
  get,
  remove,
  store
};
