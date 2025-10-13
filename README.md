# .NET Core API MCP Server

[![npm version](https://badge.fury.io/js/dotnet-api-mcp.svg)](https://badge.fury.io/js/dotnet-api-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that enables Claude AI to interact with .NET Core APIs through CRUD operations and Swagger/OpenAPI integration.

## Features

- HTTP Methods Support (GET, POST, PUT, DELETE, PATCH)
- Swagger/OpenAPI Integration
- Multi-environment Configuration (local, development, beta, production)
- Automatic Endpoint Discovery
- Model/Schema Tracking
- Dynamic Query Parameters
- Authentication Support
- Configurable Timeouts & Headers

## Installation

### NPM Installation

```bash
npm install dotnet-api-mcp
```

### Global Installation

```bash
npm install -g dotnet-api-mcp
```

## Configuration

### 1. Create Configuration File

Create a `config.json` file in your project root:

```bash
cp node_modules/dotnet-api-mcp/config.example.json config.json
```

Or create manually:

```json
{
  "environments": {
    "local": {
      "baseUrl": "https://localhost:7000/api",
      "swaggerUrl": "https://localhost:7000/swagger/v1/swagger.json",
      "auth": {
        "email": "your-email@example.com",
        "password": "your-password"
      }
    },
    "beta": {
      "baseUrl": "https://beta-api.example.com/api",
      "swaggerUrl": "https://beta-api.example.com/swagger/v1/swagger.json",
      "auth": {
        "email": "your-email@example.com",
        "password": "your-password"
      }
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

### 2. Claude Desktop Integration

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dotnet-api": {
      "command": "npx",
      "args": ["-y", "dotnet-api-mcp"],
      "env": {}
    }
  }
}
```

### 3. Claude Code (VSCode) Integration

Add to your project's `claude-code-config.json`:

```json
{
  "mcpServers": {
    "dotnet-api": {
      "command": "node",
      "args": ["./node_modules/dotnet-api-mcp/src/index.js"],
      "env": {}
    }
  }
}
```

### 4. claude.ai (Web) Integration

1. Go to claude.ai
2. Click on "Connect" or "Settings"
3. Add MCP Server with:
   - Command: `npx`
   - Args: `-y dotnet-api-mcp`

## Available Tools

### HTTP Request Tools

#### `api_get`
Make GET requests to your API
```javascript
// List all users
api_get("/users")

// Get user by ID with params
api_get("/users/123", { include: "profile" })
```

#### `api_post`
Make POST requests to create resources
```javascript
api_post("/users", {
  "name": "John Doe",
  "email": "john@example.com"
})
```

#### `api_put`
Make PUT requests to update resources
```javascript
api_put("/users/123", {
  "name": "Jane Doe",
  "email": "jane@example.com"
})
```

#### `api_delete`
Make DELETE requests
```javascript
api_delete("/users/123")
```

#### `api_patch`
Make PATCH requests for partial updates
```javascript
api_patch("/users/123", {
  "email": "newemail@example.com"
})
```

### Swagger/OpenAPI Tools

#### `swagger_fetch`
Fetch Swagger/OpenAPI documentation
```javascript
swagger_fetch({ environment: "beta" })
```

#### `swagger_list_endpoints`
List all API endpoints
```javascript
// List all endpoints
swagger_list_endpoints()

// Filter by tag
swagger_list_endpoints({ tag: "User" })

// Filter by method
swagger_list_endpoints({ method: "POST" })
```

#### `swagger_get_endpoint`
Get detailed information about a specific endpoint
```javascript
swagger_get_endpoint({
  path: "/api/users/{id}",
  method: "GET"
})
```

#### `swagger_get_schema`
Get model/schema definition from Swagger
```javascript
swagger_get_schema({ schemaName: "UserDto" })
```

## Usage Examples

### With Claude Desktop

```
You: "Fetch the Swagger documentation for my API"
Claude: [Uses swagger_fetch tool]

You: "List all users from the beta environment"
Claude: [Uses api_get with /users endpoint]

You: "Create a new product with name 'Laptop' and price 999"
Claude: [Uses api_post with /products endpoint]
```

### Programmatic Usage

```javascript
import { spawn } from 'child_process';

const mcp = spawn('node', ['node_modules/dotnet-api-mcp/src/index.js']);

// MCP server is now running and can receive requests
```

## Environment Management

Switch between environments by updating `activeEnvironment` in `config.json`:

```json
{
  "activeEnvironment": "beta"
}
```

Or define multiple environments and switch as needed.

## Development

### Running Locally

```bash
git clone https://github.com/sametbrr/dotnet-api-mcp.git
cd dotnet-api-mcp
npm install
npm start
```

### Development Mode (with auto-reload)

```bash
npm run dev
```

## Troubleshooting

### Connection Issues
- Verify your API URL in `config.json`
- Check if API accepts CORS requests
- Ensure SSL certificates are valid

### Authentication Errors
- Update auth credentials in `config.json`
- Check if API requires token-based auth

### Swagger Not Loading
- Verify `swaggerUrl` is accessible
- Ensure Swagger JSON endpoint is exposed

## Requirements

- Node.js >= 18.0.0
- .NET Core API with Swagger/OpenAPI support

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Author

Samet Birer

## Links

- [GitHub Repository](https://github.com/sametbrr/dotnet-api-mcp)
- [NPM Package](https://www.npmjs.com/package/dotnet-api-mcp)
- [Report Issues](https://github.com/sametbrr/dotnet-api-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)
