const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, message, meta = {}) {
  if (LEVELS[level] > currentLevel) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta,
  };

  const out = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    process.stderr.write(out + "\n");
  } else {
    process.stdout.write(out + "\n");
  }
}

module.exports = {
  info:  (msg, meta) => log("info",  msg, meta),
  warn:  (msg, meta) => log("warn",  msg, meta),
  error: (msg, meta) => log("error", msg, meta),
  debug: (msg, meta) => log("debug", msg, meta),
};
