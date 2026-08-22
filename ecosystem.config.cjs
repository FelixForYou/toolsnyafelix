module.exports = {
  apps: [{
    name: 'fxhl-webtool',
    script: './server.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production' }
  }]
}
