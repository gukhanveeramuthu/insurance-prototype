const { v4: uuid } = require('uuid');
const db = require('../db');
const { log } = require('./logger');

// Valid IFSC pattern: 4 alpha + 0 + 6 alphanumeric
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const KNOWN_BANKS = {
  HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', SBIN: 'State Bank of India',
  UTIB: 'Axis Bank', KKBK: 'Kotak Bank', PUNB: 'Punjab National Bank',
  YESB: 'YES Bank', BARB: 'Bank of Baroda', CNRB: 'Canara Bank',
  UBIN: 'Union Bank', INDB: 'IndusInd Bank'
};

function createTransaction({ amount, bank_ifsc, bank_name, account_number, utr, proposal_id, premium_amount }) {
  const trace_id = 'TRC-' + uuid().slice(0, 8).toUpperCase();

  // Validate IFSC
  if (!IFSC_RE.test(bank_ifsc)) {
    log(trace_id, 'VALIDATION_FAILED: invalid IFSC format', 'payment-service', { bank_ifsc });
    return { error: 'Invalid IFSC format. Expected: XXXX0XXXXXX', trace_id, code: 'INVALID_IFSC' };
  }

  // Validate amount
  if (!amount || amount <= 0) {
    return { error: 'Invalid amount', trace_id, code: 'INVALID_AMOUNT' };
  }

  // Duplicate UTR check
  if (utr && db.transactions.find(t => t.utr === utr)) {
    log(trace_id, 'DUPLICATE_UTR: ' + utr, 'payment-service');
    return { error: 'Duplicate UTR detected: ' + utr, trace_id, code: 'DUPLICATE_UTR' };
  }

  // Amount mismatch check
  const premAmt = Number(premium_amount);
  const paidAmt = Number(amount);
  let payment_status = 'full';
  let excess = 0;
  let shortfall = 0;

  if (premAmt > 0) {
    if (paidAmt < premAmt) {
      payment_status = 'partial';
      shortfall = premAmt - paidAmt;
    } else if (paidAmt > premAmt) {
      payment_status = 'excess';
      excess = paidAmt - premAmt;
    }
  }

  const bankPrefix = bank_ifsc.slice(0, 4);
  const txn = {
    transaction_id: 'NEFT' + Date.now().toString().slice(-9),
    trace_id,
    utr: utr || 'UTR' + Date.now(),
    bank_ifsc,
    bank_name: bank_name || KNOWN_BANKS[bankPrefix] || 'Unknown Bank',
    account_number,
    amount: paidAmt,
    premium_amount: premAmt || paidAmt,
    excess,
    shortfall,
    payment_status,
    proposal_id: proposal_id || null,
    status: 'received',
    bancs_status: 'pending',
    created_at: new Date().toISOString()
  };

  db.transactions.push(txn);
  log(trace_id, 'TRANSACTION_RECEIVED: ' + txn.transaction_id, 'payment-service', {
    amount: paidAmt, payment_status, excess, shortfall
  });

  // Simulate async Bancs push
  setTimeout(() => {
    txn.status = 'settled';
    txn.bancs_status = 'pushed';
    log(trace_id, 'BANCS_PUSH_SUCCESS: ' + txn.transaction_id, 'bancs-integration');
  }, 2000 + Math.random() * 2000);

  return { transaction: txn, trace_id };
}

function getTransactions() {
  return db.transactions.slice().reverse();
}

module.exports = { createTransaction, getTransactions };
