const supertest = require('supertest');

function createAgent(app) {
  return supertest.agent(app);
}

function parseCookies(setCookieHeader) {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];

  return headers.reduce((acc, header) => {
    const [pair] = header.split(';');
    const idx = pair.indexOf('=');
    if (idx === -1) {
      return acc;
    }
    acc[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    return acc;
  }, {});
}

module.exports = { createAgent, parseCookies };
