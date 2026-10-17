const path = require('path')

module.exports = {
  apps: [
    {
      name: 'cargos-api',
      cwd: path.join(__dirname, 'backend'),
      script: 'src/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'cargos-mcp',
      cwd: path.join(__dirname, 'mcp'),
      script: 'src/index.js',
      env: {
        NODE_ENV: 'production',
        MCP_TRANSPORT: 'http',
        MCP_PORT: 3100,
        MCP_BIND: '127.0.0.1',
        CARGOS_API_URL: 'http://127.0.0.1:3000',
      },
    },
  ],
}
