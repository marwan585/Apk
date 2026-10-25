// Konfigurasi PM2 (opsional, untuk deploy VPS)
// Jalankan: pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'aerogrid-backend',
      script: 'app.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
