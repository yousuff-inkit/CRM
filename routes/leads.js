'use strict';
const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const { run, runTransaction, queryAll, queryOne, getSubordinateIds } = require('../db/database');

const VALID_STAGES   = ['Lead', 'Qualification', 'Opportunity', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
const VALID_STATUSES = ['New', 'In Progress', 'Qualified', 'Nurturing', 'Disqualified'];
const VALID_TYPES    = ['Inbound', 'Outbound'];

function toFlag(val) {
  return (val === true || val === 1 || val === '1' || val === 'true') ? 1 : 0;
}

function computeQualScore(lead, contacts, activities) {
  var criteria = {
    budget_confirmed:        { label: 'Budget Confirmed',            hint: 'Budget allocated/approved by the company', manual: true,  passed: lead.budget_confirmed === 1 },
    decision_maker:          { label: 'Decision Maker Identified',   hint: 'Contact with is_decision_maker flag in Contacts tab', manual: false, passed: contacts.some(function(c) { return c.is_decision_maker === 1; }) },
    need_identified:         { label: 'Business Need Identified',    hint: 'Clear pain point mapped to the SAP solution', manual: true,  passed: lead.need_identified === 1 },
    implementation_timeline: { label: 'Implementation Timeline Set', hint: 'Concrete go-live target (e.g. Q3 2026)', manual: true,  passed: !!lead.implementation_timeline },
    company_fit:             { label: 'Company Size Fit',            hint: 'Employee size & revenue filled (mid-market+)', manual: false, passed: !!(lead.employee_size && lead.company_revenue) },
    active_engagement:       { label: 'Active Engagement',           hint: 'Lead contacted + at least one completed activity', manual: false, passed: !!(lead.last_contacted && activities.some(function(a) { return a.status === 'Completed'; })) },
  };
  var score = Object.keys(criteria).filter(function(k) { return criteria[k].passed; }).length;
  return { criteria: criteria, score: score };
}
function toDealValue(val) {
  const n = parseFloat(val);
  return (isNaN(n) || n < 0) ? 0 : n;
}
function optStr(incoming, fallback) {
  return incoming !== undefined ? (incoming || null) : fallback;
}

// Returns { filter: ' AND ...', params: [...] } scoping query to the current user.
// Managers/supervisors (hierarchy_level < 4) see their own leads + all subordinates'.
function ownerFilter(user) {
  if (user.is_admin) return { filter: '', params: [] };
  var level = user.hierarchy_level || 4;
  if (level < 4) {
    var ids = getSubordinateIds(user.id);
    var placeholders = ids.map(function() { return '?'; }).join(',');
    return { filter: ' AND created_by IN (' + placeholders + ')', params: ids };
  }
  return { filter: ' AND created_by = ?', params: [user.id] };
}

// ── GET all leads ─────────────────────────────────────────────────────────────
router.get('/', function(req, res) {
  var user = req.session.user;
  var q    = req.query;
  var own  = ownerFilter(user);
  var sql  = 'SELECT * FROM leads WHERE 1=1' + own.filter;
  var p    = own.params.slice();

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
  var user = req.session.user;
  var lead = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

  if (!user.is_admin && lead.created_by !== user.id)
    return res.status(403).json({ success: false, message: 'Access denied' });

  lead.activities = queryAll('SELECT * FROM activities WHERE lead_id = ? ORDER BY scheduled_at DESC', [req.params.id]);
  lead.contacts   = queryAll('SELECT * FROM contacts   WHERE lead_id = ? ORDER BY is_decision_maker DESC', [req.params.id]);
  lead.history    = queryAll('SELECT * FROM pipeline_history WHERE lead_id = ? ORDER BY changed_at DESC', [req.params.id]);
  var qual = computeQualScore(lead, lead.contacts, lead.activities);
  lead.qualification_score    = qual.score;
  lead.qualification_criteria = qual.criteria;
  res.json({ success: true, data: lead });
});

// ── POST create lead ──────────────────────────────────────────────────────────
router.post('/', function(req, res) {
  var b    = req.body;
  var user = req.session.user;

  if (!b.name || !String(b.name).trim())
    return res.status(400).json({ success: false, message: 'name is required' });

  var stage = VALID_STAGES.includes(b.lead_stage) ? b.lead_stage : 'Lead';
  var id    = uuid();
  var today = new Date().toISOString().slice(0, 10);

  try {
    var VALID_CURRENCIES = ['INR', 'AED', 'SAR', 'USD'];
    run(
      `INSERT INTO leads
         (id,date,name,email,phone,company,job_title,city,country,region,
          solution_interest,employee_size,company_revenue,lead_source,assigned_to,
          status,lead_type,lead_stage,next_followup,contact_method,
          expected_deal_value,currency,proposal_sent,
          budget_confirmed,need_identified,implementation_timeline,
          notes,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
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
       VALID_CURRENCIES.includes(b.currency) ? b.currency : 'INR',
       toFlag(b.proposal_sent),
       toFlag(b.budget_confirmed),
       toFlag(b.need_identified),
       b.implementation_timeline || null,
       b.notes || null,
       user.id]
    );
    run(
      'INSERT INTO pipeline_history (id,lead_id,from_stage,to_stage,changed_by,notes) VALUES (?,?,?,?,?,?)',
      [uuid(), id, null, stage, user.name || 'System', 'Lead created']
    );
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to create lead' });
  }

  res.status(201).json({ success: true, data: queryOne('SELECT * FROM leads WHERE id = ?', [id]) });
});

// ── PUT update lead ───────────────────────────────────────────────────────────
router.put('/:id', function(req, res) {
  var b        = req.body;
  var user     = req.session.user;
  var existing = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });

  if (!user.is_admin && existing.created_by !== user.id)
    return res.status(403).json({ success: false, message: 'Access denied' });

  if (!b.name && b.name !== undefined)
    return res.status(400).json({ success: false, message: 'name cannot be empty' });

  var newStage = b.lead_stage !== undefined
    ? (VALID_STAGES.includes(b.lead_stage) ? b.lead_stage : existing.lead_stage)
    : existing.lead_stage;

  try {
    if (b.lead_stage && b.lead_stage !== existing.lead_stage) {
      run(
        'INSERT INTO pipeline_history (id,lead_id,from_stage,to_stage,changed_by) VALUES (?,?,?,?,?)',
        [uuid(), req.params.id, existing.lead_stage, newStage, user.name || 'User']
      );
    }

    var VALID_CURRENCIES = ['INR', 'AED', 'SAR', 'USD'];
    run(
      `UPDATE leads SET
         name=?, email=?, phone=?, company=?, job_title=?,
         city=?, country=?, region=?, solution_interest=?, employee_size=?,
         company_revenue=?, lead_source=?, assigned_to=?, status=?, lead_type=?,
         lead_stage=?, last_contacted=?, next_followup=?, contact_method=?,
         expected_deal_value=?, currency=?, proposal_sent=?,
         budget_confirmed=?, need_identified=?, implementation_timeline=?,
         closed_date=?, notes=?,
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
        b.currency !== undefined ? (VALID_CURRENCIES.includes(b.currency) ? b.currency : existing.currency) : existing.currency,
        b.proposal_sent       !== undefined ? toFlag(b.proposal_sent)            : existing.proposal_sent,
        b.budget_confirmed    !== undefined ? toFlag(b.budget_confirmed)         : existing.budget_confirmed,
        b.need_identified     !== undefined ? toFlag(b.need_identified)          : existing.need_identified,
        b.implementation_timeline !== undefined ? (b.implementation_timeline || null) : existing.implementation_timeline,
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
  var user     = req.session.user;
  var newStage = req.body.lead_stage;
  if (!newStage)
    return res.status(400).json({ success: false, message: 'lead_stage is required' });
  if (!VALID_STAGES.includes(newStage))
    return res.status(400).json({ success: false, message: 'Invalid lead_stage value' });

  var existing = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });

  if (!user.is_admin && existing.created_by !== user.id)
    return res.status(403).json({ success: false, message: 'Access denied' });

  try {
    run(
      'INSERT INTO pipeline_history (id,lead_id,from_stage,to_stage,changed_by) VALUES (?,?,?,?,?)',
      [uuid(), req.params.id, existing.lead_stage, newStage, user.name || 'User']
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

// ── PATCH qualification criteria (manual toggles) ────────────────────────────
router.patch('/:id/qualification', function(req, res) {
  var user     = req.session.user;
  var existing = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });

  if (!user.is_admin && existing.created_by !== user.id)
    return res.status(403).json({ success: false, message: 'Access denied' });

  var b = req.body;
  var setClauses = [];
  var vals = [];

  if (b.budget_confirmed !== undefined)        { setClauses.push('budget_confirmed=?');        vals.push(toFlag(b.budget_confirmed)); }
  if (b.need_identified !== undefined)         { setClauses.push('need_identified=?');         vals.push(toFlag(b.need_identified)); }
  if (b.implementation_timeline !== undefined) { setClauses.push('implementation_timeline=?'); vals.push(b.implementation_timeline || null); }

  if (!setClauses.length)
    return res.status(400).json({ success: false, message: 'No qualification fields provided' });

  vals.push(req.params.id);
  try {
    run('UPDATE leads SET ' + setClauses.join(', ') + ", updated_at=datetime('now') WHERE id=?", vals);
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to update qualification criteria' });
  }

  var updated    = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  var contacts   = queryAll('SELECT * FROM contacts   WHERE lead_id = ?', [req.params.id]);
  var activities = queryAll('SELECT * FROM activities WHERE lead_id = ?', [req.params.id]);
  var qual = computeQualScore(updated, contacts, activities);
  updated.qualification_score    = qual.score;
  updated.qualification_criteria = qual.criteria;
  res.json({ success: true, data: updated });
});

// ── DELETE lead (atomic cascade) ──────────────────────────────────────────────
router.delete('/:id', function(req, res) {
  var user     = req.session.user;
  var existing = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Lead not found' });

  if (!user.is_admin && existing.created_by !== user.id)
    return res.status(403).json({ success: false, message: 'Access denied' });

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
