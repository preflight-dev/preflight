import { listIndexedProjects } from "./timeline-db.js";
import { getRelatedProjects } from "./config.js";
import type { SearchScope } from "../types.js";

/**
 * Resolve project directories based on search scope.
 * Shared by timeline, export-report, search-history, and other tools.
 */
export async function getSearchProjects(scope: SearchScope): Promise<string[]> {
  const currentProject = process.env.CLAUDE_PROJECT_DIR;

  switch (scope) {
    case "current":
      return currentProject ? [currentProject] : [];

    case "related": {
      const related = getRelatedProjects();
      return currentProject ? [currentProject, ...related] : related;
    }

    case "all": {
      const projects = await listIndexedProjects();
      return projects.map((p) => p.project);
    }

    default:
      return currentProject ? [currentProject] : [];
  }
}
