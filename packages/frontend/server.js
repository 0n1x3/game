const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

console.log('Starting server setup...');

const dev = process.env.NODE_ENV !== 'production';
const hostName = process.env.HOSTNAME || 'dev.game.local';
const port = Number(process.env.PORT || 4000);
console.log('Development mode:', dev);

const app = next({ dev });
const handle = app.getRequestHandler();

const certPath = path.join(__dirname, `certificates/${hostName}.pem`);
const keyPath = path.join(__dirname, `certificates/${hostName}-key.pem`);

console.log('Certificate paths:');
console.log('- Cert:', certPath);
console.log('- Key:', keyPath);

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error('Certificates not found!');
  process.exit(1);
}

try {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    // Добавляем дополнительные параметры для безопасности
    minVersion: 'TLSv1.2',
    ciphers: [
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES256-GCM-SHA384',
    ].join(':'),
  };
  console.log('Certificates loaded successfully');

  app.prepare()
    .then(() => {
      console.log('Next.js app prepared');
      
      const server = createServer(httpsOptions, async (req, res) => {
        console.log(`Incoming request: ${req.method} ${req.url}`);

        // Обновим заголовки безопасности
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.setHeader('Content-Security-Policy', 
          "default-src 'self' https: 'unsafe-inline' 'unsafe-eval'; " +
          "img-src 'self' data: https: blob:; " +
          "connect-src 'self' https: wss: data: https://bridge.tonapi.io https://sse-bridge.hot-labs.org; " +
          "frame-src 'self' https: ton: tonkeeper:"
        );
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');

        // Обрабатываем OPTIONS запросы
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        try {
          const parsedUrl = parse(req.url, true);
          await handle(req, res, parsedUrl);
        } catch (err) {
          console.error('Error occurred handling', req.url, err);
          res.statusCode = 500;
          res.end('internal server error');
        }
      });

      server.on('error', (err) => {
        console.error('Server error:', err);
      });

      server.listen(port, '0.0.0.0', (err) => {
        if (err) {
          console.error('Failed to start server:', err);
          process.exit(1);
        }
        console.log('Server started successfully');
        console.log(`> Ready on https://${hostName}:${port}`);
      });
    })
    .catch((err) => {
      console.error('Failed to prepare app:', err);
      process.exit(1);
    });
} catch (err) {
  console.error('Failed to load certificates:', err);
  process.exit(1);
} 
