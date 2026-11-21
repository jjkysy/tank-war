import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { getJob } from "./jobs";
import { mountSpa } from "./serve";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

// Platform job callback. The platform signs the request; the handler itself
// only ever runs in this app's own runtime (see _core/jobs.ts).
app.post("/api/_jobs/:name", async (c) => {
  const handler = getJob(c.req.param("name"));
  if (!handler) return c.json({ error: "unknown job" }, 404);
  await handler();
  return c.json({ ok: true });
});

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, c) => createContext(c),
  }),
);

// In production the same process serves the built SPA from dist/public.
mountSpa(app);

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${port}`);
});
