const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();
const SERVICE_NAME = 'mosaic-backend';

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

router.get('/ready', (_req, res) => {
  const connected = mongoose.connection.readyState === 1;

  res.status(connected ? 200 : 503).json({
    status: connected ? 'ready' : 'not_ready',
    database: connected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
