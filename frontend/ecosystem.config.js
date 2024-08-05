module.exports = {
  apps: [
    {
      name: "forestgeo-livesite",
      script: "./node_modules/next/dist/bin/next",
      args: "start -p " + (process.env.PORT || 3000),
      watch: false,
      autorestart: true
    },
    {
      name: "forestgeo-livesite-development",
      script: "./node_modules/next/dist/bin/next",
      args: "start -p " + (process.env.PORT || 3000),
      watch: false,
      autorestart: true
    }
  ]
};
