import type { FastifyInstance } from "fastify";
import { investigateAndNotify } from "../incidentPipeline.js";

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
    const incident = await investigateAndNotify(description);

    return reply.code(201).send({ incidentId: incident.id, report: incident.report });
  });
}
