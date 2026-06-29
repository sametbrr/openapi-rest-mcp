#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import https from 'https';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, join, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OPENAPI_HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'];
const OPENAPI_HTTP_METHOD_ENUM = OPENAPI_HTTP_METHODS.map((method) => method.toUpperCase());

const HELP = `openapi-rest-mcp - MCP server for any OpenAPI/Swagger REST API

Usage:
  openapi-rest-mcp [--config <path>]

Config resolution order:
  1. --config <path> (or --config=<path>)
  2. OPENAPI_MCP_CONFIG environment variable (DOTNET_API_CONFIG also accepted)
  3. ./config.json in the current working directory

No config yet? The server still starts. Run the "config_init" tool to write a
starter config.json at the resolved path, then fill it in. The "config_status"
tool shows where the config is looked for and whether it loaded.

Options:
  -c, --config <path>   Path to config.json
  -v, --version         Print version and exit
  -h, --help            Print this help and exit`;

// --- helpers ---------------------------------------------------------------

function resolveConfigPath() {
  const argv = process.argv.slice(2);
  const idx = argv.findIndex((a) => a === '--config' || a === '-c');
  if (idx !== -1 && argv[idx + 1]) return resolve(argv[idx + 1]);
  const eq = argv.find((a) => a.startsWith('--config='));
  if (eq) return resolve(eq.slice('--config='.length));
  const envPath = process.env.OPENAPI_MCP_CONFIG || process.env.DOTNET_API_CONFIG;
  if (envPath) return resolve(envPath);
  return resolve(process.cwd(), 'config.json');
}

// Tracks ${ENV_VAR} names we've already warned about, to avoid stderr spam.
const warnedEnvVars = new Set();

// Replace ${ENV_VAR} occurrences anywhere in the config with process.env values.
// Undefined variables resolve to '' but emit a one-time warning so silent empty
// credentials are noticed.
function substituteEnvVars(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, name) => {
      if (process.env[name] === undefined && !warnedEnvVars.has(name)) {
        warnedEnvVars.add(name);
        console.error(`Warning: config references \${${name}} but it is not set; using "".`);
      }
      return process.env[name] ?? '';
    });
  }
  if (Array.isArray(value)) return value.map(substituteEnvVars);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteEnvVars(v);
    return out;
  }
  return value;
}

// Read a value out of an object via a dot-path (e.g. "data.accessToken").
function getByPath(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// Path patterns commonly used by login endpoints, in priority order.
const LOGIN_PATH_PATTERNS = [
  '/auth/login', '/account/login', '/users/login', '/login',
  '/authenticate', '/auth/token', '/connect/token', '/oauth/token',
  '/oauth2/token', '/token', '/signin', '/sign-in', '/sessions', '/session',
];

// Dot-paths commonly holding an auth token, tried in order.
const TOKEN_PATHS = [
  'token', 'accessToken', 'access_token', 'jwt', 'idToken', 'id_token',
  'authToken', 'bearerToken',
  'data.token', 'data.accessToken', 'data.access_token', 'data.jwt',
  'data.idToken', 'data.id_token', 'data.authToken',
  'result.token', 'result.accessToken', 'result.access_token',
  'data.tokens.access', 'tokens.access',
];

// Common dot-paths for token lifetime in seconds.
const EXPIRES_PATHS = [
  'expiresIn', 'expires_in', 'data.expiresIn', 'data.expires_in', 'result.expiresIn',
];

// Recursively find the first token-like string field (skipping refresh tokens).
function deepFindToken(node, trail = []) {
  if (!node || typeof node !== 'object') return null;
  for (const [k, v] of Object.entries(node)) {
    if (
      typeof v === 'string' &&
      v.length > 10 &&
      /(token|jwt|bearer)/i.test(k) &&
      !/refresh/i.test(k)
    ) {
      return { path: [...trail, k].join('.'), value: v };
    }
  }
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') {
      const hit = deepFindToken(v, [...trail, k]);
      if (hit) return hit;
    }
  }
  return null;
}

// Auto-detect a token in a login response. Returns { path, value } or null.
function detectToken(data) {
  for (const p of TOKEN_PATHS) {
    const v = getByPath(data, p);
    if (typeof v === 'string' && v.length > 10) return { path: p, value: v };
  }
  return deepFindToken(data);
}

// All plausible token paths in a response, for the inspect_login tool.
function suggestTokenPaths(data) {
  const out = [];
  const seen = new Set();
  const add = (path, value) => {
    if (seen.has(path)) return;
    seen.add(path);
    const sample =
      typeof value === 'string' && value.length > 12
        ? `${value.slice(0, 6)}…${value.slice(-4)} (len ${value.length})`
        : value;
    out.push({ path, sample });
  };
  for (const p of TOKEN_PATHS) {
    const v = getByPath(data, p);
    if (typeof v === 'string' && v.length > 10) add(p, v);
  }
  const walk = (node, trail) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && v.length > 10 && /(token|jwt|bearer)/i.test(k)) {
        add([...trail, k].join('.'), v);
      } else if (v && typeof v === 'object') {
        walk(v, [...trail, k]);
      }
    }
  };
  walk(data, []);
  return out;
}

function getPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// True when `target` is the same path as, or nested under, `root`.
function isPathWithin(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// Keys whose string values are likely secrets and should be masked in output.
const SECRET_KEY_RE =
  /(token|jwt|bearer|password|passwd|secret|authorization|api[-_]?key|credential)/i;

// Deep copy with secret-looking string values masked. Structure is preserved so
// token *paths* stay discoverable (e.g. for inspect_login) without leaking values.
function maskSecrets(value, key = '') {
  if (typeof value === 'string') {
    if (SECRET_KEY_RE.test(key) && value.length > 0) {
      return value.length > 12
        ? `${value.slice(0, 4)}…${value.slice(-2)} (len ${value.length}, masked)`
        : '***masked***';
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskSecrets(v, k);
    return out;
  }
  return value;
}

// Response headers that must never be echoed back into the model context.
const SENSITIVE_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'www-authenticate',
]);

// --- server ----------------------------------------------------------------

export class OpenApiMcpServer {
  constructor(configPath) {
    this.configPath = configPath;
    const { config, error } = this.loadConfig();
    this.config = config; // null until a valid config is present
    this.configError = error; // human-readable reason when config is null
    this.tokens = new Map(); // env name -> { value, expiresAt }
    this.swaggerCache = new Map(); // env name -> { doc, fetchedAt }
    this.warnedTlsHosts = new Set(); // hosts we've warned about disabled TLS for
    this.warnedAuthSkips = new Set(); // name:url pairs we've warned about skipped auth

    this.server = new Server(
      { name: 'openapi-rest-mcp', version: getPackageVersion() },
      { capabilities: { tools: {} } }
    );

    this.setupToolHandlers();
  }

  // Read + validate the config file. Never throws: returns { config, error }
  // (exactly one is non-null) so the server can still start when config is
  // missing/invalid and steer the user to config_init / config_status.
  loadConfig() {
    let raw;
    try {
      raw = readFileSync(this.configPath, 'utf8');
    } catch {
      return {
        config: null,
        error:
          `No config found at: ${this.configPath}\n` +
          `The server is running, but API/Swagger tools need a config first. ` +
          `Run the "config_init" tool to create a starter config.json there, then fill it in ` +
          `(or set OPENAPI_MCP_CONFIG / pass --config <path> to point elsewhere).`,
      };
    }

    let config;
    try {
      config = JSON.parse(raw);
    } catch (e) {
      return { config: null, error: `config.json is not valid JSON (${this.configPath}): ${e.message}` };
    }

    config = substituteEnvVars(config);

    if (!config.environments || typeof config.environments !== 'object') {
      return { config: null, error: 'config.json must contain an "environments" object.' };
    }
    if (!config.activeEnvironment || !config.environments[config.activeEnvironment]) {
      const names = Object.keys(config.environments).join(', ');
      return {
        config: null,
        error: `"activeEnvironment" ("${config.activeEnvironment}") not found in environments. Available: ${names}`,
      };
    }

    config.timeout = config.timeout ?? 30000;
    config.maxResponseChars = config.maxResponseChars ?? 100000;
    config.headers = config.headers ?? {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    return { config, error: null };
  }

  // Retry loadConfig() when none is loaded yet (so config_init + fill-in works
  // without a server restart). Never throws; returns the current config or null.
  tryLoadConfig() {
    if (!this.config) {
      const { config, error } = this.loadConfig();
      this.config = config;
      this.configError = error;
    }
    return this.config;
  }

  // Ensure a usable config, retrying once when none is loaded yet. Throws a
  // guiding error when config is still missing/invalid.
  requireConfig() {
    if (!this.tryLoadConfig()) {
      throw new Error(
        this.configError ||
          'Config not loaded. Run the "config_init" tool, or set OPENAPI_MCP_CONFIG / pass --config <path>.'
      );
    }
  }

  envNames() {
    return this.config ? Object.keys(this.config.environments) : [];
  }

  getEnv(environment) {
    this.requireConfig();
    const name = environment || this.config.activeEnvironment;
    const env = this.config.environments[name];
    if (!env) {
      throw new Error(`Unknown environment "${name}". Available: ${this.envNames().join(', ')}`);
    }
    return { name, env };
  }

  // TLS verification: explicit config wins; otherwise relax only for localhost.
  getHttpsAgent(env, url) {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* ignore */
    }
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';

    let reject;
    if (typeof env.rejectUnauthorized === 'boolean') {
      reject = env.rejectUnauthorized;
    } else if (typeof this.config.rejectUnauthorized === 'boolean') {
      reject = this.config.rejectUnauthorized;
    } else {
      reject = !isLocal;
    }

    // Warn once when TLS verification is disabled for a non-local host (MITM risk).
    if (!reject && !isLocal && host && !this.warnedTlsHosts.has(host)) {
      this.warnedTlsHosts.add(host);
      console.error(
        `Warning: TLS certificate verification is DISABLED for "${host}" (rejectUnauthorized:false). ` +
          `This exposes the connection to man-in-the-middle attacks.`
      );
    }
    return new https.Agent({ rejectUnauthorized: reject });
  }

  // Hosts that this environment's auth credentials may legitimately be sent to:
  // the configured baseUrl / swaggerUrl / loginUrl. Used to block credential
  // exfiltration when a tool is asked to call an unrelated absolute URL.
  allowedAuthHosts(env) {
    const hosts = new Set();
    for (const u of [env.baseUrl, env.swaggerUrl, env.auth?.loginUrl]) {
      if (!u) continue;
      try {
        hosts.add(new URL(this.resolveUrl(env, u)).host);
      } catch {
        /* ignore unparseable */
      }
    }
    return hosts;
  }

  // True when it is safe to attach this environment's auth to `url`. When no
  // allowlist can be derived (no baseUrl/swaggerUrl/loginUrl configured) we
  // cannot validate, so we fall back to allowing it.
  authAllowedForUrl(env, url) {
    const allowed = this.allowedAuthHosts(env);
    if (allowed.size === 0) return true;
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      return false;
    }
    return allowed.has(host);
  }

  // Auth headers/params for `url`, or empty (+ a one-time warning) when `url`
  // points at a host outside the environment's allowlist.
  async resolveAuthForUrl(name, env, url) {
    if (!env.auth || !env.auth.type || env.auth.type === 'none') {
      return { headers: {}, params: {} };
    }
    if (!this.authAllowedForUrl(env, url)) {
      const key = `${name}:${url}`;
      if (!this.warnedAuthSkips.has(key)) {
        this.warnedAuthSkips.add(key);
        const allowed = [...this.allowedAuthHosts(env)].join(', ') || '(none)';
        console.error(
          `Warning: not attaching "${name}" auth to ${url} - host is outside the allowed hosts (${allowed}).`
        );
      }
      return { headers: {}, params: {} };
    }
    return this.resolveAuth(name, env);
  }

  // Base axios config shared by makeRequest / fetchSwaggerDoc / postLogin:
  // config headers, timeout, TLS agent, and a content-size cap (DoS guard).
  requestConfig(env, url, extra = {}) {
    const { headers, params, ...rest } = extra;
    return {
      url,
      headers: { ...this.config.headers, ...headers },
      ...(params ? { params } : {}),
      timeout: this.config.timeout,
      httpsAgent: this.getHttpsAgent(env, url),
      maxContentLength: this.config.maxContentLength ?? 10 * 1024 * 1024,
      maxBodyLength: this.config.maxBodyLength ?? 10 * 1024 * 1024,
      ...rest,
    };
  }

  // POST credentials to a login endpoint. Shared by ensureLoginToken and
  // inspect_login so the request shape (and host policy) lives in one place.
  async postLogin(env, auth, loginUrl, credentials) {
    return axios(
      this.requestConfig(env, loginUrl, {
        method: auth.method || 'POST',
        data: credentials ?? {},
        headers: auth.headers || {},
      })
    );
  }

  // Absolute URL stays as-is; relative path is joined onto the env baseUrl.
  resolveUrl(env, url) {
    if (/^https?:\/\//i.test(url)) return url;
    if (!env.baseUrl) {
      throw new Error(`Relative URL "${url}" requires a "baseUrl" in this environment's config.`);
    }
    return env.baseUrl.replace(/\/+$/, '') + '/' + String(url).replace(/^\/+/, '');
  }

  // Build auth headers/params for an environment. Returns {} when no auth is set.
  async resolveAuth(name, env) {
    const auth = env.auth;
    const result = { headers: {}, params: {} };
    if (!auth || !auth.type || auth.type === 'none') return result;

    switch (auth.type) {
      case 'bearer': {
        if (!auth.token) throw new Error('auth.type "bearer" requires a "token".');
        result.headers[auth.headerName || 'Authorization'] =
          `${auth.headerPrefix ?? 'Bearer '}${auth.token}`;
        break;
      }
      case 'apiKey': {
        if (!auth.value) throw new Error('auth.type "apiKey" requires a "value".');
        const key = auth.headerName || auth.name || 'X-Api-Key';
        if ((auth.in || 'header') === 'query') result.params[key] = auth.value;
        else result.headers[key] = auth.value;
        break;
      }
      case 'basic': {
        if (!auth.username) throw new Error('auth.type "basic" requires "username" and "password".');
        const token = Buffer.from(`${auth.username}:${auth.password ?? ''}`).toString('base64');
        result.headers.Authorization = `Basic ${token}`;
        break;
      }
      case 'login': {
        const token = await this.ensureLoginToken(name, env, auth);
        result.headers[auth.headerName || 'Authorization'] =
          `${auth.headerPrefix ?? 'Bearer '}${token}`;
        break;
      }
      default:
        throw new Error(`Unknown auth.type "${auth.type}". Use none|bearer|apiKey|basic|login.`);
    }
    return result;
  }

  // Server root the Swagger paths are relative to (paths are concatenated, not
  // URL-resolved, onto this base). Handles OpenAPI v3 servers and Swagger v2 host.
  specServerBase(env, doc) {
    const fallbackOrigin = () => {
      try {
        return new URL(this.resolveUrl(env, env.swaggerUrl || env.baseUrl || '')).origin;
      } catch {
        return '';
      }
    };
    if (Array.isArray(doc.servers) && doc.servers[0]?.url) {
      const u = doc.servers[0].url;
      if (/^https?:\/\//i.test(u)) return u.replace(/\/+$/, '');
      return (fallbackOrigin() + '/' + u.replace(/^\/+/, '')).replace(/\/+$/, '');
    }
    if (doc.host) {
      const scheme = (doc.schemes && doc.schemes[0]) || 'https';
      return `${scheme}://${doc.host}${doc.basePath || ''}`.replace(/\/+$/, '');
    }
    return fallbackOrigin();
  }

  // Find a likely login endpoint by scanning the Swagger spec for a POST path.
  // Used when auth.type === "login" but no loginUrl is configured.
  async discoverLoginUrl(name, env) {
    if (!env.swaggerUrl) {
      throw new Error(
        `auth.type "login" needs a "loginUrl", or a "swaggerUrl" so it can be auto-discovered (environment "${name}").`
      );
    }
    let doc;
    try {
      doc = await this.fetchSwaggerDoc(name, { skipAuth: true });
    } catch (error) {
      throw new Error(
        `Could not auto-discover the login endpoint (${error.message}). Set auth.loginUrl manually.`
      );
    }

    const paths = doc.paths || {};
    let best = null;
    for (const [path, methods] of Object.entries(paths)) {
      if (!methods || typeof methods !== 'object' || !methods.post) continue;
      const rank = LOGIN_PATH_PATTERNS.findIndex((pat) => path.toLowerCase().includes(pat));
      if (rank === -1) continue;
      if (!best || rank < best.rank) best = { path, rank };
    }
    if (!best) {
      throw new Error(
        `Could not find a login endpoint in the Swagger spec for "${name}". Set auth.loginUrl manually.`
      );
    }
    // Return an absolute URL: Swagger paths are relative to the spec server root,
    // not to baseUrl (which may itself include a path segment like /api).
    const serverBase = this.specServerBase(env, doc);
    return serverBase
      ? serverBase.replace(/\/+$/, '') + '/' + best.path.replace(/^\/+/, '')
      : best.path;
  }

  // For auth.type === "login": POST credentials, cache the extracted token.
  // loginUrl and tokenPath are used as-is when configured, otherwise auto-resolved.
  async ensureLoginToken(name, env, auth) {
    const now = Date.now();
    const cached = this.tokens.get(name);
    if (cached && (!cached.expiresAt || cached.expiresAt > now + 5000)) {
      return cached.value;
    }

    // loginUrl: manual if configured, otherwise discovered from the Swagger spec.
    const loginPath = auth.loginUrl || (await this.discoverLoginUrl(name, env));
    const loginUrl = this.resolveUrl(env, loginPath);

    let resp;
    try {
      resp = await this.postLogin(env, auth, loginUrl, auth.credentials);
    } catch (error) {
      const status = error.response ? ` (HTTP ${error.response.status})` : '';
      throw new Error(`Login request to ${loginUrl} failed${status}: ${error.message}`);
    }

    // tokenPath: manual if configured, otherwise auto-detected from the response.
    let value;
    if (auth.tokenPath) {
      value = getByPath(resp.data, auth.tokenPath);
      if (value == null) {
        const keys =
          resp.data && typeof resp.data === 'object' ? Object.keys(resp.data).join(', ') : '';
        throw new Error(
          `Login succeeded but no token at "${auth.tokenPath}". Response keys: ${keys}. ` +
            `Use the inspect_login tool to find the right path.`
        );
      }
    } else {
      const found = detectToken(resp.data);
      if (!found) {
        const keys =
          resp.data && typeof resp.data === 'object' ? Object.keys(resp.data).join(', ') : '';
        throw new Error(
          `Login succeeded but no token could be auto-detected. Response keys: ${keys}. ` +
            `Set auth.tokenPath, or use the inspect_login tool.`
        );
      }
      value = found.value;
    }

    // Expiry: explicit path/value wins, otherwise auto-detect a common field.
    let secs;
    if (auth.expiresInPath) secs = Number(getByPath(resp.data, auth.expiresInPath));
    else if (auth.expiresIn != null) secs = Number(auth.expiresIn);
    else {
      for (const p of EXPIRES_PATHS) {
        const v = Number(getByPath(resp.data, p));
        if (Number.isFinite(v) && v > 0) {
          secs = v;
          break;
        }
      }
    }
    const expiresAt = Number.isFinite(secs) && secs > 0 ? now + secs * 1000 : null;

    this.tokens.set(name, { value, expiresAt });
    return value;
  }

  async makeRequest(method, environment, url, { data, params, headers, includeHeaders } = {}) {
    const { name, env } = this.getEnv(environment);
    const finalUrl = this.resolveUrl(env, url);
    // Auth is attached only when finalUrl is on the environment's allowlist,
    // so a request to an unrelated absolute URL can't leak credentials.
    const auth = await this.resolveAuthForUrl(name, env, finalUrl);

    const config = this.requestConfig(env, finalUrl, {
      method,
      headers: { ...auth.headers, ...headers },
      params: { ...auth.params, ...params },
      // Don't follow redirects by default: a redirect could carry auth headers
      // to an attacker-controlled host. Opt back in with config.maxRedirects.
      maxRedirects: this.config.maxRedirects ?? 0,
    });
    if (data !== undefined && data !== null) config.data = data;

    try {
      const response = await axios(config);
      return this.requestResult(true, response, includeHeaders);
    } catch (error) {
      if (error.response) {
        return this.requestResult(false, error.response, includeHeaders, error.message);
      }
      return { success: false, error: error.message };
    }
  }

  // Shape a request result, omitting response headers unless explicitly asked
  // for, and stripping sensitive headers (set-cookie etc.) when included.
  requestResult(success, response, includeHeaders, errorMessage) {
    const out = { success, status: response.status, data: response.data };
    if (!success && errorMessage) out.error = errorMessage;
    if (includeHeaders) out.headers = this.safeHeaders(response.headers);
    return out;
  }

  safeHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers || {})) {
      out[k] = SENSITIVE_RESPONSE_HEADERS.has(k.toLowerCase()) ? '***redacted***' : v;
    }
    return out;
  }

  // skipAuth avoids the login→swagger→login recursion during loginUrl discovery
  // (Swagger specs and login endpoints are typically reachable unauthenticated).
  async fetchSwaggerDoc(environment, { skipAuth = false } = {}) {
    const { name, env } = this.getEnv(environment);
    if (!env.swaggerUrl) {
      throw new Error(`"swaggerUrl" not configured for environment "${name}".`);
    }

    const ttl = (this.config.swaggerCacheTtl ?? 300) * 1000;
    const cached = this.swaggerCache.get(name);
    if (cached && Date.now() - cached.fetchedAt < ttl) return cached.doc;

    const url = this.resolveUrl(env, env.swaggerUrl);
    const auth = skipAuth ? { headers: {}, params: {} } : await this.resolveAuthForUrl(name, env, url);

    let response;
    try {
      response = await axios.get(
        url,
        this.requestConfig(env, url, { headers: auth.headers, params: auth.params })
      );
    } catch (error) {
      throw new Error(`Failed to fetch Swagger documentation from ${url}: ${error.message}`);
    }

    this.swaggerCache.set(name, { doc: response.data, fetchedAt: Date.now() });
    return response.data;
  }

  // Recursively inline $ref pointers (with cycle protection). `depth` bounds the
  // recursion so a hostile/huge spec can't blow the stack or memory.
  resolveRefs(node, doc, seen = new Set(), depth = 0) {
    if (!node || typeof node !== 'object') return node;
    if (depth > 100) return node; // give up inlining beyond a sane depth

    if (typeof node.$ref === 'string') {
      const ref = node.$ref;
      if (seen.has(ref)) return { $ref: ref };
      const parts = ref
        .replace(/^#\//, '')
        .split('/')
        .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
      const target = parts.reduce((acc, key) => (acc == null ? undefined : acc[key]), doc);
      if (target === undefined) return node;
      const next = new Set(seen);
      next.add(ref);
      return this.resolveRefs(target, doc, next, depth + 1);
    }

    if (Array.isArray(node)) return node.map((n) => this.resolveRefs(n, doc, seen, depth + 1));

    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = this.resolveRefs(v, doc, seen, depth + 1);
    return out;
  }

  setupToolHandlers() {
    const urlProp = {
      type: 'string',
      description:
        'API URL - absolute (https://host/path) or relative to the environment baseUrl (e.g. /users)',
    };
    const headersProp = {
      type: 'object',
      description: 'Custom headers (merged on top of config + auth headers)',
      additionalProperties: true,
    };
    const paramsProp = {
      type: 'object',
      description: 'Query parameters',
      additionalProperties: true,
    };
    const dataProp = {
      type: 'object',
      description: 'Request body data',
      additionalProperties: true,
    };
    const maxCharsProp = {
      type: 'number',
      description:
        'Max characters in the returned text (0 = unlimited; defaults to config.maxResponseChars).',
    };
    const includeHeadersProp = {
      type: 'boolean',
      description: 'Include sanitized response headers in the result (default: false).',
    };
    // Enum is filled in fresh on each ListTools call (see below) so it reflects
    // a config that may have been created/loaded after startup.
    const environmentProp = {
      type: 'string',
      description: 'Environment name (defaults to the active environment)',
      enum: [],
    };
    // The five api_* tools share one schema shape; only the body differs.
    const apiTool = (name, description, { hasData = false, requireData = false } = {}) => ({
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: {
          url: urlProp,
          ...(hasData ? { data: dataProp } : {}),
          params: paramsProp,
          headers: headersProp,
          environment: environmentProp,
          includeHeaders: includeHeadersProp,
          maxChars: maxCharsProp,
        },
        required: requireData ? ['url', 'data'] : ['url'],
      },
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      environmentProp.enum = this.envNames();
      return { tools: [
        apiTool('api_get', 'GET request to an API endpoint'),
        apiTool('api_post', 'POST request to an API endpoint', { hasData: true, requireData: true }),
        apiTool('api_put', 'PUT request to an API endpoint', { hasData: true, requireData: true }),
        apiTool('api_delete', 'DELETE request to an API endpoint', { hasData: true }),
        apiTool('api_patch', 'PATCH request to an API endpoint', { hasData: true, requireData: true }),
        {
          name: 'inspect_login',
          description:
            'POST credentials to the login endpoint and return the raw response plus suggested token paths. Use this to discover the right auth.tokenPath (and verify auto-discovered loginUrl) without committing config.',
          inputSchema: {
            type: 'object',
            properties: {
              environment: environmentProp,
              loginUrl: {
                type: 'string',
                description:
                  'Login endpoint (defaults to auth.loginUrl, or auto-discovered from Swagger).',
              },
              credentials: {
                type: 'object',
                description: 'Credentials body to post (defaults to auth.credentials).',
                additionalProperties: true,
              },
              maxChars: maxCharsProp,
            },
          },
        },
        {
          name: 'swagger_fetch',
          description: 'Fetch and summarize Swagger/OpenAPI documentation for an environment',
          inputSchema: {
            type: 'object',
            properties: { environment: environmentProp, maxChars: maxCharsProp },
          },
        },
        {
          name: 'swagger_list_endpoints',
          description:
            'List API endpoints from Swagger. Optionally fuzzy-search by keyword and/or filter by tag and method.',
          inputSchema: {
            type: 'object',
            properties: {
              environment: environmentProp,
              search: {
                type: 'string',
                description:
                  'Fuzzy keyword(s) matched across path, summary, description, tags and operationId (space-separated terms, ranked by matches).',
              },
              tag: { type: 'string', description: 'Filter endpoints by tag/controller name' },
              method: {
                type: 'string',
                description: 'Filter by HTTP method',
                enum: OPENAPI_HTTP_METHOD_ENUM,
              },
              limit: { type: 'number', description: 'Max number of endpoints to return' },
              maxChars: maxCharsProp,
            },
          },
        },
        {
          name: 'swagger_get_endpoint',
          description: 'Get detailed information about a specific endpoint from Swagger',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'API endpoint path (e.g., /api/users/{id})' },
              method: { type: 'string', description: 'HTTP method', enum: OPENAPI_HTTP_METHOD_ENUM },
              environment: environmentProp,
              resolveRefs: {
                type: 'boolean',
                description: 'Inline $ref schema pointers (default: true)',
              },
              maxChars: maxCharsProp,
            },
            required: ['path', 'method'],
          },
        },
        {
          name: 'swagger_get_schema',
          description: 'Get a schema/model definition from Swagger documentation',
          inputSchema: {
            type: 'object',
            properties: {
              schemaName: {
                type: 'string',
                description: 'Name of the schema/model (e.g., UserDto, CreateUserRequest)',
              },
              environment: environmentProp,
              resolveRefs: {
                type: 'boolean',
                description: 'Inline nested $ref pointers (default: true)',
              },
              maxChars: maxCharsProp,
            },
            required: ['schemaName'],
          },
        },
        {
          name: 'config_status',
          description:
            'Report where the config is looked for, whether it was found/loaded, the active ' +
            'environment, and the available environments. Use this to diagnose setup issues.',
          inputSchema: { type: 'object', properties: { maxChars: maxCharsProp } },
        },
        {
          name: 'config_init',
          description:
            'Write a starter config.json (from config.example.json) so the user can fill it in. ' +
            'Writes to the resolved config path by default; will not overwrite unless force is true.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Where to write the config (default: the resolved config path).',
              },
              force: {
                type: 'boolean',
                description: 'Overwrite an existing file (default: false).',
              },
              maxChars: maxCharsProp,
            },
          },
        },
      ] };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      try {
        switch (name) {
          case 'api_get':
            return this.json(await this.makeRequest('GET', args.environment, args.url, args), args.maxChars);
          case 'api_post':
            return this.json(await this.makeRequest('POST', args.environment, args.url, args), args.maxChars);
          case 'api_put':
            return this.json(await this.makeRequest('PUT', args.environment, args.url, args), args.maxChars);
          case 'api_delete':
            return this.json(await this.makeRequest('DELETE', args.environment, args.url, args), args.maxChars);
          case 'api_patch':
            return this.json(await this.makeRequest('PATCH', args.environment, args.url, args), args.maxChars);
          case 'inspect_login':
            return await this.handleInspectLogin(args);
          case 'swagger_fetch':
            return await this.handleSwaggerFetch(args);
          case 'swagger_list_endpoints':
            return await this.handleSwaggerListEndpoints(args);
          case 'swagger_get_endpoint':
            return await this.handleSwaggerGetEndpoint(args);
          case 'swagger_get_schema':
            return await this.handleSwaggerGetSchema(args);
          case 'config_status':
            return this.handleConfigStatus(args);
          case 'config_init':
            return this.handleConfigInit(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  // maxChars: per-call override; falls back to config.maxResponseChars. 0 = unlimited.
  json(payload, maxChars) {
    let text = JSON.stringify(payload, null, 2);
    const limit = maxChars ?? this.config?.maxResponseChars ?? 0;
    if (limit > 0 && text.length > limit) {
      const dropped = text.length - limit;
      text =
        text.slice(0, limit) +
        `\n\n... [truncated ${dropped} of ${text.length} chars. ` +
        `Pass maxChars:0 for the full output, or narrow the request.]`;
    }
    return { content: [{ type: 'text', text }] };
  }

  // Current config status, as a plain object (used by config_status).
  // Attempts a lazy reload so a freshly written/edited config is reflected.
  configState() {
    this.tryLoadConfig();
    return {
      configPath: this.configPath,
      exists: existsSync(this.configPath),
      loaded: !!this.config,
      error: this.config ? null : this.configError,
      activeEnvironment: this.config?.activeEnvironment ?? null,
      environments: this.envNames(),
    };
  }

  handleConfigStatus(args) {
    const state = this.configState();
    return this.json(
      {
        ...state,
        hint: state.loaded
          ? 'Config is loaded; api_* and swagger_* tools are ready.'
          : 'Run the "config_init" tool to write a starter config.json, then fill it in.',
      },
      args.maxChars
    );
  }

  handleConfigInit(args) {
    const target = args.path ? resolve(args.path) : this.configPath;
    // Confine writes to the project (cwd) or the configured config's directory,
    // so the tool can't be steered into clobbering arbitrary files.
    const allowedRoots = [process.cwd(), dirname(this.configPath)];
    if (!allowedRoots.some((root) => isPathWithin(root, target))) {
      return this.json(
        {
          written: false,
          path: target,
          reason:
            'Refused: path is outside the project directory and the configured config location.',
        },
        args.maxChars
      );
    }
    if (existsSync(target) && !args.force) {
      return this.json(
        {
          written: false,
          path: target,
          reason: 'A file already exists at this path. Pass force:true to overwrite.',
        },
        args.maxChars
      );
    }
    const examplePath = join(__dirname, '..', 'config.example.json');
    let template;
    try {
      template = readFileSync(examplePath, 'utf8');
    } catch {
      throw new Error(`Could not read the template at ${examplePath}.`);
    }
    writeFileSync(target, template);
    // When written to the path the server reads from, the next status/tool call
    // picks it up via tryLoadConfig() - no restart needed.
    return this.json(
      {
        written: true,
        path: target,
        next: 'Edit this file (set baseUrl/swaggerUrl/auth, use ${ENV_VAR} for secrets), then call any api_* tool.',
      },
      args.maxChars
    );
  }

  async handleInspectLogin(args) {
    const { name, env } = this.getEnv(args.environment);
    const auth = env.auth || {};

    const loginPath = args.loginUrl || auth.loginUrl;
    const discovered = !loginPath;
    const loginUrl = this.resolveUrl(env, loginPath || (await this.discoverLoginUrl(name, env)));
    const credentials = args.credentials || auth.credentials || {};

    // Don't post the environment's configured credentials to a host outside its
    // allowlist. Only allow it when the caller explicitly supplied credentials
    // (i.e. it's a deliberate probe, not exfiltration of stored secrets).
    if (!args.credentials && !this.authAllowedForUrl(env, loginUrl)) {
      const allowed = [...this.allowedAuthHosts(env)].join(', ') || '(none)';
      throw new Error(
        `Refusing to send "${name}" credentials to ${loginUrl} - host is outside the allowed hosts (${allowed}). ` +
          `Pass explicit "credentials" to probe a different host.`
      );
    }

    let resp;
    let ok = true;
    try {
      resp = await this.postLogin(env, auth, loginUrl, credentials);
    } catch (error) {
      if (!error.response) throw new Error(`Login request to ${loginUrl} failed: ${error.message}`);
      resp = error.response;
      ok = false;
    }

    const detected = detectToken(resp.data);
    return this.json(
      {
        success: ok,
        loginUrl,
        discoveredLoginUrl: discovered,
        status: resp.status,
        autoDetectedTokenPath: detected ? detected.path : null,
        suggestedTokenPaths: suggestTokenPaths(resp.data),
        responseKeys:
          resp.data && typeof resp.data === 'object' ? Object.keys(resp.data) : [],
        // Secret values masked so token *paths* stay discoverable without leaking tokens.
        response: maskSecrets(resp.data),
      },
      args.maxChars
    );
  }

  async handleSwaggerFetch(args) {
    const doc = await this.fetchSwaggerDoc(args.environment);
    return this.json(
      {
        success: true,
        info: doc.info,
        host: doc.host,
        basePath: doc.basePath,
        schemes: doc.schemes,
        totalPaths: Object.keys(doc.paths || {}).length,
        totalSchemas: Object.keys(doc.components?.schemas || doc.definitions || {}).length,
      },
      args.maxChars
    );
  }

  async handleSwaggerListEndpoints(args) {
    const doc = await this.fetchSwaggerDoc(args.environment);
    const paths = doc.paths || {};
    const terms = args.search
      ? String(args.search).toLowerCase().split(/\s+/).filter(Boolean)
      : [];
    let endpoints = [];

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, details] of Object.entries(methods)) {
        if (!OPENAPI_HTTP_METHODS.includes(method.toLowerCase())) continue;
        if (args.tag && !details.tags?.includes(args.tag)) continue;
        if (args.method && method.toUpperCase() !== args.method.toUpperCase()) continue;

        const ep = {
          path,
          method: method.toUpperCase(),
          summary: details.summary || '',
          description: details.description || '',
          tags: details.tags || [],
          operationId: details.operationId || '',
        };

        if (terms.length) {
          const haystack =
            `${path} ${ep.summary} ${ep.description} ${ep.tags.join(' ')} ${ep.operationId}`.toLowerCase();
          const score = terms.reduce((s, t) => (haystack.includes(t) ? s + 1 : s), 0);
          if (score === 0) continue;
          ep._score = score;
        }
        endpoints.push(ep);
      }
    }

    if (terms.length) {
      endpoints.sort((a, b) => b._score - a._score || a.path.localeCompare(b.path));
      endpoints.forEach((e) => delete e._score);
    }

    const limit = Number(args.limit);
    if (Number.isFinite(limit) && limit > 0) endpoints = endpoints.slice(0, limit);

    return this.json({ success: true, totalEndpoints: endpoints.length, endpoints }, args.maxChars);
  }

  async handleSwaggerGetEndpoint(args) {
    const doc = await this.fetchSwaggerDoc(args.environment);
    const paths = doc.paths || {};
    const method = args.method.toLowerCase();

    if (!paths[args.path] || !paths[args.path][method]) {
      throw new Error(`Endpoint not found: ${args.method} ${args.path}`);
    }

    let endpoint = paths[args.path][method];
    if (args.resolveRefs !== false) endpoint = this.resolveRefs(endpoint, doc);

    return this.json(
      {
        success: true,
        path: args.path,
        method: args.method.toUpperCase(),
        summary: endpoint.summary || '',
        description: endpoint.description || '',
        tags: endpoint.tags || [],
        operationId: endpoint.operationId || '',
        parameters: endpoint.parameters || [],
        requestBody: endpoint.requestBody || null,
        responses: endpoint.responses || {},
        security: endpoint.security || [],
      },
      args.maxChars
    );
  }

  async handleSwaggerGetSchema(args) {
    const doc = await this.fetchSwaggerDoc(args.environment);
    const schemas = doc.components?.schemas || doc.definitions || {};

    if (!schemas[args.schemaName]) {
      throw new Error(`Schema not found: ${args.schemaName}`);
    }

    let schema = schemas[args.schemaName];
    if (args.resolveRefs !== false) schema = this.resolveRefs(schema, doc);

    return this.json({ success: true, schemaName: args.schemaName, schema }, args.maxChars);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('openapi-rest-mcp server running on stdio');
  }
}

export async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(getPackageVersion() + '\n');
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const server = new OpenApiMcpServer(resolveConfigPath());
  await server.run();
}

// Run only when executed directly (not when imported, e.g. by tests).
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
