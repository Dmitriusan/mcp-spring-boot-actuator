# Install mcp-spring-boot-actuator via Cline

Run in Cline terminal:

```bash
npx -y mcp-spring-boot-actuator
```

# Configuration

No environment variables required. Provide Actuator endpoint URLs inline when prompting (e.g., `http://localhost:8080/actuator/health`).

Add to your MCP client config:

```json
{
  "mcpServers": {
    "spring-boot-actuator": {
      "command": "npx",
      "args": ["-y", "mcp-spring-boot-actuator"]
    }
  }
}
```
