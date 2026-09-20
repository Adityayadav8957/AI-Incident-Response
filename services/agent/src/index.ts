import { investigate } from "./agent.js";

const alertDescription = process.argv.slice(2).join(" ") ||
  "Elevated 500 error rate on /api/checkout over the last 15 minutes";

const result = await investigate(alertDescription);

console.log("\n=== Investigation trace ===");
for (const step of result.steps) {
  console.log(`\n> ${step.tool}(${JSON.stringify(step.input)})`);
  console.log(JSON.stringify(step.output, null, 2));
}

console.log("\n=== Incident report ===");
console.log(JSON.stringify(result.report, null, 2));
