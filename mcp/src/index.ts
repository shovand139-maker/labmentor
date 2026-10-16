#!/usr/bin/env node
/**
 * LabMentor MCP server over stdio.
 *
 *   LABMENTOR_URL=https://labmentor.example LABMENTOR_TOKEN=<instructor token> labmentor-mcp
 *
 * Create a token with `npm run token -- --email priya.nair@contoso.example` in web/.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LabMentorApi } from "./api.js";
import { createServer } from "./server.js";

const url = process.env.LABMENTOR_URL ?? "http://localhost:3000";
const token = process.env.LABMENTOR_TOKEN;
if (!token) {
  console.error("Set LABMENTOR_TOKEN to an instructor token (see web/scripts/token.ts).");
  process.exit(1);
}

await createServer(new LabMentorApi(url, token)).connect(new StdioServerTransport());
