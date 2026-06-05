function log(level, msg, ctx = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx });
  (level === 'ERROR' || level === 'WARN' ? console.error : console.log)(line);
}

module.exports = {
  info:  (msg, ctx) => log('INFO',  msg, ctx),
  warn:  (msg, ctx) => log('WARN',  msg, ctx),
  error: (msg, ctx) => log('ERROR', msg, ctx),
};
