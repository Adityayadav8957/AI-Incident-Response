export const submitReportTool = {
  name: "submit_incident_report",
  description:
    "Submit your final incident investigation report. Call this exactly once, after " +
    "you've gathered enough evidence with search_logs -- or once you've determined the " +
    "evidence available is insufficient to reach a conclusion.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "One-sentence summary of what happened.",
      },
      rootCause: {
        type: "string",
        description: "The most likely root cause, or 'unknown' if evidence is insufficient.",
      },
      confidence: {
        type: "number",
        description: "Confidence in the root cause, from 0 (pure guess) to 1 (certain).",
      },
      evidence: {
        type: "array",
        items: { type: "string" },
        description: "Specific log entries or patterns that support this conclusion.",
      },
      suggestedAction: {
        type: "string",
        description: "A concrete, specific remediation suggestion. Omit if none applies.",
      },
      insufficientEvidence: {
        type: "boolean",
        description: "True if the available logs don't support a confident conclusion.",
      },
    },
    required: ["summary", "rootCause", "confidence", "evidence", "insufficientEvidence"],
  },
};

export interface IncidentReport {
  summary: string;
  rootCause: string;
  confidence: number;
  evidence: string[];
  suggestedAction?: string;
  insufficientEvidence: boolean;
}
