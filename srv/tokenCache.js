const NodeCache = require("node-cache");
const jwtDecode = require("jwt-decode");

const tokenCache = new NodeCache();

const getToken = function (token) {
  return tokenCache.get(token);
};

const setToken = function (token, exchangedToken) {
  tokenCache.set(token, exchangedToken, jwtDecode(exchangedToken).exp || 3600);
};

const getStats = function () {
  return tokenCache.getStats();
};

module.exports = { getToken, setToken, getStats };
