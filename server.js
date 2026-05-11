'use strict';
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const path       = require('path');
const session    = require('express-session');
const rateLimit  = require('express-rate-limit');
const { initDB } = require('./db/database');
const { requireAuth } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(morgan(isProd ? 'combined' : 'dev'));

// ── Body parsing with size limits ─────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// ── Sessions ──────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'crm-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,          // set true when using HTTPS
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' },
});
app.use('/api/', limiter);

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Public API routes (no auth required) ─────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Protected API routes ──────────────────────────────────────────────────────
app.use('/api/leads',      requireAuth, require('./routes/leads'));
app.use('/api/activities', requireAuth, require('./routes/activities'));
app.use('/api/contacts',   requireAuth, require('./routes/contacts'));
app.use('/api/analytics',  requireAuth, require('./routes/analytics'));
app.use('/api/users',      require('./routes/users')); // requireAdmin is inside

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
      console.log('  Default login: admin / admin123');
      console.log('==============================\n');
    });

    function shutdown(signal) {
      console.log('\n[' + signal + '] Shutting down gracefully…');
      server.close(function() {
        console.log('Server closed. Goodbye.');
        process.exit(0);
      });
      setTimeout(function() { process.exit(1); }, 10000).unref();
    }
    process.on('SIGTERM', function() { shutdown('SIGTERM'); });
    process.on('SIGINT',  function() { shutdown('SIGINT'); });
  })
  .catch(function(err) {
    console.error('Failed to start:', err);
    process.exit(1);
  });
