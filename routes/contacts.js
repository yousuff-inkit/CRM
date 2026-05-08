'use strict';
const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const { run, queryAll, queryOne } = require('../db/database');

// ── GET contacts ──────────────────────────────────────────────────────────────
router.get('/', function(req, res) {
  var sql = 'SELECT c.*, l.name as lead_name, l.company FROM contacts c LEFT JOIN leads l ON c.lead_id = l.id';
  var p   = [];
  if (req.query.lead_id) { sql += ' WHERE c.lead_id = ?'; p.push(req.query.lead_id); }
  sql += ' ORDER BY c.is_decision_maker DESC, c.name ASC';
  res.json({ success: true, data: queryAll(sql, p) });
});

// ── POST create contact ───────────────────────────────────────────────────────
router.post('/', function(req, res) {
  var b = req.body;
  if (!b.name || !String(b.name).trim())
    return res.status(400).json({ success: false, message: 'name is required' });

  // If lead_id is given, verify the lead exists
  if (b.lead_id) {
    var lead = queryOne('SELECT id FROM leads WHERE id = ?', [b.lead_id]);
    if (!lead)
      return res.status(404).json({ success: false, message: 'Lead not found' });
  }

  var id = uuid();
  try {
    run(
      `INSERT INTO contacts (id,lead_id,name,designation,email,phone,linkedin,location,role_tag,is_decision_maker,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.lead_id || null, String(b.name).trim(),
       b.designation || null, b.email    || null,
       b.phone       || null, b.linkedin || null,
       b.location    || null, b.role_tag || null,
       (b.is_decision_maker === true || b.is_decision_maker === 1 || b.is_decision_maker === '1') ? 1 : 0,
       b.notes || null]
    );
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to create contact' });
  }

  res.status(201).json({ success: true, data: queryOne('SELECT * FROM contacts WHERE id=?', [id]) });
});

// ── PUT update contact ────────────────────────────────────────────────────────
router.put('/:id', function(req, res) {
  var b = req.body;
  var e = queryOne('SELECT * FROM contacts WHERE id=?', [req.params.id]);
  if (!e) return res.status(404).json({ success: false, message: 'Contact not found' });

  if (b.name !== undefined && !String(b.name).trim())
    return res.status(400).json({ success: false, message: 'name cannot be empty' });

  try {
    run(
      `UPDATE contacts SET name=?,designation=?,email=?,phone=?,linkedin=?,location=?,role_tag=?,is_decision_maker=?,notes=? WHERE id=?`,
      [b.name        !== undefined ? (String(b.name).trim() || e.name) : e.name,
       b.designation !== undefined ? (b.designation || null) : e.designation,
       b.email       !== undefined ? (b.email       || null) : e.email,
       b.phone       !== undefined ? (b.phone       || null) : e.phone,
       b.linkedin    !== undefined ? (b.linkedin    || null) : e.linkedin,
       b.location    !== undefined ? (b.location    || null) : e.location,
       b.role_tag    !== undefined ? (b.role_tag    || null) : e.role_tag,
       b.is_decision_maker !== undefined
         ? ((b.is_decision_maker === true || b.is_decision_maker === 1 || b.is_decision_maker === '1') ? 1 : 0)
         : e.is_decision_maker,
       b.notes !== undefined ? (b.notes || null) : e.notes,
       req.params.id]
    );
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update contact' });
  }

  res.json({ success: true, data: queryOne('SELECT * FROM contacts WHERE id=?', [req.params.id]) });
});

// ── DELETE contact ────────────────────────────────────────────────────────────
router.delete('/:id', function(req, res) {
  var existing = queryOne('SELECT id FROM contacts WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Contact not found' });

  try {
    run('DELETE FROM contacts WHERE id=?', [req.params.id]);
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to delete contact' });
  }

  res.json({ success: true });
});

module.exports = router;
