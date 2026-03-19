module.exports = {
  apps: [{
    name: 'procview',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    // Windows: node sends SIGINT by default; kill_timeout must exceed
    // the 3-second force-exit fallback in server.js shutdown handler
    kill_timeout: 5000,
    max_memory_restart: '500M',
    // Merge stdout/stderr timestamps into logs
    time: true,
    // Restart strategy: exponential backoff on repeated crashes
    exp_backoff_restart_delay: 100,
    max_restarts: 10,
    min_uptime: '5s',
    // Watch is off — use `yarn dev` for development with HMR
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 7829
    }
  }]
};
