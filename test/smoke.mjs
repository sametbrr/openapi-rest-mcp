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
    '/api/health': {
      head: { summary: 'Health headers', tags: ['Health'], operationId: 'headHealth' },
      options: { summary: 'Health options', tags: ['Health'], operationId: 'optionsHealth' },
      trace: { summary: 'Health trace', tags: ['Health'], operationId: 'traceHealth' },
    },
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

// A second "attacker" host on a different port: any Authorization header that
// reaches it would be a credential leak.
let attackerGotAuth = 'UNSET';
const attacker = http.createServer((req, res) => {
  attackerGotAuth = req.headers.authorization || null;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true }));
});

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ✓ ' + msg);
};

await new Promise((r) => server.listen(0, r));
await new Promise((r) => attacker.listen(0, r));
const port = server.address().port;
const attackerBase = `http://127.0.0.1:${attacker.address().port}`;
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

  const trace = JSON.parse((await srv.handleSwaggerListEndpoints({ environment: 'mock', method: 'TRACE' })).content[0].text);
  assert(trace.totalEndpoints === 1 && trace.endpoints[0].operationId === 'traceHealth', 'TRACE endpoints are listed');

  const options = JSON.parse((await srv.handleSwaggerGetEndpoint({ environment: 'mock', path: '/api/health', method: 'OPTIONS' })).content[0].text);
  assert(options.success === true && options.operationId === 'optionsHealth', 'OPTIONS endpoint details are returned');

  const head = JSON.parse((await srv.handleSwaggerGetEndpoint({ environment: 'mock', path: '/api/health', method: 'HEAD' })).content[0].text);
  assert(head.success === true && head.operationId === 'headHealth', 'HEAD endpoint details are returned');

  console.log('4) response truncation via maxChars:');
  const truncated = (await srv.handleSwaggerListEndpoints({ environment: 'mock', maxChars: 200 })).content[0].text;
  assert(truncated.includes('truncated') && truncated.length < 400, 'maxChars:200 truncates output');
  const full = (await srv.handleSwaggerListEndpoints({ environment: 'mock', maxChars: 0 })).content[0].text;
  assert(!full.includes('truncated'), 'maxChars:0 = unlimited (no truncation)');

  console.log('5) missing config: server starts, tools steer to config_init (no crash):');
  const missingPath = new URL('./.tmp.missing.json', import.meta.url).pathname;
  try { unlinkSync(missingPath); } catch {}
  const noCfg = new OpenApiMcpServer(missingPath);
  assert(noCfg.config === null && !!noCfg.configError, 'config=null + configError set');
  assert(/config_init/.test(noCfg.configError), 'configError points to config_init');
  const status = JSON.parse(noCfg.handleConfigStatus({}).content[0].text);
  assert(status.loaded === false && status.exists === false, 'config_status reports loaded:false');
  assert(status.configPath === missingPath && /config_init/.test(status.hint), 'config_status shows path + config_init hint');
  let guardThrew = false;
  try { await noCfg.makeRequest('GET', undefined, '/x', {}); }
  catch (e) { guardThrew = /config/i.test(e.message); }
  assert(guardThrew, 'api call throws a guided config error (caught by the tool layer, no crash)');

  console.log('6) config_init writes a starter config + lazy-reload picks it up:');
  const initRes = JSON.parse(noCfg.handleConfigInit({}).content[0].text);
  assert(initRes.written === true && initRes.path === missingPath, 'config_init wrote to the resolved path');
  const initStatus = JSON.parse(noCfg.handleConfigStatus({}).content[0].text);
  assert(initStatus.loaded === true && initStatus.exists === true, 'config re-read after init (no restart)');
  const reinit = JSON.parse(noCfg.handleConfigInit({}).content[0].text);
  assert(reinit.written === false, 'config_init refuses to overwrite without force');
  try { unlinkSync(missingPath); } catch {}

  console.log('7) SEC-1: auth is NOT attached to an unrelated absolute URL (no credential leak):');
  // Sanity: auth DOES reach the configured host.
  attackerGotAuth = 'UNSET';
  await srv.makeRequest('GET', 'mock', '/users', {});
  assert(/^Bearer TOKEN_/.test(lastAuthHeader), 'auth attached for the configured host');
  // But a request to a different host (port) must carry no Authorization header.
  const leak = await srv.makeRequest('GET', 'mock', `${attackerBase}/grab`, {});
  assert(leak.success === true, 'cross-host request still succeeds');
  assert(attackerGotAuth === null, 'no Authorization header reached the foreign host');

  console.log('8) SEC-2: config_init refuses to write outside the project/config dir:');
  const refused = JSON.parse(noCfg.handleConfigInit({ path: '/openapi-mcp-evil.json', force: true }).content[0].text);
  assert(refused.written === false && /Refused/.test(refused.reason), 'config_init refuses an out-of-tree path');

  console.log('\nALL TESTS PASSED');
} catch (e) {
  failed = true;
  console.error('\n' + e.message);
} finally {
  try { unlinkSync(cfgPath); } catch {}
  server.close();
  attacker.close();
}
process.exit(failed ? 1 : 0);
