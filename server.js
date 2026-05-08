'use strict';
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const { initDB } = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [`http://localhost:${PORT}`];

app.use(cors());

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(morgan(isProd ? 'combined' : 'dev'));

// ── Body parsing with size limits ─────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 500,                   // generous limit for a local CRM tool
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' },
});
app.use('/api/', limiter);

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/leads',      require('./routes/leads'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/contacts',   require('./routes/contacts'));
app.use('/api/analytics',  require('./routes/analytics'));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.use(function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use(function(err, _req, res, _next) {
  console.error(err.stack);
  const status  = err.status || 500;
  const message = isProd && status === 500 ? 'Internal server error' : err.message;
  res.status(status).json({ success: false, message });
});

// ── Start server ──────────────────────────────────────────────────────────────
initDB()
  .then(function() {
    const server = app.listen(PORT, function() {
      console.log('\n==============================');
      console.log('  LeadFlow CRM is running!');
      console.log('  http://localhost:' + PORT);
      console.log('==============================\n');
    });

    // Graceful shutdown – ensures in-flight requests finish and DB is flushed
    function shutdown(signal) {
      console.log('\n[' + signal + '] Shutting down gracefully…');
      server.close(function() {
        console.log('Server closed. Goodbye.');
        process.exit(0);
      });
      // Force-exit after 10 s if something hangs
      setTimeout(function() { process.exit(1); }, 10000).unref();
    }
    process.on('SIGTERM', function() { shutdown('SIGTERM'); });
    process.on('SIGINT',  function() { shutdown('SIGINT'); });
  })
  .catch(function(err) {
    console.error('Failed to start:', err);
    process.exit(1);
  });
