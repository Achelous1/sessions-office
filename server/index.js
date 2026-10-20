// Session Office server. Zero deps: `node server` then open http://localhost:4545
const http = require('http');
const { PORT, HOSTNAME, SOURCES } = require('./config');
const { handleRequest } = require('./routes');

http.createServer(handleRequest).listen(PORT, HOSTNAME, () => {
  console.log(`session office: http://localhost:${PORT}`);
  console.log(`reading: ${SOURCES.map(s => `${s.host}=${s.dir}`).join(', ')}`);
});
