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

## Quick Start Guide

### Step 1: Choose Your Platform

#### Option A: Claude Desktop

**Install the package:**
```bash
npm install -g dotnet-api-mcp
```

**Configure Claude Desktop:**

1. Open your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the MCP server configuration:
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

3. Restart Claude Desktop

#### Option B: Claude Code (VSCode)

**Step 1.1: Install the package in your project:**
```bash
npm install dotnet-api-mcp
```

**Step 1.2: Add MCP server to Claude Code:**
```bash
claude mcp add dotnet-api-mcp dotnet-api-mcp
```

**Step 1.3: Restart VSCode**

### Step 2: Create Configuration File

Create a `config.json` file in your **project root directory** (where package.json is located):

**Option 1 - Copy from example:**
```bash
cp node_modules/dotnet-api-mcp/config.example.json config.json
```

**Option 2 - Create manually:**

Create `config.json` with the following structure:

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

### Step 3: Configure Your API Settings

Update `config.json` with your actual API information:

#### Required Fields:

1. **baseUrl**: Your API base URL
   ```json
   "baseUrl": "https://localhost:7000/api"
   ```
   ⚠️ **Warning**: If missing, API requests will fail with "No base URL configured"

2. **swaggerUrl**: Your Swagger/OpenAPI documentation URL
   ```json
   "swaggerUrl": "https://localhost:7000/swagger/v1/swagger.json"
   ```
   ⚠️ **Warning**: If missing, Swagger tools won't work

#### Optional Fields:

3. **auth** (if your API requires authentication):
   ```json
   "auth": {
     "email": "your-email@example.com",
     "password": "your-password"
   }
   ```
   ℹ️ **Info**: You can omit this section if your API doesn't require authentication

4. **timeout** (default: 30000ms):
   ```json
   "timeout": 30000
   ```
   ℹ️ **Info**: Increase if your API responses are slow

5. **headers** (custom HTTP headers):
   ```json
   "headers": {
     "Content-Type": "application/json",
     "Accept": "application/json"
   }
   ```
   ℹ️ **Info**: Add any custom headers your API requires

### Step 4: Add Multiple Environments (Optional)

You can configure multiple environments for different stages:

```json
{
  "environments": {
    "local": {
      "baseUrl": "https://localhost:7000/api",
      "swaggerUrl": "https://localhost:7000/swagger/v1/swagger.json"
    },
    "development": {
      "baseUrl": "https://dev-api.example.com/api",
      "swaggerUrl": "https://dev-api.example.com/swagger/v1/swagger.json"
    },
    "beta": {
      "baseUrl": "https://beta-api.example.com/api",
      "swaggerUrl": "https://beta-api.example.com/swagger/v1/swagger.json"
    },
    "production": {
      "baseUrl": "https://api.example.com/api",
      "swaggerUrl": "https://api.example.com/swagger/v1/swagger.json"
    }
  },
  "activeEnvironment": "local"
}
```

⚠️ **Warning**: Always set `activeEnvironment` to specify which environment to use.

### Step 5: Verify Installation

Ask Claude to test the connection:

```
"Fetch the Swagger documentation from my API"
```

If successful, you'll see the API endpoints. If not, check these common issues:

**Common Issues:**

| Error | Solution |
|-------|----------|
| "Cannot find config.json" | Ensure `config.json` is in your project root |
| "No base URL configured" | Add `baseUrl` to your environment config |
| "Connection refused" | Check if your API is running |
| "Swagger not found" | Verify `swaggerUrl` is correct and accessible |
| "Authentication failed" | Check your `auth` credentials |

## Configuration Reference

### Complete config.json Example

```json
{
  "environments": {
    "local": {
      "baseUrl": "https://localhost:7000/api",
      "swaggerUrl": "https://localhost:7000/swagger/v1/swagger.json",
      "auth": {
        "email": "user@example.com",
        "password": "password123"
      }
    }
  },
  "activeEnvironment": "local",
  "timeout": 30000,
  "headers": {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-Custom-Header": "custom-value"
  }
}
```

### Environment Switching

To switch between environments, update `activeEnvironment`:

```json
{
  "activeEnvironment": "production"
}
```

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
