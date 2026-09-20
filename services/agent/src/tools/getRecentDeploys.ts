const GITHUB_REPO = process.env.GITHUB_REPO ?? "Adityayadav8957/AI-Incident-Response";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const WATCHED_PATH = process.env.GITHUB_WATCHED_PATH ?? "apps/demo-app";

export const getRecentDeploysTool = {
  name: "get_recent_deploys",
  description:
    "List recent commits that touched the affected service, standing in for deploy " +
    "history. Use this to check whether the incident correlates with a recent code change.",
  input_schema: {
    type: "object" as const,
    properties: {
      hours: {
        type: "number",
        description: "How many hours back to look. Defaults to 24.",
      },
    },
    required: [],
  },
};

interface GetRecentDeploysInput {
  hours?: number;
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
}

export async function getRecentDeploys(input: GetRecentDeploysInput): Promise<unknown> {
  const hours = input.hours ?? 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const url = new URL(`https://api.github.com/repos/${GITHUB_REPO}/commits`);
  url.searchParams.set("path", WATCHED_PATH);
  url.searchParams.set("since", since);
  url.searchParams.set("per_page", "10");

  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API request failed: ${res.status} ${await res.text()}`);
  }

  const commits = (await res.json()) as GitHubCommit[];

  return commits.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0],
    author: c.commit.author.name,
    date: c.commit.author.date,
    url: c.html_url,
  }));
}
