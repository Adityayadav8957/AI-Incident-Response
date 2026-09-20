import type { FastifyInstance } from "fastify";
import { getIncident, updateIncident } from "../incidentStore.js";
import { decisionBlocks, updateSlackMessage, verifySlackSignature } from "../slack.js";
import { getRemediationAction, isIncidentStillActive } from "../remediation.js";

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

    // Guards against a double-click or a duplicate delivery re-running remediation.
    if (incident.status !== "awaiting_approval") {
      request.log.warn(
        { incidentId: incident.id, status: incident.status },
        "Ignoring interaction for an already-decided incident"
      );
      return reply.code(200).send();
    }

    const decision = action.action_id === "approve_remediation" ? "approved" : "rejected";
    let remediationDetail: string | undefined;

    if (decision === "approved") {
      const remediationAction = getRemediationAction(incident.report.suggestedActionId);

      if (!remediationAction) {
        remediationDetail = "ℹ️ No automatable action for this incident -- approval noted only.";
      } else {
        const stillActive = await isIncidentStillActive().catch((err) => {
          request.log.warn({ err }, "Could not revalidate incident state, proceeding anyway");
          return true;
        });

        if (!stillActive) {
          remediationDetail = "ℹ️ Skipped -- error rate already back to normal by the time this was approved.";
          updateIncident(incident.id, {
            remediation: {
              success: true,
              detail: "skipped: no longer active",
              executedAt: new Date().toISOString(),
            },
          });
        } else {
          const result = await remediationAction.execute().catch((err) => ({
            success: false,
            detail: String(err),
          }));
          remediationDetail = result.success
            ? `✅ Action executed: ${result.detail}`
            : `⚠️ Action failed: ${result.detail}`;
          updateIncident(incident.id, {
            remediation: {
              actionId: remediationAction.id,
              success: result.success,
              detail: result.detail,
              executedAt: new Date().toISOString(),
            },
          });
        }
      }
    }

    updateIncident(incident.id, {
      status: decision,
      decidedBy: payload.user.id,
      decidedAt: new Date().toISOString(),
    });

    request.log.info(
      { incidentId: incident.id, decision, decidedBy: payload.user.id, remediationDetail },
      "Incident decision recorded"
    );

    if (incident.slackChannel && incident.slackMessageTs) {
      const blocks = decisionBlocks(
        incident.id,
        incident.alertDescription,
        incident.report,
        decision,
        payload.user.id,
        remediationDetail
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
