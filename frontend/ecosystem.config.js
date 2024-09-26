module.exports = {
  apps: [
    {
      name: 'forestgeo-livesite',
      script: './node_modules/next/dist/bin/next',
      args: 'start -p ' + (process.env.PORT || 3000),
      watch: true,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'forestgeo-livesite-development',
      script: './node_modules/next/dist/bin/next',
      args: 'start -p ' + (process.env.PORT || 3000),
      watch: true,
      autorestart: true,
      env: {
        NODE_END: 'development',
        PORT: 3000
      }
    }
  ]
};
