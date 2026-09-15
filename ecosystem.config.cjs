module.exports = {
  apps: [
    {
      name: 'command-center',
      // Workers (not Pages): build first, then serve the built Worker locally
      script: 'npx',
      args: 'wrangler dev --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
