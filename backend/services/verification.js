const db = require('../db');
const { log } = require('./logger');

// Simulated failure flag — toggled via API
let bankFailureMode = false;
const FAILING_BANK_PREFIX = 'ICIC'; // ICICI fails in failure mode

function setBankFailure(mode) {
  bankFailureMode = mode;
}

function getBankFailureMode() {
  return bankFailureMode;
}

async function verifyAccount({ account_number, bank_ifsc, account_holder, trace_id, force_fail }) {
  const key = account_number + '_' + bank_ifsc;
  const bankPrefix = bank_ifsc ? bank_ifsc.slice(0, 4) : '';

  log(trace_id, `PENNY_DROP_INITIATED: ${account_number} @ ${bank_ifsc}`, 'verification-service');

  // Check if already verified
  if (db.verifications[key] && db.verifications[key].status === 'verified') {
    return db.verifications[key];
  }

  // Simulate network delay
  await delay(800 + Math.random() * 600);

  // Determine failure
  const shouldFail = force_fail || (bankFailureMode && bankPrefix === FAILING_BANK_PREFIX);

  if (shouldFail) {
    const retries = 3;
    for (let i = 1; i <= retries; i++) {
      log(trace_id, `PENNY_DROP_RETRY ${i}/${retries}: gateway timeout`, 'verification-service', { attempt: i });
      await delay(400);
    }

    const result = {
      account_number,
      bank_ifsc,
      account_holder,
      status: 'failed',
      error: 'Bank API 500 — gateway unresponsive after 3 retries',
      error_code: 'BANK_GW_TIMEOUT',
      retries_attempted: 3,
      trace_id,
      verified_at: null,
      updated_at: new Date().toISOString()
    };
    db.verifications[key] = result;
    log(trace_id, `PENNY_DROP_FAILED: ${account_number} — safety lock engaged`, 'verification-service');
    return result;
  }

  // Success path
  const result = {
    account_number,
    bank_ifsc,
    account_holder,
    status: 'verified',
    name_match: true,
    penny_credited: 1.00,
    penny_returned: 1.00,
    trace_id,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  db.verifications[key] = result;
  log(trace_id, `PENNY_DROP_SUCCESS: ${account_number} — ₹1.00 credited & returned`, 'verification-service');
  return result;
}

function getVerification(account_number, bank_ifsc) {
  return db.verifications[account_number + '_' + bank_ifsc] || null;
}

function resetVerification(account_number, bank_ifsc) {
  const key = account_number + '_' + bank_ifsc;
  if (db.verifications[key]) {
    db.verifications[key].status = 'pending';
    db.verifications[key].error = null;
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { verifyAccount, getVerification, resetVerification, setBankFailure, getBankFailureMode };
