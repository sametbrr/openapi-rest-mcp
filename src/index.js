#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import https from 'https';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DotNetApiMcpServer {
  constructor() {
    this.server = new Server(
      {
        name: 'dotnet-api-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.config = this.loadConfig();
    this.authToken = null;
    this.tokenExpiry = null;
    this.setupToolHandlers();
  }

  loadConfig() {
    try {
      const configPath = join(__dirname, '..', 'config.json');
      const configData = readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);

      // Set active environment's baseUrl
      if (config.environments && config.activeEnvironment) {
        const activeEnv = config.environments[config.activeEnvironment];
        if (activeEnv) {
          config.baseUrl = activeEnv.baseUrl;
          config.swaggerUrl = activeEnv.swaggerUrl;
        }
      }

      return config;
    } catch (error) {
      console.error('Error loading config.json:', error);
    }
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'api_get',
            description: 'GET request to any API endpoint',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'Full API URL (e.g., https://api.example.com/users)'
                },
                params: {
                  type: 'object',
                  description: 'Query parameters',
                  additionalProperties: true
                },
                headers: {
                  type: 'object',
                  description: 'Custom headers',
                  additionalProperties: true
                }
              },
              required: ['url']
            }
          },
          {
            name: 'api_post',
            description: 'POST request to any API endpoint',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'Full API URL'
                },
                data: {
                  type: 'object',
                  description: 'Request body data',
                  additionalProperties: true
                },
                headers: {
                  type: 'object',
                  description: 'Custom headers',
                  additionalProperties: true
                }
              },
              required: ['url', 'data']
            }
          },
          {
            name: 'api_put',
            description: 'PUT request to any API endpoint',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'Full API URL'
                },
                data: {
                  type: 'object',
                  description: 'Request body data',
                  additionalProperties: true
                },
                headers: {
                  type: 'object',
                  description: 'Custom headers',
                  additionalProperties: true
                }
              },
              required: ['url', 'data']
            }
          },
          {
            name: 'api_delete',
            description: 'DELETE request to any API endpoint',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'Full API URL'
                },
                headers: {
                  type: 'object',
                  description: 'Custom headers',
                  additionalProperties: true
                }
              },
              required: ['url']
            }
          },
          {
            name: 'api_patch',
            description: 'PATCH request to any API endpoint',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'Full API URL'
                },
                data: {
                  type: 'object',
                  description: 'Request body data',
                  additionalProperties: true
                },
                headers: {
                  type: 'object',
                  description: 'Custom headers',
                  additionalProperties: true
                }
              },
              required: ['url', 'data']
            }
          },
          {
            name: 'swagger_fetch',
            description: 'Fetch and parse Swagger/OpenAPI documentation from configured environment',
            inputSchema: {
              type: 'object',
              properties: {
                environment: {
                  type: 'string',
                  description: 'Environment name (local, beta) - defaults to active environment',
                  enum: ['local', 'beta']
                }
              }
            }
          },
          {
            name: 'swagger_list_endpoints',
            description: 'List all available API endpoints from Swagger documentation',
            inputSchema: {
              type: 'object',
              properties: {
                environment: {
                  type: 'string',
                  description: 'Environment name (local, beta) - defaults to active environment',
                  enum: ['local', 'beta']
                },
                tag: {
                  type: 'string',
                  description: 'Filter endpoints by tag/controller name'
                },
                method: {
                  type: 'string',
                  description: 'Filter by HTTP method',
                  enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
                }
              }
            }
          },
          {
            name: 'swagger_get_endpoint',
            description: 'Get detailed information about a specific endpoint from Swagger',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'API endpoint path (e.g., /api/users/{id})'
                },
                method: {
                  type: 'string',
                  description: 'HTTP method',
                  enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
                },
                environment: {
                  type: 'string',
                  description: 'Environment name (local, beta) - defaults to active environment',
                  enum: ['local', 'beta']
                }
              },
              required: ['path', 'method']
            }
          },
          {
            name: 'swagger_get_schema',
            description: 'Get schema/model definition from Swagger documentation',
            inputSchema: {
              type: 'object',
              properties: {
                schemaName: {
                  type: 'string',
                  description: 'Name of the schema/model (e.g., UserDto, CreateUserRequest)'
                },
                environment: {
                  type: 'string',
                  description: 'Environment name (local, beta) - defaults to active environment',
                  enum: ['local', 'beta']
                }
              },
              required: ['schemaName']
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'api_get':
            return await this.handleGet(args);
          case 'api_post':
            return await this.handlePost(args);
          case 'api_put':
            return await this.handlePut(args);
          case 'api_delete':
            return await this.handleDelete(args);
          case 'api_patch':
            return await this.handlePatch(args);
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
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }

  async makeRequest(method, url, data = null, params = null, customHeaders = null) {
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false
    });

    const config = {
      method,
      url,
      headers: { ...this.config.headers, ...customHeaders },
      timeout: this.config.timeout,
      httpsAgent
    };

    if (data) {
      config.data = data;
    }

    if (params) {
      config.params = params;
    }

    try {
      const response = await axios(config);
      return {
        success: true,
        status: response.status,
        data: response.data,
        headers: response.headers
      };
    } catch (error) {
      if (error.response) {
        return {
          success: false,
          status: error.response.status,
          data: error.response.data,
          error: error.message
        };
      }
      throw error;
    }
  }

  async handleGet(args) {
    const result = await this.makeRequest('GET', args.url, null, args.params, args.headers);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  async handlePost(args) {
    const result = await this.makeRequest('POST', args.url, args.data, null, args.headers);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  async handlePut(args) {
    const result = await this.makeRequest('PUT', args.url, args.data, null, args.headers);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  async handleDelete(args) {
    const result = await this.makeRequest('DELETE', args.url, null, null, args.headers);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  async handlePatch(args) {
    const result = await this.makeRequest('PATCH', args.url, args.data, null, args.headers);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  async fetchSwaggerDoc(environment = null) {
    const env = environment || this.config.activeEnvironment;
    const swaggerUrl = this.config.environments[env]?.swaggerUrl;

    if (!swaggerUrl) {
      throw new Error(`Swagger URL not configured for environment: ${env}`);
    }

    const httpsAgent = new https.Agent({
      rejectUnauthorized: false
    });

    try {
      const response = await axios.get(swaggerUrl, {
        timeout: this.config.timeout,
        httpsAgent
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch Swagger documentation: ${error.message}`);
    }
  }

  async handleSwaggerFetch(args) {
    try {
      const swaggerDoc = await this.fetchSwaggerDoc(args.environment);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              info: swaggerDoc.info,
              host: swaggerDoc.host,
              basePath: swaggerDoc.basePath,
              schemes: swaggerDoc.schemes,
              totalPaths: Object.keys(swaggerDoc.paths || {}).length,
              totalSchemas: Object.keys(swaggerDoc.components?.schemas || swaggerDoc.definitions || {}).length
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching Swagger: ${error.message}`
          }
        ]
      };
    }
  }

  async handleSwaggerListEndpoints(args) {
    try {
      const swaggerDoc = await this.fetchSwaggerDoc(args.environment);
      const paths = swaggerDoc.paths || {};
      const endpoints = [];

      for (const [path, methods] of Object.entries(paths)) {
        for (const [method, details] of Object.entries(methods)) {
          if (['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
            // Filter by tag if specified
            if (args.tag && !details.tags?.includes(args.tag)) {
              continue;
            }

            // Filter by method if specified
            if (args.method && method.toUpperCase() !== args.method.toUpperCase()) {
              continue;
            }

            endpoints.push({
              path,
              method: method.toUpperCase(),
              summary: details.summary || '',
              description: details.description || '',
              tags: details.tags || [],
              operationId: details.operationId || ''
            });
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              totalEndpoints: endpoints.length,
              endpoints
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing endpoints: ${error.message}`
          }
        ]
      };
    }
  }

  async handleSwaggerGetEndpoint(args) {
    try {
      const swaggerDoc = await this.fetchSwaggerDoc(args.environment);
      const paths = swaggerDoc.paths || {};
      const method = args.method.toLowerCase();

      if (!paths[args.path] || !paths[args.path][method]) {
        throw new Error(`Endpoint not found: ${args.method} ${args.path}`);
      }

      const endpoint = paths[args.path][method];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
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
              security: endpoint.security || []
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting endpoint: ${error.message}`
          }
        ]
      };
    }
  }

  async handleSwaggerGetSchema(args) {
    try {
      const swaggerDoc = await this.fetchSwaggerDoc(args.environment);
      const schemas = swaggerDoc.components?.schemas || swaggerDoc.definitions || {};

      if (!schemas[args.schemaName]) {
        throw new Error(`Schema not found: ${args.schemaName}`);
      }

      const schema = schemas[args.schemaName];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              schemaName: args.schemaName,
              schema
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting schema: ${error.message}`
          }
        ]
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('DotNet API MCP server running on stdio');
  }
}

const server = new DotNetApiMcpServer();
server.run().catch(console.error);