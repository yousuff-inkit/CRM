'use strict';
const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const { run, queryAll, queryOne } = require('../db/database');

const VALID_TYPES    = ['Call', 'Meeting', 'Email', 'WhatsApp', 'Demo', 'Other'];
const VALID_STATUSES = ['Pending', 'Completed', 'Cancelled'];

// ── GET activities ────────────────────────────────────────────────────────────
router.get('/', function(req, res) {
  var q   = req.query;
  var sql = `SELECT a.*, l.name as lead_name, l.company as lead_company
             FROM activities a LEFT JOIN leads l ON a.lead_id = l.id WHERE 1=1`;
  var p   = [];
  if (q.lead_id) { sql += ' AND a.lead_id = ?'; p.push(q.lead_id); }
  if (q.status)  { sql += ' AND a.status = ?';  p.push(q.status); }
  if (q.type)    { sql += ' AND a.type = ?';    p.push(q.type); }
  if (q.overdue === 'true') sql += " AND a.status = 'Pending' AND a.scheduled_at < datetime('now')";
  sql += ' ORDER BY a.scheduled_at DESC';
  res.json({ success: true, data: queryAll(sql, p) });
});

// ── POST create activity ──────────────────────────────────────────────────────
router.post('/', function(req, res) {
  var b = req.body;
  if (!b.lead_id || !b.type || !b.subject)
    return res.status(400).json({ success: false, message: 'lead_id, type and subject are required' });

  var lead = queryOne('SELECT id FROM leads WHERE id = ?', [b.lead_id]);
  if (!lead)
    return res.status(404).json({ success: false, message: 'Lead not found' });

  var id     = uuid();
  var status = VALID_STATUSES.includes(b.status) ? b.status : 'Pending';

  try {
    run(
      `INSERT INTO activities (id,lead_id,type,subject,notes,outcome,scheduled_at,completed_at,status,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, b.lead_id,
       VALID_TYPES.includes(b.type) ? b.type : b.type,
       String(b.subject).trim(),
       b.notes       || null, b.outcome     || null,
       b.scheduled_at || null, b.completed_at || null,
       status, b.created_by || null]
    );
    if (status === 'Completed') {
      run("UPDATE leads SET last_contacted=datetime('now'), updated_at=datetime('now') WHERE id=?", [b.lead_id]);
    }
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to create activity' });
  }

  res.status(201).json({ success: true, data: queryOne('SELECT * FROM activities WHERE id=?', [id]) });
});

// ── PUT update activity ───────────────────────────────────────────────────────
router.put('/:id', function(req, res) {
  var b        = req.body;
  var existing = queryOne('SELECT * FROM activities WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Activity not found' });

  var newStatus = VALID_STATUSES.includes(b.status) ? b.status : existing.status;

  try {
    run(
      `UPDATE activities SET type=?, subject=?, notes=?, outcome=?,
         scheduled_at=?, completed_at=?, status=?, created_by=? WHERE id=?`,
      [b.type    !== undefined ? b.type    : existing.type,
       b.subject !== undefined ? (String(b.subject).trim() || existing.subject) : existing.subject,
       b.notes    !== undefined ? (b.notes    || null) : existing.notes,
       b.outcome  !== undefined ? (b.outcome  || null) : existing.outcome,
       b.scheduled_at !== undefined ? (b.scheduled_at || null) : existing.scheduled_at,
       b.completed_at !== undefined ? (b.completed_at || null) : existing.completed_at,
       newStatus,
       b.created_by !== undefined ? (b.created_by || null) : existing.created_by,
       req.params.id]
    );
    if (newStatus === 'Completed' && existing.status !== 'Completed') {
      run("UPDATE leads SET last_contacted=datetime('now'), updated_at=datetime('now') WHERE id=?", [existing.lead_id]);
    }
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update activity' });
  }

  res.json({ success: true, data: queryOne('SELECT * FROM activities WHERE id=?', [req.params.id]) });
});

// ── DELETE activity ───────────────────────────────────────────────────────────
router.delete('/:id', function(req, res) {
  var existing = queryOne('SELECT id FROM activities WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Activity not found' });

  try {
    run('DELETE FROM activities WHERE id=?', [req.params.id]);
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to delete activity' });
  }

  res.json({ success: true });
});

module.exports = router;
