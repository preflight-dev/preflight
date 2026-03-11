import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolve, basename } from "path";
import { PROJECT_DIR } from "../lib/files.js";
import { getRelatedProjects } from "../lib/config.js";
import { loadAllContracts, searchContracts } from "../lib/contracts.js";

export function registerSearchContracts(server: McpServer): void {
  server.tool(
    "search_contracts",
    "Search API contracts, types, and schemas across current and related projects. Fast lookup without vector search.",
    {
      query: z.string().describe("What to search for"),
      scope: z.enum(["current", "related", "all"]).default("all").describe("Which projects to search"),
      kind: z.enum(["interface", "type", "enum", "route", "schema", "event", "model", "all"]).default("all").describe("Filter by contract kind"),
    },
    async ({ query, scope, kind }) => {
      try {
      const projectDirs: string[] = [];

      if (scope === "current" || scope === "all") {
        projectDirs.push(resolve(PROJECT_DIR));
      }
      if (scope === "related" || scope === "all") {
        projectDirs.push(...getRelatedProjects());
      }

      if (projectDirs.length === 0) {
        return { content: [{ type: "text" as const, text: "No projects configured. Run onboard_project first." }] };
      }

      let contracts = loadAllContracts(projectDirs);

      // Filter by kind
      if (kind !== "all") {
        contracts = contracts.filter(c => c.kind === kind);
      }

      // Search
      const results = searchContracts(query, contracts);

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No contracts matching "${query}" found across ${projectDirs.length} project(s).` }] };
      }

      const output = [
        `## Contract Search: "${query}"`,
        `Found ${results.length} matching contract(s):\n`,
        ...results.slice(0, 20).map(c => {
          const proj = basename(c.project);
          return `### ${c.kind} \`${c.name}\` (${proj})\nFile: \`${c.file}\`\n\`\`\`\n${c.definition}\n\`\`\``;
        }),
      ];

      if (results.length > 20) {
        output.push(`\n...and ${results.length - 20} more. Narrow your query or filter by kind.`);
      }

      return { content: [{ type: "text" as const, text: output.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `❌ search_contracts failed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );
}
