const { v4: uuid } = require('uuid');
const db = require('../db');
const { log } = require('./logger');

async function processRefund({ policy_id, trace_id, simulate_failure }) {
  const policy = db.policies[policy_id];
  if (!policy) return { error: 'Policy not found', code: 'POLICY_NOT_FOUND' };

  // Hard dependency: policy must be active
  if (policy.status !== 'active') {
    return { error: 'Refund blocked: policy not yet converted', code: 'POLICY_NOT_ACTIVE' };
  }

  const txn = db.transactions.find(t => t.transaction_id === policy.transaction_id);
  if (!txn || txn.excess <= 0) {
    return { error: 'No excess amount available for refund', code: 'NO_EXCESS' };
  }

  // Hard dependency: all penny drops must be verified
  const beneficiaries = policy.beneficiaries || [];
  for (const b of beneficiaries) {
    const key = b.account_number + '_' + b.bank_ifsc;
    const v = db.verifications[key];
    if (!v || v.status !== 'verified') {
      log(trace_id, `REFUND_BLOCKED: ${b.account_number} not verified`, 'refund-service');
      return {
        error: `Refund blocked: account ${b.account_number} (${b.name}) not penny-drop verified`,
        code: 'PENNY_DROP_INCOMPLETE',
        account: b.account_number
      };
    }
  }

  // Check for duplicate refund
  const existing = db.refunds.find(r => r.policy_id === policy_id && r.status !== 'failed');
  if (existing) {
    return { error: 'Refund already processed for this policy', code: 'DUPLICATE_REFUND', refund: existing };
  }

  // Simulate refund failure
  if (simulate_failure) {
    log(trace_id, 'REFUND_DISPATCH_FAILED: StarPay gateway error', 'refund-service');
    return { error: 'Refund dispatch failed: StarPay gateway returned 503', code: 'GATEWAY_ERROR' };
  }

  const refund = {
    refund_id: 'RFD-' + uuid().slice(0, 8).toUpperCase(),
    policy_id,
    transaction_id: txn.transaction_id,
    amount: txn.excess,
    gl_code: '4404',
    utr: 'SPAY' + Date.now().toString().slice(-9),
    status: 'dispatched',
    trace_id,
    dispatched_at: new Date().toISOString(),
    expected_settlement: 'T+0'
  };

  db.refunds.push(refund);

  // Update GL entry
  const glData = db.gl_entries[policy_id];
  if (glData) {
    const suspense = glData.entries.find(e => e.code === '4404');
    if (suspense) suspense.status = 'cleared';
  }

  log(trace_id, `REFUND_DISPATCHED: ${refund.refund_id} ₹${refund.amount} UTR:${refund.utr}`, 'refund-service');

  return { refund, trace_id };
}

module.exports = { processRefund };
