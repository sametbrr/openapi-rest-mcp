# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-05-29

> **Renamed** from `dotnet-api-mcp` to **`openapi-rest-mcp`** — the server has always been
> OpenAPI/Swagger-generic; the new name reflects that it works with any REST API (still
> .NET-friendly). The binary is now `openapi-rest-mcp` and the preferred config env var is
> `OPENAPI_MCP_CONFIG` (`DOTNET_API_CONFIG` is still accepted). The old package is deprecated
> on npm with a pointer here.

### Added
- **Login auto-discovery**: when `auth.type` is `login` and no `loginUrl` is set, the
  server scans the Swagger spec for a likely login endpoint (configured `loginUrl` still wins)
- **Token path auto-detection**: when no `tokenPath` is set, the token is auto-detected from
  the login response (common paths + recursive search, skipping refresh tokens)
- **Token lifetime auto-detection**: `expiresIn`/`expires_in`-style fields are picked up
  automatically when `expiresIn`/`expiresInPath` are not configured
- `inspect_login` tool: posts credentials and returns the raw response plus suggested token
  paths — for discovering the right `tokenPath` (and verifying the auto-discovered `loginUrl`)
- **Fuzzy endpoint search**: `swagger_list_endpoints` accepts `search` (ranked keyword match
  across path/summary/description/tags/operationId) and `limit`
- **Response truncation**: global `maxResponseChars` (default 100000) and a per-call `maxChars`
  argument on every tool (`0` = unlimited)

### Changed
- `loginUrl` and `tokenPath` are now optional (auto-resolved when omitted)
- Server class and `main()` are exported; `main()` only auto-runs as the entrypoint (enables tests)

## [2.0.0] - 2026-05-29

### Added
- Structured authentication with `auth.type`: `none`, `bearer`, `apiKey`, `basic`, `login`
- `login` auth flow: posts credentials, extracts the token via a configurable `tokenPath`,
  caches it, and refreshes it based on `expiresIn` / `expiresInPath`
- `${ENV_VAR}` substitution anywhere in `config.json` (keeps secrets out of the file)
- CLI flags: `--config`/`-c <path>`, `--version`/`-v`, `--help`/`-h`
- Config resolution order: `--config` → `DOTNET_API_CONFIG` env var → `./config.json`
- Per-environment and global `rejectUnauthorized` TLS control (auto-relaxed for localhost only)
- `swaggerCacheTtl` to control how long Swagger docs are cached (default 300s)
- `$ref` inlining for `swagger_get_endpoint` and `swagger_get_schema` (toggle with `resolveRefs`)
- Absolute-URL passthrough: tools accept full URLs or paths relative to `baseUrl`

### Changed
- **BREAKING**: auth configuration moved from flat `auth: { email, password }` to a typed
  `auth: { type, ... }` object. See README for the migration mapping.
- Swagger documents are now cached per environment instead of refetched on every call

### Fixed
- TLS verification is now opt-in per environment rather than disabled globally

## [1.0.0] - 2025-10-13

### Added
- Initial release of .NET Core API MCP Server
- HTTP Methods Support (GET, POST, PUT, DELETE, PATCH)
- Swagger/OpenAPI integration
- Multi-environment configuration (local, development, beta, production)
- Automatic endpoint discovery via Swagger
- Model/Schema tracking and retrieval
- Dynamic query parameters support
- Authentication support
- Configurable timeouts and headers
- `api_get` tool for GET requests
- `api_post` tool for POST requests
- `api_put` tool for PUT requests
- `api_delete` tool for DELETE requests
- `api_patch` tool for PATCH requests
- `swagger_fetch` tool to fetch Swagger documentation
- `swagger_list_endpoints` tool to list all API endpoints
- `swagger_get_endpoint` tool to get endpoint details
- `swagger_get_schema` tool to get model/schema definitions
- Comprehensive README with installation and usage instructions
- Example configuration file (config.example.json)
- MIT License
- NPM package configuration

### Documentation
- Added installation guide for Claude Desktop, Claude Code, and claude.ai
- Added usage examples for all available tools
- Added troubleshooting section
- Added contribution guidelines
