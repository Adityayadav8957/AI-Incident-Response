import Fastify from "fastify";

const app = Fastify({
  logger: {
    level: "info",
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
});

// Toggled on to simulate "a bad deploy just shipped" during a demo,
// without needing a real CI/CD pipeline wired up yet.
let bugMode = false;

app.get("/health", async () => {
  return { status: "ok" };
});

app.get("/api/checkout", async (req, reply) => {
  const start = Date.now();
  const delayMs = 20 + Math.random() * 130;
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const errorRate = bugMode ? 0.6 : 0.02;
  const latencyMs = Date.now() - start;

  if (Math.random() < errorRate) {
    req.log.error(
      { latencyMs, bugMode, route: "/api/checkout" },
      "Checkout failed: payment gateway timeout"
    );
    return reply.code(500).send({ error: "payment gateway timeout" });
  }

  req.log.info(
    { latencyMs, bugMode, route: "/api/checkout" },
    "Checkout succeeded"
  );
  return { orderId: crypto.randomUUID(), status: "confirmed" };
});

app.post("/admin/bug-mode", async (req) => {
  const body = req.body as { enabled?: boolean };
  bugMode = Boolean(body?.enabled);
  req.log.warn({ bugMode }, "Bug mode toggled");
  return { bugMode };
});

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
