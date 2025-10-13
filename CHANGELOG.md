# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
