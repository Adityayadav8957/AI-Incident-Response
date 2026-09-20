import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncidentReport } from "agent";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "";
const SLACK_CHANNEL = process.env.SLACK_CHANNEL ?? "";
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";

function reportBlocks(incidentId: string, alertDescription: string, report: IncidentReport) {
  const confidencePct = Math.round(report.confidence * 100);
  const evidenceList = report.evidence.length
    ? report.evidence.map((e) => `• ${e}`).join("\n")
    : "_none_";

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: report.insufficientEvidence ? "⚠️ Incident (low confidence)" : "🔴 Incident" },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Alert:* ${alertDescription}\n*Summary:* ${report.summary}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Root cause:* ${report.rootCause}\n*Confidence:* ${confidencePct}%`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Evidence:*\n${evidenceList}` },
    },
  ];

  if (report.suggestedAction) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Suggested action:* ${report.suggestedAction}` },
    });
    blocks.push({
      type: "actions",
      block_id: "incident_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve" },
          style: "primary",
          action_id: "approve_remediation",
          value: incidentId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          action_id: "reject_remediation",
          value: incidentId,
        },
      ],
    });
  }

  return blocks;
}

export async function postIncidentReport(
  incidentId: string,
  alertDescription: string,
  report: IncidentReport
): Promise<{ channel: string; ts: string }> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: SLACK_CHANNEL,
      text: `Incident: ${report.summary}`,
      blocks: reportBlocks(incidentId, alertDescription, report),
    }),
  });

  const body = (await res.json()) as { ok: boolean; error?: string; channel?: string; ts?: string };
  if (!body.ok) {
    throw new Error(`Slack postMessage failed: ${body.error}`);
  }
  return { channel: body.channel!, ts: body.ts! };
}

export async function updateSlackMessage(
  channel: string,
  ts: string,
  text: string,
  blocks: unknown[]
): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, ts, text, blocks }),
  });

  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) {
    throw new Error(`Slack chat.update failed: ${body.error}`);
  }
}

export function decisionBlocks(
  incidentId: string,
  alertDescription: string,
  report: IncidentReport,
  decision: "approved" | "rejected",
  decidedBy: string
) {
  const blocks: unknown[] = reportBlocks(incidentId, alertDescription, report).filter(
    (b) => (b as { block_id?: string }).block_id !== "incident_actions"
  );
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text:
          decision === "approved"
            ? `✅ Approved by <@${decidedBy}>`
            : `❌ Rejected by <@${decidedBy}>`,
      },
    ],
  });
  return blocks;
}

const MAX_SIGNATURE_AGE_SECONDS = 60 * 5;

export function verifySlackSignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined
): boolean {
  if (!timestamp || !signature || !SLACK_SIGNING_SECRET) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_SECONDS) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", SLACK_SIGNING_SECRET).update(baseString).digest("hex")}`;

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
