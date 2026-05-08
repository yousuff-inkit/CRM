'use strict';
const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const { run, runTransaction, queryAll, queryOne } = require('../db/database');

const VALID_STAGES   = ['Lead', 'Qualification', 'Opportunity', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
const VALID_STATUSES = ['New', 'In Progress', 'Qualified', 'Nurturing', 'Disqualified'];
const VALID_TYPES    = ['Inbound', 'Outbound'];

// Coerce proposal_sent from any truthy/string representation
function toFlag(val) {
  return (val === true || val === 1 || val === '1' || val === 'true') ? 1 : 0;
}

// Safe numeric: return 0 for NaN/negative; preserve valid zero
function toDealValue(val) {
  const n = parseFloat(val);
  return (isNaN(n) || n < 0) ? 0 : n;
}

// For optional text fields in PUT: allow explicit clear with "" or null
function optStr(incoming, fallback) {
  return incoming !== undefined ? (incoming || null) : fallback;
}

// ── GET all leads ─────────────────────────────────────────────────────────────
router.get('/', function(req, res) {
  var q   = req.query;
  var sql = 'SELECT * FROM leads WHERE 1=1';
  var p   = [];
  if (q.status)      { sql += ' AND status = ?';      p.push(q.status); }
  if (q.stage)       { sql += ' AND lead_stage = ?';  p.push(q.stage); }
  if (q.region)      { sql += ' AND region = ?';      p.push(q.region); }
  if (q.assigned_to) { sql += ' AND assigned_to = ?'; p.push(q.assigned_to); }
  if (q.lead_type)   { sql += ' AND lead_type = ?';   p.push(q.lead_type); }
  if (q.search) {
    sql += ' AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ?)';
    var s = '%' + q.search + '%';
    p.push(s, s, s, s);
  }
  var validSorts = ['created_at', 'name', 'company', 'expected_deal_value', 'next_followup', 'last_contacted'];
  var sort  = validSorts.includes(q.sort) ? q.sort : 'created_at';
  var order = q.order === 'asc' ? 'ASC' : 'DESC';
  sql += ' ORDER BY ' + sort + ' ' + order;
  var leads = queryAll(sql, p);
  res.json({ success: true, data: leads, count: leads.length });
});

// ── GET single lead + related data ────────────────────────────────────────────
router.get('/:id', function(req, res) {
  var lead = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
  lead.activities = queryAll('SELECT * FROM activities WHERE lead_id = ? ORDER BY scheduled_at DESC', [req.params.id]);
  lead.contacts   = queryAll('SELECT * FROM contacts   WHERE lead_id = ? ORDER BY is_decision_maker DESC', [req.params.id]);
  lead.history    = queryAll('SELECT * FROM pipeline_history WHERE lead_id = ? ORDER BY changed_at DESC', [req.params.id]);
  res.json({ success: true, data: lead });
});

// ── POST create lead ──────────────────────────────────────────────────────────
router.post('/', function(req, res) {
  var b = req.body;
  if (!b.name || !String(b.name).trim())
    return res.status(400).json({ success: false, message: 'name is required' });

  var stage = VALID_STAGES.includes(b.lead_stage) ? b.lead_stage : 'Lead';
  var id    = uuid();
  var today = new Date().toISOString().slice(0, 10);

  try {
    run(
      `INSERT INTO leads
         (id,date,name,email,phone,company,job_title,city,country,region,
          solution_interest,employee_size,company_revenue,lead_source,assigned_to,
          status,lead_type,lead_stage,next_followup,contact_method,
          expected_deal_value,proposal_sent,notes,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
      [id, b.date || today, String(b.name).trim(),
       b.email   || null, b.phone   || null,
       b.company || null, b.job_title || null,
       b.city    || null, b.country || null,
       b.region  || 'India',
       b.solution_interest || null, b.employee_size || null,
       b.company_revenue   || null, b.lead_source   || null,
       b.assigned_to       || null,
       VALID_STATUSES.includes(b.status) ? b.status : 'New',
       VALID_TYPES.includes(b.lead_type) ? b.lead_type : 'Inbound',
       stage,
       b.next_followup  || null, b.contact_method || null,
       toDealValue(b.expected_deal_value),
       toFlag(b.proposal_sent),
       b.notes || null]
    );
    run(
      'INSERT INTO pipeline_history (id,lead_id,from_stage,to_stage,changed_by,notes) VALUES (?,?,?,?,?,?)',
      [uuid(), id, null, stage, b.assigned_to || 'System', 'Lead created']
    );
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to create lead' });
  }

  res.status(201).json({ success: true, data: queryOne('SELECT * FROM leads WHERE id = ?', [id]) });
});

// ── PUT update lead ───────────────────────────────────────────────────────────
router.put('/:id', function(req, res) {
  var b        = req.body;
  var existing = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });

  if (!b.name && b.name !== undefined)
    return res.status(400).json({ success: false, message: 'name cannot be empty' });

  var newStage = b.lead_stage !== undefined
    ? (VALID_STAGES.includes(b.lead_stage) ? b.lead_stage : existing.lead_stage)
    : existing.lead_stage;

  try {
    if (b.lead_stage && b.lead_stage !== existing.lead_stage) {
      run(
        'INSERT INTO pipeline_history (id,lead_id,from_stage,to_stage,changed_by) VALUES (?,?,?,?,?)',
        [uuid(), req.params.id, existing.lead_stage, newStage, b.assigned_to || existing.assigned_to || 'User']
      );
    }

    run(
      `UPDATE leads SET
         name=?, email=?, phone=?, company=?, job_title=?,
         city=?, country=?, region=?, solution_interest=?, employee_size=?,
         company_revenue=?, lead_source=?, assigned_to=?, status=?, lead_type=?,
         lead_stage=?, last_contacted=?, next_followup=?, contact_method=?,
         expected_deal_value=?, proposal_sent=?, closed_date=?, notes=?,
         updated_at=datetime('now')
       WHERE id=?`,
      [
        b.name !== undefined ? (String(b.name).trim() || existing.name) : existing.name,
        optStr(b.email,        existing.email),
        optStr(b.phone,        existing.phone),
        optStr(b.company,      existing.company),
        optStr(b.job_title,    existing.job_title),
        optStr(b.city,         existing.city),
        optStr(b.country,      existing.country),
        b.region !== undefined ? (b.region || existing.region) : existing.region,
        optStr(b.solution_interest, existing.solution_interest),
        optStr(b.employee_size,     existing.employee_size),
        optStr(b.company_revenue,   existing.company_revenue),
        optStr(b.lead_source,       existing.lead_source),
        optStr(b.assigned_to,       existing.assigned_to),
        VALID_STATUSES.includes(b.status) ? b.status : existing.status,
        VALID_TYPES.includes(b.lead_type) ? b.lead_type : existing.lead_type,
        newStage,
        b.last_contacted !== undefined ? (b.last_contacted || null) : existing.last_contacted,
        b.next_followup  !== undefined ? (b.next_followup  || null) : existing.next_followup,
        optStr(b.contact_method, existing.contact_method),
        b.expected_deal_value !== undefined ? toDealValue(b.expected_deal_value) : existing.expected_deal_value,
        b.proposal_sent       !== undefined ? toFlag(b.proposal_sent)            : existing.proposal_sent,
        b.closed_date         !== undefined ? (b.closed_date || null)            : existing.closed_date,
        b.notes               !== undefined ? (b.notes       || null)            : existing.notes,
        req.params.id,
      ]
    );
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update lead' });
  }

  res.json({ success: true, data: queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]) });
});

// ── PATCH stage only ──────────────────────────────────────────────────────────
router.patch('/:id/stage', function(req, res) {
  var newStage = req.body.lead_stage;
  if (!newStage)
    return res.status(400).json({ success: false, message: 'lead_stage is required' });
  if (!VALID_STAGES.includes(newStage))
    return res.status(400).json({ success: false, message: 'Invalid lead_stage value' });

  var existing = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });

  try {
    run(
      'INSERT INTO pipeline_history (id,lead_id,from_stage,to_stage,changed_by) VALUES (?,?,?,?,?)',
      [uuid(), req.params.id, existing.lead_stage, newStage, req.body.changed_by || 'User']
    );
    run(
      "UPDATE leads SET lead_stage=?, updated_at=datetime('now') WHERE id=?",
      [newStage, req.params.id]
    );
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update stage' });
  }

  res.json({ success: true, data: queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]) });
});

// ── DELETE lead (atomic cascade) ──────────────────────────────────────────────
router.delete('/:id', function(req, res) {
  var existing = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });

  try {
    runTransaction([
      { sql: 'DELETE FROM activities       WHERE lead_id = ?', params: [req.params.id] },
      { sql: 'DELETE FROM contacts         WHERE lead_id = ?', params: [req.params.id] },
      { sql: 'DELETE FROM pipeline_history WHERE lead_id = ?', params: [req.params.id] },
      { sql: 'DELETE FROM leads            WHERE id = ?',      params: [req.params.id] },
    ]);
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to delete lead' });
  }

  res.json({ success: true });
});

module.exports = router;
