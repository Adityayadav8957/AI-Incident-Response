const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL ?? "http://localhost:9200";
const ELASTICSEARCH_INDEX = process.env.ELASTICSEARCH_INDEX ?? "filebeat-8.15.0";
const ELASTICSEARCH_API_KEY = process.env.ELASTICSEARCH_API_KEY;

export const searchLogsTool = {
  name: "search_logs",
  description:
    "Search application logs stored in Elasticsearch. Use this to look for error " +
    "patterns, check timing/latency, and correlate log activity with the reported alert.",
  input_schema: {
    type: "object" as const,
    properties: {
      containerName: {
        type: "string",
        description:
          "Filter to a specific container/service name (e.g. 'ai_incident-demo-app-1'). Omit to search all services.",
      },
      level: {
        type: "string",
        enum: ["error", "warn", "info"],
        description: "Filter by log level. Omit to search all levels.",
      },
      lookbackMinutes: {
        type: "number",
        description: "How many minutes back to search from now. Defaults to 15.",
      },
      limit: {
        type: "number",
        description: "Max number of log entries to return. Defaults to 20, max 100.",
      },
    },
    required: [],
  },
};

interface SearchLogsInput {
  containerName?: string;
  level?: string;
  lookbackMinutes?: number;
  limit?: number;
}

export async function searchLogs(input: SearchLogsInput): Promise<unknown> {
  const lookbackMinutes = input.lookbackMinutes ?? 15;
  const limit = Math.min(input.limit ?? 20, 100);

  const filter: Record<string, unknown>[] = [
    { range: { "@timestamp": { gte: `now-${lookbackMinutes}m` } } },
  ];
  if (input.containerName) {
    filter.push({ match: { "container.name": input.containerName } });
  }
  if (input.level) {
    filter.push({ match: { level: input.level } });
  }

  const res = await fetch(`${ELASTICSEARCH_URL}/${ELASTICSEARCH_INDEX}/_search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ELASTICSEARCH_API_KEY ? { Authorization: `ApiKey ${ELASTICSEARCH_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      size: limit,
      sort: [{ "@timestamp": "desc" }],
      query: { bool: { filter } },
    }),
  });

  if (!res.ok) {
    throw new Error(`Elasticsearch search failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as {
    hits: { hits: { _source: Record<string, unknown> }[] };
  };

  return body.hits.hits.map((hit) => ({
    timestamp: hit._source["@timestamp"],
    level: hit._source.level,
    msg: hit._source.msg,
    container: (hit._source.container as { name?: string } | undefined)?.name,
    statusCode: (hit._source.res as { statusCode?: number } | undefined)?.statusCode,
    latencyMs: hit._source.latencyMs ?? hit._source.responseTime,
    bugMode: hit._source.bugMode,
  }));
}
