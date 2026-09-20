import type { FastifyInstance } from "fastify";
import { investigate } from "agent";
import { createIncident, updateIncident } from "../incidentStore.js";
import { postIncidentReport } from "../slack.js";

interface AlertBody {
  description: string;
}

export function registerAlertsRoute(app: FastifyInstance) {
  app.post<{ Body: AlertBody }>("/alerts", async (request, reply) => {
    const { description } = request.body;
    if (!description || typeof description !== "string") {
      return reply.code(400).send({ error: "description is required" });
    }

    request.log.info({ description }, "Investigating alert");
    const { report } = await investigate(description);

    const incident = createIncident(description, report);

    try {
      const { channel, ts } = await postIncidentReport(incident.id, description, report);
      updateIncident(incident.id, { slackChannel: channel, slackMessageTs: ts });
    } catch (err) {
      request.log.error({ err }, "Failed to post incident report to Slack");
    }

    return reply.code(201).send({ incidentId: incident.id, report });
  });
}
