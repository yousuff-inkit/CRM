'use strict';
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const { queryOne } = require('../db/database');

router.post('/login', async function(req, res) {
  var username = (req.body.username || '').trim().toLowerCase();
  var password = req.body.password || '';

  if (!username || !password)
    return res.status(400).json({ success: false, message: 'Username and password are required' });

  var user = queryOne('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!user || !user.password_hash)
    return res.status(401).json({ success: false, message: 'Invalid username or password' });

  var valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return res.status(401).json({ success: false, message: 'Invalid username or password' });

  req.session.user = {
    id:       user.id,
    name:     user.name,
    email:    user.email,
    role:     user.role,
    username: user.username,
    is_admin: user.is_admin ? 1 : 0,
  };
  res.json({ success: true, data: req.session.user });
});

router.post('/logout', function(req, res) {
  req.session.destroy(function() {
    res.json({ success: true });
  });
});

router.get('/me', function(req, res) {
  if (!req.session || !req.session.user)
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  res.json({ success: true, data: req.session.user });
});

module.exports = router;
