import Fastify from "fastify";
import { registerAlertsRoute } from "./routes/alerts.js";
import { registerSlackInteractionsRoute } from "./routes/slackInteractions.js";
import { startWatcher } from "./watcher.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

registerAlertsRoute(app);
registerSlackInteractionsRoute(app);

if (process.env.ANTHROPIC_API_KEY) {
  startWatcher(app.log);
} else {
  app.log.warn("ANTHROPIC_API_KEY not set -- automatic incident watcher disabled");
}

const port = Number(process.env.PORT) || 4000;
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
