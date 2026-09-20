import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { searchLogs, searchLogsTool } from "./tools/searchLogs.js";
import { submitReportTool, type IncidentReport } from "./tools/submitReport.js";

const MODEL = "claude-sonnet-5";
const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are an SRE incident investigation agent. You will be given an
alert describing a production issue. Use the search_logs tool to gather evidence -- check
error patterns, timing, and whether the issue correlates with a recent change (e.g. a
"bugMode" flag flipping on, a spike in a specific status code, etc).

Be skeptical of your first hypothesis. Look for corroborating evidence before concluding.
If the logs don't support a confident root cause, say so explicitly rather than guessing --
set insufficientEvidence to true and confidence low.

When you're done investigating, call submit_incident_report exactly once with your findings.`;

const client = new Anthropic();

const tools: Tool[] = [searchLogsTool as Tool, submitReportTool as Tool];

export interface InvestigationStep {
  tool: string;
  input: unknown;
  output: unknown;
}

export interface InvestigationResult {
  report: IncidentReport;
  steps: InvestigationStep[];
}

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === "search_logs") {
    return searchLogs(input);
  }
  throw new Error(`Unknown tool: ${name}`);
}

export async function investigate(alertDescription: string): Promise<InvestigationResult> {
  const messages: MessageParam[] = [
    { role: "user", content: `Alert: ${alertDescription}` },
  ];
  const steps: InvestigationStep[] = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const forceFinalAnswer = iteration === MAX_ITERATIONS - 1;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      tool_choice: forceFinalAnswer
        ? { type: "tool", name: "submit_incident_report" }
        : { type: "auto" },
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    const reportBlock = toolUseBlocks.find((b) => b.name === "submit_incident_report");
    if (reportBlock) {
      return { report: reportBlock.input as IncidentReport, steps };
    }

    if (toolUseBlocks.length === 0) {
      // Model returned plain text instead of a tool call -- nudge it to finish properly.
      messages.push({
        role: "user",
        content: "Please call submit_incident_report with your findings.",
      });
      continue;
    }

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const output = await runTool(block.name, block.input as Record<string, unknown>);
        steps.push({ tool: block.name, input: block.input, output });
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(output),
        };
      })
    );

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Investigation did not conclude within the iteration budget");
}
