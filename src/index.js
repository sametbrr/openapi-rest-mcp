#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import https from 'https';
import { readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HELP = `openapi-rest-mcp - MCP server for any OpenAPI/Swagger REST API

Usage:
  openapi-rest-mcp [--config <path>]

Config resolution order:
  1. --config <path> (or --config=<path>)
  2. OPENAPI_MCP_CONFIG environment variable (DOTNET_API_CONFIG also accepted)
  3. ./config.json in the current working directory

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

// Replace ${ENV_VAR} occurrences anywhere in the config with process.env values.
function substituteEnvVars(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
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

// --- server ----------------------------------------------------------------

export class OpenApiMcpServer {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this.loadConfig();
    this.tokens = new Map(); // env name -> { value, expiresAt }
    this.swaggerCache = new Map(); // env name -> { doc, fetchedAt }

    this.server = new Server(
      { name: 'openapi-rest-mcp', version: getPackageVersion() },
      { capabilities: { tools: {} } }
    );

    this.setupToolHandlers();
  }

  loadConfig() {
    let raw;
    try {
      raw = readFileSync(this.configPath, 'utf8');
    } catch {
      throw new Error(
        `config.json not found at: ${this.configPath}\n` +
          `Create it there, set OPENAPI_MCP_CONFIG, or pass --config <path>. ` +
          `See config.example.json for the format.`
      );
    }

    let config;
    try {
      config = JSON.parse(raw);
    } catch (e) {
      throw new Error(`config.json is not valid JSON (${this.configPath}): ${e.message}`);
    }

    config = substituteEnvVars(config);

    if (!config.environments || typeof config.environments !== 'object') {
      throw new Error('config.json must contain an "environments" object.');
    }
    if (!config.activeEnvironment || !config.environments[config.activeEnvironment]) {
      const names = Object.keys(config.environments).join(', ');
      throw new Error(
        `"activeEnvironment" ("${config.activeEnvironment}") not found in environments. Available: ${names}`
      );
    }

    config.timeout = config.timeout ?? 30000;
    config.maxResponseChars = config.maxResponseChars ?? 100000;
    config.headers = config.headers ?? {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    return config;
  }

  envNames() {
    return Object.keys(this.config.environments);
  }

  getEnv(environment) {
    const name = environment || this.config.activeEnvironment;
    const env = this.config.environments[name];
    if (!env) {
      throw new Error(`Unknown environment "${name}". Available: ${this.envNames().join(', ')}`);
    }
    return { name, env };
  }

  // TLS verification: explicit config wins; otherwise relax only for localhost.
  getHttpsAgent(env, url) {
    let reject;
    if (typeof env.rejectUnauthorized === 'boolean') {
      reject = env.rejectUnauthorized;
    } else if (typeof this.config.rejectUnauthorized === 'boolean') {
      reject = this.config.rejectUnauthorized;
    } else {
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        /* ignore */
      }
      reject = !(host === 'localhost' || host === '127.0.0.1' || host === '::1');
    }
    return new https.Agent({ rejectUnauthorized: reject });
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
      resp = await axios({
        method: auth.method || 'POST',
        url: loginUrl,
        data: auth.credentials ?? {},
        headers: { ...this.config.headers, ...(auth.headers || {}) },
        timeout: this.config.timeout,
        httpsAgent: this.getHttpsAgent(env, loginUrl),
      });
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

  async makeRequest(method, environment, url, { data, params, headers } = {}) {
    const { name, env } = this.getEnv(environment);
    const finalUrl = this.resolveUrl(env, url);
    const auth = await this.resolveAuth(name, env);

    const config = {
      method,
      url: finalUrl,
      headers: { ...this.config.headers, ...auth.headers, ...headers },
      params: { ...auth.params, ...params },
      timeout: this.config.timeout,
      httpsAgent: this.getHttpsAgent(env, finalUrl),
    };
    if (data !== undefined && data !== null) config.data = data;

    try {
      const response = await axios(config);
      return {
        success: true,
        status: response.status,
        data: response.data,
        headers: response.headers,
      };
    } catch (error) {
      if (error.response) {
        return {
          success: false,
          status: error.response.status,
          data: error.response.data,
          error: error.message,
        };
      }
      return { success: false, error: error.message };
    }
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
    const auth = skipAuth ? { headers: {}, params: {} } : await this.resolveAuth(name, env);

    let response;
    try {
      response = await axios.get(url, {
        headers: { ...this.config.headers, ...auth.headers },
        params: auth.params,
        timeout: this.config.timeout,
        httpsAgent: this.getHttpsAgent(env, url),
      });
    } catch (error) {
      throw new Error(`Failed to fetch Swagger documentation from ${url}: ${error.message}`);
    }

    this.swaggerCache.set(name, { doc: response.data, fetchedAt: Date.now() });
    return response.data;
  }

  // Recursively inline $ref pointers (with cycle protection).
  resolveRefs(node, doc, seen = new Set()) {
    if (!node || typeof node !== 'object') return node;

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
      return this.resolveRefs(target, doc, next);
    }

    if (Array.isArray(node)) return node.map((n) => this.resolveRefs(n, doc, seen));

    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = this.resolveRefs(v, doc, seen);
    return out;
  }

  setupToolHandlers() {
    const envEnum = this.envNames();
    const environmentProp = {
      type: 'string',
      description: 'Environment name (defaults to the active environment)',
      enum: envEnum,
    };
    const urlProp = {
      type: 'string',
      description:
        'API URL — absolute (https://host/path) or relative to the environment baseUrl (e.g. /users)',
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
    const methodEnum = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'api_get',
          description: 'GET request to an API endpoint',
          inputSchema: {
            type: 'object',
            properties: {
              url: urlProp,
              params: paramsProp,
              headers: headersProp,
              environment: environmentProp,
              maxChars: maxCharsProp,
            },
            required: ['url'],
          },
        },
        {
          name: 'api_post',
          description: 'POST request to an API endpoint',
          inputSchema: {
            type: 'object',
            properties: {
              url: urlProp,
              data: dataProp,
              params: paramsProp,
              headers: headersProp,
              environment: environmentProp,
              maxChars: maxCharsProp,
            },
            required: ['url', 'data'],
          },
        },
        {
          name: 'api_put',
          description: 'PUT request to an API endpoint',
          inputSchema: {
            type: 'object',
            properties: {
              url: urlProp,
              data: dataProp,
              params: paramsProp,
              headers: headersProp,
              environment: environmentProp,
              maxChars: maxCharsProp,
            },
            required: ['url', 'data'],
          },
        },
        {
          name: 'api_delete',
          description: 'DELETE request to an API endpoint',
          inputSchema: {
            type: 'object',
            properties: {
              url: urlProp,
              data: dataProp,
              params: paramsProp,
              headers: headersProp,
              environment: environmentProp,
              maxChars: maxCharsProp,
            },
            required: ['url'],
          },
        },
        {
          name: 'api_patch',
          description: 'PATCH request to an API endpoint',
          inputSchema: {
            type: 'object',
            properties: {
              url: urlProp,
              data: dataProp,
              params: paramsProp,
              headers: headersProp,
              environment: environmentProp,
              maxChars: maxCharsProp,
            },
            required: ['url', 'data'],
          },
        },
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
              method: { type: 'string', description: 'Filter by HTTP method', enum: methodEnum },
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
              method: { type: 'string', description: 'HTTP method', enum: methodEnum },
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
      ],
    }));

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
    const limit = maxChars ?? this.config.maxResponseChars ?? 0;
    if (limit > 0 && text.length > limit) {
      const dropped = text.length - limit;
      text =
        text.slice(0, limit) +
        `\n\n... [truncated ${dropped} of ${text.length} chars. ` +
        `Pass maxChars:0 for the full output, or narrow the request.]`;
    }
    return { content: [{ type: 'text', text }] };
  }

  async handleInspectLogin(args) {
    const { name, env } = this.getEnv(args.environment);
    const auth = env.auth || {};

    const loginPath = args.loginUrl || auth.loginUrl;
    const discovered = !loginPath;
    const loginUrl = this.resolveUrl(env, loginPath || (await this.discoverLoginUrl(name, env)));
    const credentials = args.credentials || auth.credentials || {};

    let resp;
    let ok = true;
    try {
      resp = await axios({
        method: auth.method || 'POST',
        url: loginUrl,
        data: credentials,
        headers: { ...this.config.headers, ...(auth.headers || {}) },
        timeout: this.config.timeout,
        httpsAgent: this.getHttpsAgent(env, loginUrl),
      });
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
        response: resp.data,
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
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) continue;
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
