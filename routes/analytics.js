'use strict';
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db/database');

router.get('/summary', function(req, res) {
  var user   = req.session.user;
  var isAdmin = user.is_admin ? true : false;

  // Scope all lead queries to current user unless admin
  var lf  = isAdmin ? '' : ' AND created_by = ?';
  var lp  = isAdmin ? [] : [user.id];
  // For JOIN queries, scope via the leads table
  var ljf = isAdmin ? '' : ' AND l.created_by = ?';

  function qOne(sql, extra) {
    return queryOne(sql, lp.concat(extra || []));
  }
  function qAll(sql, extra) {
    return queryAll(sql, lp.concat(extra || []));
  }

  var kpis = {
    totalLeads:        queryOne('SELECT COUNT(*) as c FROM leads WHERE 1=1' + lf, lp)?.c || 0,
    totalValue:        queryOne("SELECT SUM(expected_deal_value) as v FROM leads WHERE lead_stage IN ('Opportunity','Qualification')" + lf, lp)?.v || 0,
    newLeads:          queryOne("SELECT COUNT(*) as c FROM leads WHERE created_at >= datetime('now','-30 days')" + lf, lp)?.c || 0,
    overdueFollowups:  queryOne("SELECT COUNT(*) as c FROM leads WHERE next_followup < date('now') AND status NOT IN ('Qualified','Disqualified')" + lf, lp)?.c || 0,
    pendingActivities: isAdmin
      ? queryOne("SELECT COUNT(*) as c FROM activities WHERE status='Pending'")?.c || 0
      : queryOne("SELECT COUNT(*) as c FROM activities a INNER JOIN leads l ON a.lead_id=l.id WHERE a.status='Pending' AND l.created_by=?", [user.id])?.c || 0,
    proposalsSent: queryOne('SELECT COUNT(*) as c FROM leads WHERE proposal_sent=1' + lf, lp)?.c || 0,
  };

  res.json({
    success: true,
    data: {
      kpis,
      byStatus:   queryAll('SELECT status, COUNT(*) as count FROM leads WHERE 1=1' + lf + ' GROUP BY status', lp),
      byStage:    queryAll('SELECT lead_stage, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads WHERE 1=1' + lf + ' GROUP BY lead_stage', lp),
      byRegion:   queryAll('SELECT region, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads WHERE 1=1' + lf + ' GROUP BY region', lp),
      bySolution: queryAll('SELECT solution_interest, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads WHERE solution_interest IS NOT NULL' + lf + ' GROUP BY solution_interest ORDER BY count DESC', lp),
      bySource:   queryAll('SELECT lead_source, COUNT(*) as count FROM leads WHERE lead_source IS NOT NULL' + lf + ' GROUP BY lead_source ORDER BY count DESC', lp),
      byAssigned: queryAll('SELECT assigned_to, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads WHERE assigned_to IS NOT NULL' + lf + ' GROUP BY assigned_to ORDER BY count DESC', lp),
      byType:     queryAll('SELECT lead_type, COUNT(*) as count FROM leads WHERE 1=1' + lf + ' GROUP BY lead_type', lp),
      recentLeads: queryAll('SELECT id,name,company,status,lead_stage,expected_deal_value,created_at,assigned_to FROM leads WHERE 1=1' + lf + ' ORDER BY created_at DESC LIMIT 5', lp),
      overdueLeads:      queryAll("SELECT id,name,company,next_followup,assigned_to,status FROM leads WHERE next_followup < date('now') AND status NOT IN ('Qualified','Disqualified')" + lf + ' ORDER BY next_followup ASC LIMIT 5', lp),
      upcomingFollowups: queryAll("SELECT id,name,company,next_followup,contact_method,assigned_to FROM leads WHERE next_followup >= date('now')" + lf + ' ORDER BY next_followup ASC LIMIT 8', lp),
      monthlyTrend:      queryAll("SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads WHERE 1=1" + lf + " GROUP BY month ORDER BY month DESC LIMIT 6", lp),
      activitySummary: isAdmin
        ? queryAll('SELECT type, COUNT(*) as count FROM activities GROUP BY type')
        : queryAll('SELECT a.type, COUNT(*) as count FROM activities a INNER JOIN leads l ON a.lead_id=l.id WHERE l.created_by=? GROUP BY a.type', [user.id]),
      recentActivities: isAdmin
        ? queryAll('SELECT a.*, l.name as lead_name, l.company FROM activities a LEFT JOIN leads l ON a.lead_id=l.id ORDER BY a.created_at DESC LIMIT 8')
        : queryAll('SELECT a.*, l.name as lead_name, l.company FROM activities a INNER JOIN leads l ON a.lead_id=l.id WHERE l.created_by=? ORDER BY a.created_at DESC LIMIT 8', [user.id]),
    }
  });
});

router.get('/users', function(_req, res) {
  res.json({ success: true, data: queryAll('SELECT * FROM users WHERE active=1 ORDER BY name') });
});

module.exports = router;
