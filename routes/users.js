'use strict';
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { run, queryAll, queryOne } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

const ROLE_LEVELS = {
  'Admin': 1,
  'Manager': 2, 'Sales Manager': 2, 'Regional Manager': 2,
  'Supervisor': 3, 'Team Lead': 3,
  'Sales': 4, 'Inside Sales': 4, 'Field Sales': 4, 'Marketing': 4, 'Employee': 4,
};

router.use(requireAdmin);

// GET all users (with manager details via self-join)
router.get('/', function(_req, res) {
  var users = queryAll(
    `SELECT u.id, u.name, u.email, u.role, u.username, u.is_admin, u.active,
            u.manager_id, u.hierarchy_level, u.created_at,
            m.name AS manager_name, m.role AS manager_role, m.hierarchy_level AS manager_level
     FROM users u
     LEFT JOIN users m ON u.manager_id = m.id
     ORDER BY COALESCE(u.hierarchy_level, 4), u.name`
  );
  res.json({ success: true, data: users });
});

// POST create user
router.post('/', async function(req, res) {
  var username   = (req.body.username || '').trim().toLowerCase();
  var password   = req.body.password || '';
  var name       = (req.body.name || '').trim();
  var email      = (req.body.email || '').trim() || null;
  var role       = req.body.role || 'Sales';
  var manager_id = req.body.manager_id || null;

  if (!username || !password || !name)
    return res.status(400).json({ success: false, message: 'username, password and name are required' });

  var existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing)
    return res.status(409).json({ success: false, message: 'Username already exists' });

  var hierarchy_level = ROLE_LEVELS[role] || 4;

  // Strict: must report to exactly one level above (L2→L1, L3→L2, L4→L3)
  if (manager_id) {
    var mgr = queryOne('SELECT id, hierarchy_level, role FROM users WHERE id = ? AND active = 1', [manager_id]);
    if (!mgr)
      return res.status(400).json({ success: false, message: 'Selected manager not found or is inactive' });
    var mgrLevel = mgr.hierarchy_level || ROLE_LEVELS[mgr.role] || 4;
    if (mgrLevel !== hierarchy_level - 1)
      return res.status(400).json({ success: false, message: 'Invalid reporting line: a Level ' + hierarchy_level + ' user must report to a Level ' + (hierarchy_level - 1) + ' user' });
  }

  try {
    var hash = await bcrypt.hash(password, 10);
    var id   = uuid();

    var emailVal = email || (username + '@user.local');
    var emailConflict = queryOne('SELECT id FROM users WHERE email = ?', [emailVal]);
    if (emailConflict)
      return res.status(409).json({ success: false, message: 'Email already in use' });

    run(
      'INSERT INTO users (id,name,email,role,username,password_hash,is_admin,active,manager_id,hierarchy_level) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, name, emailVal, role, username, hash, 0, 1, manager_id, hierarchy_level]
    );
    var user = queryOne(
      `SELECT u.id, u.name, u.email, u.role, u.username, u.is_admin, u.active,
              u.manager_id, u.hierarchy_level, u.created_at,
              m.name AS manager_name, m.role AS manager_role
       FROM users u LEFT JOIN users m ON u.manager_id = m.id WHERE u.id = ?`,
      [id]
    );
    res.status(201).json({ success: true, data: user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
});

// PUT update user (name, role, manager, optional password reset)
router.put('/:id', async function(req, res) {
  var target = queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ success: false, message: 'User not found' });
  if (target.is_admin) return res.status(400).json({ success: false, message: 'Cannot edit the admin account' });

  var name       = (req.body.name || '').trim() || target.name;
  var role       = req.body.role || target.role;
  var manager_id = req.body.hasOwnProperty('manager_id') ? (req.body.manager_id || null) : target.manager_id;
  var password   = req.body.password || '';

  var hierarchy_level = ROLE_LEVELS[role] || 4;

  // Strict one-level constraint
  if (manager_id) {
    var mgr = queryOne('SELECT id, hierarchy_level, role FROM users WHERE id = ? AND active = 1', [manager_id]);
    if (!mgr)
      return res.status(400).json({ success: false, message: 'Selected manager not found or is inactive' });
    var mgrLevel = mgr.hierarchy_level || ROLE_LEVELS[mgr.role] || 4;
    if (mgrLevel !== hierarchy_level - 1)
      return res.status(400).json({ success: false, message: 'Invalid reporting line: a Level ' + hierarchy_level + ' user must report to a Level ' + (hierarchy_level - 1) + ' user' });
  }

  try {
    if (password) {
      var hash = await bcrypt.hash(password, 10);
      run('UPDATE users SET name=?, role=?, manager_id=?, hierarchy_level=?, password_hash=? WHERE id=?',
          [name, role, manager_id, hierarchy_level, hash, req.params.id]);
    } else {
      run('UPDATE users SET name=?, role=?, manager_id=?, hierarchy_level=? WHERE id=?',
          [name, role, manager_id, hierarchy_level, req.params.id]);
    }
    var updated = queryOne(
      `SELECT u.id, u.name, u.email, u.role, u.username, u.is_admin, u.active,
              u.manager_id, u.hierarchy_level, u.created_at,
              m.name AS manager_name, m.role AS manager_role
       FROM users u LEFT JOIN users m ON u.manager_id = m.id WHERE u.id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to update user' });
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
