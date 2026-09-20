const DEMO_APP_URL = process.env.DEMO_APP_URL ?? "http://localhost:3300";
const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL ?? "http://localhost:9200";
const ELASTICSEARCH_INDEX = process.env.ELASTICSEARCH_INDEX ?? "filebeat-8.15.0";
const ELASTICSEARCH_API_KEY = process.env.ELASTICSEARCH_API_KEY;
const MONITORED_CONTAINER_NAME =
  process.env.MONITORED_CONTAINER_NAME ?? "ai_incident-demo-app-1";

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
 * Fraction of recent log entries at level "error" for the given container,
 * over the given lookback window. Returns 0 if there are no entries at all
 * (nothing to be alarmed about) rather than throwing or returning NaN.
 */
export async function getErrorRate(
  containerName: string,
  lookbackMinutes: number
): Promise<number> {
  const res = await fetch(`${ELASTICSEARCH_URL}/${ELASTICSEARCH_INDEX}/_search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ELASTICSEARCH_API_KEY ? { Authorization: `ApiKey ${ELASTICSEARCH_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      size: 50,
      sort: [{ "@timestamp": "desc" }],
      query: {
        bool: {
          filter: [
            { range: { "@timestamp": { gte: `now-${lookbackMinutes}m` } } },
            { match: { "container.name": containerName } },
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
  if (entries.length === 0) return 0;

  const errorCount = entries.filter((h) => h._source.level === "error").length;
  return errorCount / entries.length;
}

const ACTIVE_ERROR_RATE_THRESHOLD = 0.1;

/**
 * Re-checks the actual error rate right before executing, rather than trusting
 * that conditions from when the report was generated still hold -- an approval
 * clicked minutes later could be acting on a situation that already resolved
 * itself. If the check itself fails, we err on the side of proceeding rather
 * than silently blocking a real fix on a flaky observability query.
 */
export async function isIncidentStillActive(lookbackMinutes = 2): Promise<boolean> {
  const rate = await getErrorRate(MONITORED_CONTAINER_NAME, lookbackMinutes);
  return rate > ACTIVE_ERROR_RATE_THRESHOLD;
}
