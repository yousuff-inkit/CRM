'use strict';
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db/database');

router.get('/summary', function(_req, res) {
  var kpis = {
    totalLeads:        queryOne('SELECT COUNT(*) as c FROM leads')?.c || 0,
    totalValue:        queryOne("SELECT SUM(expected_deal_value) as v FROM leads WHERE lead_stage IN ('Opportunity','Qualification')")?.v || 0,
    newLeads:          queryOne("SELECT COUNT(*) as c FROM leads WHERE created_at >= datetime('now','-30 days')")?.c || 0,
    overdueFollowups:  queryOne("SELECT COUNT(*) as c FROM leads WHERE next_followup < date('now') AND status NOT IN ('Qualified','Disqualified')")?.c || 0,
    pendingActivities: queryOne("SELECT COUNT(*) as c FROM activities WHERE status='Pending'")?.c || 0,
    proposalsSent:     queryOne("SELECT COUNT(*) as c FROM leads WHERE proposal_sent=1")?.c || 0,
  };
  res.json({
    success: true,
    data: {
      kpis,
      byStatus:    queryAll('SELECT status, COUNT(*) as count FROM leads GROUP BY status'),
      byStage:     queryAll('SELECT lead_stage, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads GROUP BY lead_stage'),
      byRegion:    queryAll('SELECT region, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads GROUP BY region'),
      bySolution:  queryAll('SELECT solution_interest, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads WHERE solution_interest IS NOT NULL GROUP BY solution_interest ORDER BY count DESC'),
      bySource:    queryAll('SELECT lead_source, COUNT(*) as count FROM leads WHERE lead_source IS NOT NULL GROUP BY lead_source ORDER BY count DESC'),
      byAssigned:  queryAll('SELECT assigned_to, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads WHERE assigned_to IS NOT NULL GROUP BY assigned_to ORDER BY count DESC'),
      byType:      queryAll('SELECT lead_type, COUNT(*) as count FROM leads GROUP BY lead_type'),
      recentLeads: queryAll('SELECT id,name,company,status,lead_stage,expected_deal_value,created_at,assigned_to FROM leads ORDER BY created_at DESC LIMIT 5'),
      overdueLeads:       queryAll("SELECT id,name,company,next_followup,assigned_to,status FROM leads WHERE next_followup < date('now') AND status NOT IN ('Qualified','Disqualified') ORDER BY next_followup ASC LIMIT 5"),
      upcomingFollowups:  queryAll("SELECT id,name,company,next_followup,contact_method,assigned_to FROM leads WHERE next_followup >= date('now') ORDER BY next_followup ASC LIMIT 8"),
      monthlyTrend:       queryAll("SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count, SUM(expected_deal_value) as value FROM leads GROUP BY month ORDER BY month DESC LIMIT 6"),
      activitySummary:    queryAll('SELECT type, COUNT(*) as count FROM activities GROUP BY type'),
      recentActivities:   queryAll('SELECT a.*, l.name as lead_name, l.company FROM activities a LEFT JOIN leads l ON a.lead_id=l.id ORDER BY a.created_at DESC LIMIT 8'),
    }
  });
});

router.get('/users', function(_req, res) {
  res.json({ success: true, data: queryAll('SELECT * FROM users WHERE active=1 ORDER BY name') });
});

module.exports = router;
