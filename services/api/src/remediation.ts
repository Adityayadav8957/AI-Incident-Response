const DEMO_APP_URL = process.env.DEMO_APP_URL ?? "http://localhost:3300";
const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL ?? "http://localhost:9200";

export interface RemediationResult {
  success: boolean;
  detail: string;
}

export interface RemediationAction {
  id: string;
  description: string;
  execute: () => Promise<RemediationResult>;
}

// Deliberately a small, explicit allow-list -- the agent can only ever reference
// one of these ids (enforced by the tool schema's enum), never free-form commands.
const ACTIONS: Record<string, RemediationAction> = {
  disable_bug_mode: {
    id: "disable_bug_mode",
    description: "Disable bug mode on the demo checkout app",
    execute: async () => {
      const res = await fetch(`${DEMO_APP_URL}/admin/bug-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      if (!res.ok) {
        return { success: false, detail: `demo-app responded ${res.status}` };
      }
      const body = (await res.json()) as { bugMode: boolean };
      return {
        success: !body.bugMode,
        detail: `bugMode is now ${body.bugMode}`,
      };
    },
  },
};

export function getRemediationAction(id: string | undefined): RemediationAction | undefined {
  if (!id) return undefined;
  return ACTIONS[id];
}

/**
 * Re-checks the actual error rate right before executing, rather than trusting
 * that conditions from when the report was generated still hold -- an approval
 * clicked minutes later could be acting on a situation that already resolved
 * itself. If the check itself fails, we err on the side of proceeding rather
 * than silently blocking a real fix on a flaky observability query.
 */
export async function isIncidentStillActive(lookbackMinutes = 2): Promise<boolean> {
  const res = await fetch(`${ELASTICSEARCH_URL}/filebeat-8.15.0/_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: 50,
      sort: [{ "@timestamp": "desc" }],
      query: {
        bool: {
          filter: [
            { range: { "@timestamp": { gte: `now-${lookbackMinutes}m` } } },
            { match: { "container.name": "ai_incident-demo-app-1" } },
          ],
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Elasticsearch query failed: ${res.status}`);
  }

  const body = (await res.json()) as {
    hits: { hits: { _source: Record<string, unknown> }[] };
  };
  const entries = body.hits.hits;
  if (entries.length === 0) return false;

  const errorCount = entries.filter((h) => h._source.level === "error").length;
  return errorCount / entries.length > 0.1;
}
