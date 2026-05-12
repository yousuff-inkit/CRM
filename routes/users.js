'use strict';
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { run, queryAll, queryOne } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

// GET all users
router.get('/', function(_req, res) {
  var users = queryAll(
    'SELECT id, name, email, role, username, is_admin, active, created_at FROM users ORDER BY name'
  );
  res.json({ success: true, data: users });
});

// POST create user
router.post('/', async function(req, res) {
  var username = (req.body.username || '').trim().toLowerCase();
  var password = req.body.password || '';
  var name     = (req.body.name || '').trim();
  var email    = (req.body.email || '').trim() || null;
  var role     = req.body.role || 'Sales';

  if (!username || !password || !name)
    return res.status(400).json({ success: false, message: 'username, password and name are required' });

  var existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing)
    return res.status(409).json({ success: false, message: 'Username already exists' });

  try {
    var hash = await bcrypt.hash(password, 10);
    var id   = uuid();

    // If email is provided, check uniqueness; otherwise generate a placeholder
    var emailVal = email || (username + '@user.local');
    var emailConflict = queryOne('SELECT id FROM users WHERE email = ?', [emailVal]);
    if (emailConflict)
      return res.status(409).json({ success: false, message: 'Email already in use' });

    run(
      'INSERT INTO users (id,name,email,role,username,password_hash,is_admin,active) VALUES (?,?,?,?,?,?,?,?)',
      [id, name, emailVal, role, username, hash, 0, 1]
    );
    var user = queryOne(
      'SELECT id, name, email, role, username, is_admin, active, created_at FROM users WHERE id = ?',
      [id]
    );
    res.status(201).json({ success: true, data: user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
});

// DELETE (deactivate) user
router.delete('/:id', function(req, res) {
  var user = queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user)
    return res.status(404).json({ success: false, message: 'User not found' });
  if (user.is_admin)
    return res.status(400).json({ success: false, message: 'Cannot delete the admin account' });

  try {
    run('UPDATE users SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

module.exports = router;
