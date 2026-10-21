// Serves the client folder. Only known file types, and nothing outside the folder.
const fs = require('fs');
const path = require('path');
const { CLIENT_DIR } = require('./config');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function resolveClientFile(urlPath) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.resolve(CLIENT_DIR, relative);
  if (!file.startsWith(CLIENT_DIR + path.sep)) return null;
  if (!CONTENT_TYPES[path.extname(file)]) return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

// Returns false when the path is not a client file, so the caller can answer 404.
function serveStatic(req, res, urlPath) {
  let file;
  try { file = resolveClientFile(urlPath); } catch { return false; } // malformed %-escapes
  if (!file) return false;
  res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] });
  fs.createReadStream(file).pipe(res);
  return true;
}

module.exports = { serveStatic, resolveClientFile };
