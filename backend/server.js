const express = require('express');
const cors    = require('cors');
const { v4: uuid } = require('uuid');
const path    = require('path');

const db           = require('./db');
const { log }      = require('./services/logger');
const payment      = require('./services/payment');
const { generateGLEntries } = require('./services/gl');
const verification = require('./services/verification');
const { processRefund } = require('./services/refund');

const app  = express();
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
app.post('/api/transactions', (req, res) => {
  const result = payment.createTransaction(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.get('/api/transactions', (req, res) => {
  res.json({ transactions: payment.getTransactions() });
});

app.get('/api/transactions/:id', (req, res) => {
  const txn = db.transactions.find(t => t.transaction_id === req.params.id);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: txn });
});

// ─── VERIFY ACCOUNT (Penny Drop) ─────────────────────────────────────────────
app.post('/api/verify-account', async (req, res) => {
  const { account_number, bank_ifsc, account_holder, force_fail } = req.body;
  if (!account_number || !bank_ifsc) {
    return res.status(400).json({ error: 'account_number and bank_ifsc are required' });
  }
  const trace_id = req.body.trace_id || 'TRC-' + uuid().slice(0, 8).toUpperCase();
  try {
    const result = await verification.verifyAccount({
      account_number, bank_ifsc, account_holder, trace_id,
      force_fail: force_fail || verification.getBankFailureMode()
    });
    const statusCode = result.status === 'verified' ? 200 : 502;
    res.status(statusCode).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CONVERT POLICY ───────────────────────────────────────────────────────────
app.post('/api/convert-policy', (req, res) => {
  const { transaction_id, proposal_id, beneficiaries } = req.body;
  if (!transaction_id || !proposal_id) {
    return res.status(400).json({ error: 'transaction_id and proposal_id are required' });
  }

  const txn = db.transactions.find(t => t.transaction_id === transaction_id);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  if (txn.status !== 'settled') {
    return res.status(409).json({ error: 'Transaction not yet settled in Bancs', code: 'TXN_NOT_SETTLED' });
  }
  if (txn.payment_status === 'partial') {
    return res.status(409).json({
      error: `Partial payment: ₹${txn.shortfall} shortfall. Policy conversion blocked.`,
      code: 'PARTIAL_PAYMENT', shortfall: txn.shortfall
    });
  }

  const trace_id = txn.trace_id;
  const policy_id = 'POL-' + proposal_id + '-A';

  if (db.policies[policy_id]) {
    return res.status(409).json({ error: 'Policy already exists', policy_id });
  }

  const policy = {
    policy_id,
    proposal_id,
    transaction_id,
    status: 'active',
    beneficiaries: beneficiaries || [],
    converted_at: new Date().toISOString(),
    trace_id
  };
  db.policies[policy_id] = policy;
  txn.policy_id = policy_id;

  log(trace_id, `POLICY_CREATED: ${policy_id}`, 'uw-engine', { proposal_id });

  // Auto-generate GL entries
  const gl = generateGLEntries(policy_id, trace_id);

  res.status(201).json({ policy, gl_entries: gl.entries, trace_id });
});

// ─── REFUND ───────────────────────────────────────────────────────────────────
app.post('/api/refund', async (req, res) => {
  const { policy_id, simulate_failure } = req.body;
  if (!policy_id) return res.status(400).json({ error: 'policy_id is required' });

  const trace_id = 'TRC-RFD-' + uuid().slice(0, 8).toUpperCase();
  const result = await processRefund({ policy_id, trace_id, simulate_failure });

  if (result.error) {
    const code = result.code;
    const status = code === 'NO_EXCESS' ? 400 : code === 'POLICY_NOT_ACTIVE' ? 409 : 502;
    return res.status(status).json(result);
  }
  res.json(result);
});

// ─── GL ENTRIES ───────────────────────────────────────────────────────────────
app.get('/api/gl/:policy_id', (req, res) => {
  const gl = db.gl_entries[req.params.policy_id];
  if (!gl) return res.status(404).json({ error: 'GL entries not found' });
  res.json(gl);
});

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ logs: db.audit_log.slice(-limit).reverse() });
});

// ─── EDGE CASE CONTROLS ───────────────────────────────────────────────────────
app.post('/api/simulate/bank-failure', (req, res) => {
  verification.setBankFailure(req.body.enabled !== false);
  const mode = verification.getBankFailureMode();
  log('SYSTEM', `Bank failure simulation ${mode ? 'ENABLED' : 'DISABLED'}`, 'system');
  res.json({ bank_failure_mode: mode });
});

app.post('/api/simulate/reset', (req, res) => {
  verification.setBankFailure(false);
  res.json({ message: 'Simulation flags reset' });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Insurance Lifecycle API running → http://localhost:${PORT}`);
  console.log(`  Frontend            → http://localhost:${PORT}/index.html`);
  console.log(`  Health check        → http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
