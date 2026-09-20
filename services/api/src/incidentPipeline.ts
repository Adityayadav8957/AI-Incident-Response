import { investigate } from "agent";
import { createIncident, updateIncident, type Incident } from "./incidentStore.js";
import { postIncidentReport } from "./slack.js";

export async function investigateAndNotify(alertDescription: string): Promise<Incident> {
  const { report } = await investigate(alertDescription);
  const incident = createIncident(alertDescription, report);

  try {
    const { channel, ts } = await postIncidentReport(incident.id, alertDescription, report);
    updateIncident(incident.id, { slackChannel: channel, slackMessageTs: ts });
  } catch (err) {
    console.error("Failed to post incident report to Slack:", err);
  }

  return incident;
}
