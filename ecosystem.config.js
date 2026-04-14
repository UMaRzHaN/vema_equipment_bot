module.exports = {
  apps: [
    {
      name: 'vema-equipment-bot',
      script: 'src/app.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 4000,
      max_restarts: 10,
      // Graceful shutdown: wait up to 10s for ongoing requests
      kill_timeout: 10000,
    },
  ],
};
