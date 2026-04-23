const db = require('../db');
const { log } = require('./logger');

const GST_RATE = 0.18;

// GL Code schema
const GL_CODES = {
  REVENUE_FYP:  { code: '4401', desc: 'First Year Premium',          ledger: 'Revenue A/c' },
  REVENUE_RIDER:{ code: '4402', desc: 'Risk Rider / Add-on Premium',  ledger: 'Revenue A/c' },
  TAX_GST:      { code: '4403', desc: 'GST Collected (18%)',          ledger: 'Tax Liability A/c' },
  SUSPENSE_REFUND:{ code: '4404', desc: 'Excess Collection — Refund Hold', ledger: 'Suspense A/c' },
  PARTIAL_HOLD: { code: '4405', desc: 'Partial Payment — Shortfall Hold',  ledger: 'Suspense A/c' },
};

function generateGLEntries(policy_id, trace_id) {
  const policy = db.policies[policy_id];
  if (!policy) return { error: 'Policy not found' };

  const txn = db.transactions.find(t => t.transaction_id === policy.transaction_id);
  if (!txn) return { error: 'Transaction not found' };

  const premium = txn.premium_amount;
  const paid    = txn.amount;
  const gst     = Math.round(premium * GST_RATE);
  const basePremium = premium - gst;

  // Split base premium: ~83% FYP, ~17% rider (realistic split)
  const fyp   = Math.round(basePremium * 0.83);
  const rider = basePremium - fyp;

  const entries = [
    { ...GL_CODES.REVENUE_FYP,   amount: fyp,  status: 'posted' },
    { ...GL_CODES.REVENUE_RIDER, amount: rider, status: 'posted' },
    { ...GL_CODES.TAX_GST,       amount: gst,   status: 'posted' },
  ];

  if (txn.payment_status === 'excess') {
    entries.push({ ...GL_CODES.SUSPENSE_REFUND, amount: txn.excess, status: 'held' });
  }
  if (txn.payment_status === 'partial') {
    entries.push({ ...GL_CODES.PARTIAL_HOLD, amount: txn.shortfall, status: 'held', note: 'Awaiting balance collection' });
  }

  db.gl_entries[policy_id] = { entries, generated_at: new Date().toISOString(), trace_id };

  entries.forEach(e => {
    log(trace_id, `GL_POSTED: ${e.code} ${e.desc} ₹${e.amount}`, 'gl-mapper', { gl_code: e.code, amount: e.amount });
  });

  return { policy_id, entries, trace_id };
}

module.exports = { generateGLEntries };
