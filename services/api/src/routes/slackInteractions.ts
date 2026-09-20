import type { FastifyInstance } from "fastify";
import { getIncident, updateIncident } from "../incidentStore.js";
import { decisionBlocks, updateSlackMessage, verifySlackSignature } from "../slack.js";

interface SlackBlockAction {
  action_id: string;
  value: string;
}

interface SlackInteractionPayload {
  type: string;
  user: { id: string };
  actions: SlackBlockAction[];
}

export function registerSlackInteractionsRoute(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => done(null, body)
  );

  app.post("/slack/interactions", async (request, reply) => {
    const rawBody = request.body as string;
    const signature = request.headers["x-slack-signature"] as string | undefined;
    const timestamp = request.headers["x-slack-request-timestamp"] as string | undefined;

    if (!verifySlackSignature(rawBody, timestamp, signature)) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const payloadRaw = new URLSearchParams(rawBody).get("payload");
    if (!payloadRaw) {
      return reply.code(400).send({ error: "missing payload" });
    }
    const payload = JSON.parse(payloadRaw) as SlackInteractionPayload;

    const action = payload.actions[0];
    const incident = getIncident(action.value);
    if (!incident) {
      request.log.warn({ incidentId: action.value }, "Interaction for unknown incident");
      return reply.code(200).send();
    }

    const decision = action.action_id === "approve_remediation" ? "approved" : "rejected";
    updateIncident(incident.id, {
      status: decision,
      decidedBy: payload.user.id,
      decidedAt: new Date().toISOString(),
    });

    request.log.info(
      { incidentId: incident.id, decision, decidedBy: payload.user.id },
      decision === "approved"
        ? "Remediation approved -- no remediation action layer wired up yet"
        : "Remediation rejected"
    );

    if (incident.slackChannel && incident.slackMessageTs) {
      const blocks = decisionBlocks(
        incident.id,
        incident.alertDescription,
        incident.report,
        decision,
        payload.user.id
      );
      await updateSlackMessage(
        incident.slackChannel,
        incident.slackMessageTs,
        `Incident ${decision}`,
        blocks
      );
    }

    return reply.code(200).send();
  });
}
