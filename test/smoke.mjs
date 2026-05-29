// Standalone smoke test: spins up a mock API + Swagger, then drives the server
// class directly to verify login auto-discovery, token auto-detect, fuzzy search,
// and response truncation. Run: node test/smoke.mjs
import http from 'http';
import { writeFileSync, unlinkSync } from 'fs';
import { OpenApiMcpServer } from '../src/index.js';

const swagger = {
  openapi: '3.0.0',
  info: { title: 'Mock API', version: '1.0.0' },
  paths: {
    '/api/auth/login': { post: { summary: 'Login', tags: ['Auth'], operationId: 'login' } },
    '/api/users': { get: { summary: 'List users', tags: ['Users'], operationId: 'getUsers' } },
    '/api/orders': { post: { summary: 'Create order', tags: ['Orders'], operationId: 'createOrder' } },
  },
  components: { schemas: {} },
};

let lastAuthHeader = null;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/swagger.json') return res.end(JSON.stringify(swagger));
  if (req.url === '/api/auth/login' && req.method === 'POST') {
    return res.end(JSON.stringify({ data: { accessToken: 'TOKEN_' + 'x'.repeat(40), expiresIn: 3600 } }));
  }
  if (req.url === '/api/users' && req.method === 'GET') {
    lastAuthHeader = req.headers.authorization || null;
    return res.end(JSON.stringify({ users: Array.from({ length: 50 }, (_, i) => ({ id: i, name: 'user' + i })) }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ✓ ' + msg);
};

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

// Config with auth.type=login but NO loginUrl and NO tokenPath -> exercises auto.
const cfgPath = new URL('./.tmp.config.json', import.meta.url).pathname;
writeFileSync(
  cfgPath,
  JSON.stringify({
    environments: {
      mock: {
        baseUrl: `${base}/api`,
        swaggerUrl: `${base}/swagger.json`,
        auth: { type: 'login', credentials: { email: 'a@b.c', password: 'pw' } },
      },
    },
    activeEnvironment: 'mock',
    maxResponseChars: 100000,
  })
);

let failed = false;
try {
  const srv = new OpenApiMcpServer(cfgPath);

  console.log('1) login auto-discovery + token auto-detect (no loginUrl/tokenPath in config):');
  const inspect = JSON.parse((await srv.handleInspectLogin({ environment: 'mock' })).content[0].text);
  assert(inspect.loginUrl.endsWith('/api/auth/login'), 'discovered loginUrl = /api/auth/login');
  assert(inspect.discoveredLoginUrl === true, 'flagged as auto-discovered');
  assert(inspect.autoDetectedTokenPath === 'data.accessToken', 'auto-detected tokenPath = data.accessToken');

  console.log('2) authenticated request uses the auto-resolved bearer token:');
  const users = JSON.parse((await srv.makeRequest('GET', 'mock', '/users', {})).content?.[0]?.text || 'null');
  // makeRequest returns a raw object, not json-wrapped:
  const usersRaw = await srv.makeRequest('GET', 'mock', '/users', {});
  assert(usersRaw.success === true && usersRaw.status === 200, 'GET /users succeeded');
  assert(/^Bearer TOKEN_/.test(lastAuthHeader), 'Authorization header carried the bearer token');

  console.log('3) fuzzy endpoint search:');
  const search = JSON.parse((await srv.handleSwaggerListEndpoints({ environment: 'mock', search: 'order' })).content[0].text);
  assert(search.totalEndpoints === 1 && search.endpoints[0].path === '/api/orders', 'search "order" -> /api/orders only');

  console.log('4) response truncation via maxChars:');
  const truncated = (await srv.handleSwaggerListEndpoints({ environment: 'mock', maxChars: 200 })).content[0].text;
  assert(truncated.includes('truncated') && truncated.length < 400, 'maxChars:200 truncates output');
  const full = (await srv.handleSwaggerListEndpoints({ environment: 'mock', maxChars: 0 })).content[0].text;
  assert(!full.includes('truncated'), 'maxChars:0 = unlimited (no truncation)');

  console.log('\nALL TESTS PASSED');
} catch (e) {
  failed = true;
  console.error('\n' + e.message);
} finally {
  try { unlinkSync(cfgPath); } catch {}
  server.close();
}
process.exit(failed ? 1 : 0);
