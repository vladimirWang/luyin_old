module.exports = {
  apps: [{
    name: 'wecom-recorder',
    script: 'server/index.mjs',
    interpreter: 'node',
    watch: [
      'server',
      'dist'
    ],
    watch_ignore: [
      'server/storage',
      'server/storage/**/*'
    ],
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    combine_logs: true
  }]
}