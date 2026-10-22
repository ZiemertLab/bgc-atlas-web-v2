module.exports = {
  apps: [{
    name: "bgc-atlas-v2",
    cwd: __dirname,
    script: "npm",
    // Production server; run `npm run build` before (re)starting.
    args: "run start -- -H 127.0.0.1",
    watch: false,
    autorestart: true,
    // A restart counts as failed only if the process exits within min_uptime.
    min_uptime: "30s",
    max_restarts: 50,
    restart_delay: 2000,
    // Prefix each write to the out/error logs with the time. Without it the
    // error log could only be dated by matching entries against the Postgres
    // and nginx logs. Applied to the running process with
    // `pm2 restart bgc-atlas-v2 --log-date-format "..."` + `pm2 save`; pm2
    // does not pick this up from the file on a plain restart.
    log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
    env: {
      NODE_ENV: "production",
      PORT: "3001",
      // Bind to loopback only; the reverse proxy is the only client.
      HOSTNAME: "127.0.0.1",
      // OpenSearch private CA. Node reads this only at process start, so it cannot live in .env.local.
      NODE_EXTRA_CA_CERTS: require("path").join(__dirname, "certs", "opensearch-ca.pem"),
    },
  }],
};
