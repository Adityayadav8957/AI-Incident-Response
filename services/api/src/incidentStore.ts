import { randomUUID } from "node:crypto";
import type { IncidentReport } from "agent";

export type IncidentStatus = "investigating" | "awaiting_approval" | "approved" | "rejected";

export interface RemediationOutcome {
  actionId?: string;
  success: boolean;
  detail: string;
  executedAt: string;
}

export interface Incident {
  id: string;
  alertDescription: string;
  report: IncidentReport;
  status: IncidentStatus;
  slackChannel?: string;
  slackMessageTs?: string;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  remediation?: RemediationOutcome;
}

// In-memory for now -- swap for Postgres once there's more than one process
// and incidents need to survive a restart.
const incidents = new Map<string, Incident>();

export function createIncident(alertDescription: string, report: IncidentReport): Incident {
  const incident: Incident = {
    id: randomUUID(),
    alertDescription,
    report,
    status: "awaiting_approval",
    createdAt: new Date().toISOString(),
  };
  incidents.set(incident.id, incident);
  return incident;
}

export function getIncident(id: string): Incident | undefined {
  return incidents.get(id);
}

export function updateIncident(id: string, patch: Partial<Incident>): Incident | undefined {
  const existing = incidents.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };
  incidents.set(id, updated);
  return updated;
}
