const db = require('../db');

function log(trace_id, event, service, meta = {}) {
  const entry = {
    trace_id,
    event,
    service,
    timestamp: new Date().toISOString(),
    ...meta
  };
  db.audit_log.push(entry);
  if (db.audit_log.length > 500) db.audit_log.shift();
  console.log(`[${entry.timestamp}] [${service}] [${trace_id}] ${event}`);
  return entry;
}

module.exports = { log };
