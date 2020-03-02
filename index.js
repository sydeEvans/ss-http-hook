const ss = require('./src/server')

ss({
  serverIp: '0.0.0.0',
  serverPort: '8388',
  password: '123456',
  timeout: 1000,
  method: 'aes-256-cfb'
});
