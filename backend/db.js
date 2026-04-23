// In-memory store — replace with PostgreSQL/MongoDB in production
const db = {
  transactions: [],
  policies: {},      // keyed by proposal_id
  gl_entries: {},    // keyed by policy_id
  verifications: {}, // keyed by account_number
  refunds: [],
  audit_log: []
};

module.exports = db;
