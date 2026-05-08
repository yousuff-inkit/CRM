'use strict';
const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, '..', 'crm.db');
let db;

async function initDB() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: function(file) {
      return path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file);
    }
  });

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  createTables();
  seedData();
  return db;
}

function persist() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('DB persist error:', e.message);
  }
}

function createTables() {
  db.run(`CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    date TEXT,
    name TEXT NOT NULL,
    email TEXT, phone TEXT, company TEXT, job_title TEXT,
    city TEXT, country TEXT, region TEXT DEFAULT 'India',
    solution_interest TEXT, employee_size TEXT, company_revenue TEXT,
    lead_source TEXT, assigned_to TEXT,
    status TEXT DEFAULT 'New',
    lead_type TEXT DEFAULT 'Inbound',
    lead_stage TEXT DEFAULT 'Lead',
    last_contacted TEXT, next_followup TEXT, contact_method TEXT,
    expected_deal_value REAL DEFAULT 0,
    proposal_sent INTEGER DEFAULT 0,
    closed_date TEXT, notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    notes TEXT, outcome TEXT,
    scheduled_at TEXT, completed_at TEXT,
    status TEXT DEFAULT 'Pending',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    lead_id TEXT,
    name TEXT NOT NULL,
    designation TEXT, email TEXT, phone TEXT,
    linkedin TEXT, location TEXT, role_tag TEXT,
    is_decision_maker INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'Sales',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pipeline_history (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    from_stage TEXT, to_stage TEXT,
    changed_by TEXT,
    changed_at TEXT DEFAULT (datetime('now')),
    notes TEXT,
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  )`);

  persist();
}

function seedData() {
  const existing = queryOne('SELECT COUNT(*) as c FROM users');
  if (existing && existing.c > 0) return;

  const users = [
    ['u1', 'Rahul Sharma',    'rahul@company.com',  'Sales Manager'],
    ['u2', 'Priya Patel',     'priya@company.com',  'Inside Sales'],
    ['u3', 'Aditya Verma',    'aditya@company.com', 'Field Sales'],
    ['u4', 'Sneha Kulkarni',  'sneha@company.com',  'Marketing'],
  ];
  users.forEach(u => run('INSERT OR IGNORE INTO users (id,name,email,role) VALUES (?,?,?,?)', u));

  const leads = [
    ['l1','2025-01-10','Ravi Kumar','ravi@techcorp.in','9876543210','TechCorp India','CTO','Mumbai','India','India','SAP SuccessFactors','500-1000','50Cr+','LinkedIn','Rahul Sharma','Qualified','Inbound','Opportunity','2025-03-20','2025-04-01','Email',2500000,1,null,'Strong interest in SF HCM module'],
    ['l2','2025-01-18','Anita Singh','anita@globalmanuf.ae','971501234567','Global Manufacturing LLC','CHRO','Dubai','UAE','UAE','SAP S/4HANA Cloud','1000-5000','200Cr+','Referral','Priya Patel','In Progress','Outbound','Qualification','2025-03-22','2025-04-05','Call',5000000,0,null,'Referred by existing client'],
    ['l3','2025-02-02','Mohammed Al-Rashid','m.rashid@sauco.sa','966512345678','Saudi Aramco Consulting','CFO','Riyadh','KSA','KSA','SAP Analytics Cloud','5000+','500Cr+','Event','Aditya Verma','New','Inbound','Lead','2025-03-15','2025-04-10','Meeting',8000000,0,null,'Met at SAP TechEd Riyadh'],
    ['l4','2025-02-14','Deepa Nair','deepa@retailchain.in','9988776655','RetailChain India','IT Head','Bengaluru','India','India','SAP BTP','200-500','25Cr+','Website','Sneha Kulkarni','Nurturing','Inbound','Lead','2025-03-18','2025-04-08','WhatsApp',1200000,0,null,'Downloaded BTP whitepaper'],
    ['l5','2025-02-28','Khalid Mansoor','k.mansoor@uaegov.ae','971509876543','UAE Government Entity','Procurement Head','Abu Dhabi','UAE','UAE','RISE with SAP','5000+','1000Cr+','Government Tender','Rahul Sharma','In Progress','Outbound','Opportunity','2025-03-25','2025-04-02','Email',15000000,1,null,'RFP expected in Q2'],
    ['l6','2025-03-05','Sunita Reddy','sunita@pharmaind.in','9123456789','PharmaIndia Ltd','CIO','Hyderabad','India','India','SAP S/4HANA On-Prem','1000-5000','100Cr+','Cold Outreach','Priya Patel','New','Outbound','Lead',null,'2025-04-15','Email',3500000,0,null,'Initial cold email sent'],
    ['l7','2025-01-25','Omar Al-Zahrani','omar@conglomerate.sa','966598765432','KSA Conglomerate Group','Group CTO','Jeddah','KSA','KSA','SAP SuccessFactors','5000+','300Cr+','Partner Referral','Aditya Verma','Qualified','Inbound','Opportunity','2025-03-28','2025-04-03','Meeting',6000000,1,null,'SAP partner referral - high priority'],
    ['l8','2025-03-12','Meera Iyer','meera@logisticsco.in','8877665544','LogisticsCo India','VP Operations','Chennai','India','India','SAP S/4HANA Cloud','200-500','30Cr+','LinkedIn','Sneha Kulkarni','Disqualified','Inbound','Lead','2025-03-20',null,'Call',0,0,'2025-03-25','Budget not allocated this year'],
  ];
  leads.forEach(l => {
    run(`INSERT OR IGNORE INTO leads
      (id,date,name,email,phone,company,job_title,city,country,region,
       solution_interest,employee_size,company_revenue,lead_source,assigned_to,
       status,lead_type,lead_stage,last_contacted,next_followup,contact_method,
       expected_deal_value,proposal_sent,closed_date,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, l);
  });

  const activities = [
    ['a1','l1','Call','Discovery Call','Discussed SF HCM requirements in detail','Positive - demo requested','2025-03-20','2025-03-20','Completed','Rahul Sharma'],
    ['a2','l1','Meeting','Product Demo','Live demo of SuccessFactors modules','Excellent - proposal requested','2025-03-28','2025-03-28','Completed','Rahul Sharma'],
    ['a3','l1','Email','Proposal Sent','Detailed proposal with pricing sent','Awaiting response','2025-04-01',null,'Pending','Rahul Sharma'],
    ['a4','l2','Call','Initial Qualification Call','Discussed S/4HANA migration needs','Budget confirmed, needs approval','2025-03-22','2025-03-22','Completed','Priya Patel'],
    ['a5','l5','Meeting','RFP Briefing','Attended government RFP briefing','Submitting expression of interest','2025-03-25','2025-03-25','Completed','Rahul Sharma'],
    ['a6','l7','Meeting','Executive Meeting','Met Group CTO and IT team','Strong buy signal, demo next week','2025-03-28','2025-03-28','Completed','Aditya Verma'],
    ['a7','l3','Email','Introduction Email','Sent company profile and SAP credentials','No response yet','2025-03-15',null,'Pending','Aditya Verma'],
    ['a8','l4','WhatsApp','BTP Follow-up','Sent BTP case studies and ROI analysis','Opened, no reply','2025-03-18',null,'Pending','Sneha Kulkarni'],
  ];
  activities.forEach(a => {
    run(`INSERT OR IGNORE INTO activities
      (id,lead_id,type,subject,notes,outcome,scheduled_at,completed_at,status,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, a);
  });

  persist();
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function run(sql, params) {
  try {
    db.run(sql, params || []);
    persist();
  } catch (e) {
    console.error('DB run error:', e.message, '\nSQL:', sql);
    throw e;
  }
}

// Execute multiple statements atomically; only persists once on success.
function runTransaction(operations) {
  try {
    db.run('BEGIN TRANSACTION');
    operations.forEach(function(op) {
      db.run(op.sql, op.params || []);
    });
    db.run('COMMIT');
    persist();
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    console.error('DB transaction error:', e.message);
    throw e;
  }
}

function queryAll(sql, params) {
  try {
    const stmt = db.prepare(sql);
    if (params && params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) {
    console.error('queryAll error:', e.message, '\nSQL:', sql);
    return [];
  }
}

function queryOne(sql, params) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

module.exports = { initDB, run, runTransaction, queryAll, queryOne };
