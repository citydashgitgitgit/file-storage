module.exports = {
  apps: [
    {
      name: 'cdn-storage',
      script: './dist/index.js',
      instances: 3, // Использовать только 3 ядра
      exec_mode: 'cluster',
      
      // Логи
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Автоматический перезапуск
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'dist'],
      max_memory_restart: '1G',
      
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      
      // Автоматический перезапуск при сбоях
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      
      // Cron restart (опционально - перезапуск каждый день в 4:00)
      // cron_restart: '0 4 * * *',
    },
  ],
};