[![npm version](https://badge.fury.io/js/openapi-rest-mcp.svg)](https://badge.fury.io/js/openapi-rest-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# OpenAPI REST MCP Server

A Model Context Protocol (MCP) server that lets Claude AI talk to **any OpenAPI/Swagger REST API** through CRUD operations — works with .NET, Node, Spring, FastAPI and more. Flexible per-environment authentication (including zero-config auto-login), `${ENV_VAR}` secret injection, fuzzy endpoint search, and `$ref`-inlined schema discovery.

> 🇹🇷 Türkçe için [README.tr.md](README.tr.md)

---

## Quick Start

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{ "mcpServers": { "openapi-rest": { "command": "npx", "args": ["-y", "openapi-rest-mcp", "--config", "/path/to/config.json"] } } }
```

**Claude Code:**
```bash
npm install openapi-rest-mcp
claude mcp add openapi-rest openapi-rest-mcp -- --config /absolute/path/to/config.json
```

Then copy and fill in `config.json` — see **Configuration** below.

---

## Features

- HTTP methods: GET, POST, PUT, DELETE, PATCH
- Swagger/OpenAPI integration with `$ref` inlining
- Multiple named environments (local, development, beta, production, …)
- Endpoint discovery, **fuzzy keyword search**, and schema retrieval from Swagger
- Flexible auth per environment: `none`, `bearer`, `apiKey`, `basic`, `login`
- **Zero-config `login`**: auto-discovers the login endpoint and auto-detects the token in the response
- `inspect_login` tool to discover the right token path without guessing
- **Response truncation** (`maxResponseChars` / per-call `maxChars`) to protect the context window
- `${ENV_VAR}` substitution — keep secrets out of `config.json`
- Configurable config path (`--config`, `OPENAPI_MCP_CONFIG`)
- Per-environment TLS control and Swagger response caching

---

## Requirements

- Node.js >= 18.0.0
- Any REST API with an OpenAPI/Swagger JSON endpoint (.NET, Node, Spring, FastAPI, …)

---

## Installation

```bash
npm install -g openapi-rest-mcp   # global — for Claude Desktop
npm install openapi-rest-mcp      # local  — for Claude Code projects
```

---

## Configuration

Copy the example and edit it:

```bash
cp node_modules/openapi-rest-mcp/config.example.json config.json
```

Minimal `config.json`:

```json
{
  "environments": {
    "local": {
      "baseUrl": "https://localhost:7000/api",
      "swaggerUrl": "https://localhost:7000/swagger/v1/swagger.json"
    }
  },
  "activeEnvironment": "local",
  "timeout": 30000,
  "headers": {
    "Content-Type": "application/json",
    "Accept": "application/json"
  }
}
```

### Config file resolution order

1. `--config <path>` / `-c <path>` — CLI flag
2. `OPENAPI_MCP_CONFIG` — environment variable (`DOTNET_API_CONFIG` also accepted)
3. `./config.json` — current working directory

```bash
openapi-rest-mcp --config /etc/openapi-mcp/config.json
OPENAPI_MCP_CONFIG=/etc/openapi-mcp/config.json openapi-rest-mcp
```

### First-run setup

No config yet? The server **still starts** — it won't crash. Configure it with the built-in tools (Claude calls them automatically):

- **`config_init`** — writes a starter `config.json` at the resolved path (or a custom `path`).
- **`config_status`** — reports the resolved path, whether it loaded, and the active environment.

After you create/edit `config.json` it's picked up automatically on the next tool call — no restart needed. Keep secrets out of the file with `${ENV_VAR}` placeholders.

### Config field reference

| Field | Scope | Default | Description |
|---|---|---|---|
| `environments` | root | — | Map of named environments (required) |
| `activeEnvironment` | root | — | Default environment to use (required) |
| `timeout` | root | `30000` | Request timeout in ms |
| `swaggerCacheTtl` | root | `300` | Seconds to cache Swagger docs |
| `maxResponseChars` | root | `100000` | Max chars per tool response (`0` = unlimited; override per call with `maxChars`) |
| `headers` | root | JSON defaults | Headers merged into every request |
| `rejectUnauthorized` | root / env | `true` (auto-`false` for localhost) | TLS verification |
| `maxRedirects` | root | `0` | HTTP redirects to follow (`0` = none, avoids leaking auth across hosts) |
| `maxContentLength` | root | `10485760` | Max response/request bytes (DoS guard) |
| `baseUrl` | env | — | Base URL for relative paths |
| `swaggerUrl` | env | — | Swagger/OpenAPI JSON URL |
| `auth` | env | none | Authentication block (see below) |

Any string value may contain `${ENV_VAR}` placeholders, replaced with the matching environment variable at load time.

---

## Authentication

Auth is configured **per environment** via an `auth` object with a `type`. Omit the `auth` block entirely if your API is public.

**`bearer`** — static bearer token:
```json
"auth": { "type": "bearer", "token": "${API_TOKEN}" }
```

**`apiKey`** — API key in a header or query:
```json
"auth": { "type": "apiKey", "in": "header", "headerName": "X-Api-Key", "value": "${API_KEY}" }
```

**`basic`** — HTTP basic auth:
```json
"auth": { "type": "basic", "username": "${API_USER}", "password": "${API_PASS}" }
```

**`login`** — POST credentials, then reuse the returned token (cached and refreshed automatically).

`loginUrl`, `tokenPath` and the expiry fields are all **optional** — when omitted, the server auto-discovers the login endpoint from the Swagger spec and auto-detects the token in the response.

Zero-config (auto):
```json
"auth": {
  "type": "login",
  "credentials": { "email": "${API_USER}", "password": "${API_PASS}" }
}
```

Explicit (manual):
```json
"auth": {
  "type": "login",
  "loginUrl": "https://api.example.com/api/auth/login",
  "credentials": { "email": "${API_USER}", "password": "${API_PASS}" },
  "tokenPath": "data.accessToken",
  "expiresInPath": "data.expiresIn",
  "headerName": "Authorization",
  "headerPrefix": "Bearer "
}
```

> **Tip:** if auto-detection picks the wrong token, run the `inspect_login` tool — it posts your credentials and returns the raw response plus suggested `tokenPath` values.

| `login` field | Required | Description |
|---|---|---|
| `credentials` | recommended | Body posted to the login endpoint |
| `loginUrl` | optional | Login endpoint; auto-discovered from Swagger if omitted |
| `tokenPath` | optional | Dot-path to the token; auto-detected if omitted |
| `expiresIn` / `expiresInPath` | optional | Token lifetime (seconds / response path); auto-detected if omitted |
| `headerName` / `headerPrefix` | optional | Defaults to `Authorization` / `Bearer ` |
| `method` / `headers` | optional | Login request method (default `POST`) and extra headers |

> **Migrating from 1.x:** the old flat `auth: { email, password }` is no longer supported. Move those values into an `auth` object — most APIs map to `type: "login"` or `type: "basic"`.

---

## Multiple environments

Define as many environments as you need and switch via `activeEnvironment` (or pass `environment` to any tool).

```json
{
  "environments": {
    "local":       { "baseUrl": "https://localhost:7000/api", "swaggerUrl": "https://localhost:7000/swagger/v1/swagger.json" },
    "development": { "baseUrl": "https://dev-api.example.com/api", "swaggerUrl": "https://dev-api.example.com/swagger/v1/swagger.json" },
    "beta":        { "baseUrl": "https://beta-api.example.com/api", "swaggerUrl": "https://beta-api.example.com/swagger/v1/swagger.json" },
    "production":  {
      "baseUrl": "https://api.example.com/api",
      "swaggerUrl": "https://api.example.com/swagger/v1/swagger.json",
      "rejectUnauthorized": true,
      "auth": { "type": "bearer", "token": "${PROD_API_TOKEN}" }
    }
  },
  "activeEnvironment": "local"
}
```

---

## Security

The server holds API credentials and forwards them on the model's behalf:

- **Host allowlist:** auth tokens are attached **only** when the target host matches the environment's `baseUrl`/`swaggerUrl`/`loginUrl`. Calls to unrelated absolute URLs are sent **without** credentials.
- **No redirects by default** (`maxRedirects: 0`) so auth can't be carried to another host; set `maxRedirects` in config to opt in.
- **`inspect_login` masks** token/password values in its output; **`config_init`** only writes inside the project/config directory; **response headers** are omitted unless you pass `includeHeaders: true`.
- Keep secrets in `${ENV_VAR}` placeholders, not literals; `config.json` is git-ignored.

---

## Usage

URLs can be absolute (`https://host/path`) or relative to the environment's `baseUrl` (e.g. `/users`). Every tool also accepts `environment` (override the active one) and `maxChars` (`0` = unlimited). `api_*` tools also accept `includeHeaders`.

| Tool | Description |
|---|---|
| `api_get` | GET request |
| `api_post` | POST request (create) |
| `api_put` | PUT request (replace) |
| `api_delete` | DELETE request |
| `api_patch` | PATCH request (partial update) |
| `inspect_login` | Probe the login endpoint; return raw response + suggested token paths |
| `swagger_fetch` | Fetch & summarize Swagger doc |
| `swagger_list_endpoints` | List endpoints (`search` keyword, `tag`/`method` filters, `limit`) |
| `swagger_get_endpoint` | Endpoint detail with `$ref` inlining |
| `swagger_get_schema` | Schema/model definition |
| `config_status` | Where config is looked for + whether it loaded |
| `config_init` | Write a starter `config.json` (`path`, `force`) |

Examples:

```javascript
api_get("/users", { include: "profile" })
api_post("/users", { name: "John Doe", email: "john@example.com" })
api_put("/users/123", { name: "Jane Doe" })
api_delete("/users/123")
api_patch("/users/123", { email: "new@example.com" })
api_get("/reports/huge", {}, { maxChars: 0 })   // unlimited

inspect_login({ environment: "local" })
swagger_fetch({ environment: "beta" })
swagger_list_endpoints({ search: "order create", limit: 10 })
swagger_list_endpoints({ tag: "User", method: "POST" })
swagger_get_endpoint({ path: "/api/users/{id}", method: "GET" })
swagger_get_schema({ schemaName: "UserDto" })
```

---

## Verify installation

```bash
npx openapi-rest-mcp --version
npx openapi-rest-mcp --help
```

| Error | Solution |
|---|---|
| `No config found` | Run the `config_init` tool, then fill in `config.json` |
| `Relative URL requires a baseUrl` | Add `baseUrl` to the environment |
| `Failed to fetch Swagger` | Check `swaggerUrl` is reachable |
| `Login ... failed` | Check `loginUrl`, `credentials`, `tokenPath` |
| TLS / certificate errors | Set `rejectUnauthorized: false` for that environment |

---

## Development

```bash
git clone https://github.com/sametbrr/openapi-rest-mcp.git
cd openapi-rest-mcp
npm install
npm start          # run the server
npm run dev        # auto-reload
npm test           # mock-API smoke test
```

### Publishing

Pushing a `vX.Y.Z` git tag triggers the GitHub Actions workflow that publishes to npm and creates a GitHub Release. The tag must match the `version` in `package.json`, and an `NPM_TOKEN` repository secret must be set.

```bash
git tag v2.1.0
git push origin v2.1.0
```

---

## Author

Samet Birer

## Links

- [GitHub Repository](https://github.com/sametbrr/openapi-rest-mcp)
- [NPM Package](https://www.npmjs.com/package/openapi-rest-mcp)
- [Report Issues](https://github.com/sametbrr/openapi-rest-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)

---

## License

MIT — see [LICENSE](LICENSE).
