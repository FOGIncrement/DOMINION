import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth.js";
import { banksRouter } from "./routes/banks.js";
import { bondsRouter } from "./routes/bonds.js";
import { cheatsRouter } from "./routes/cheats.js";
import { companiesRouter } from "./routes/companies.js";
import { contractsRouter } from "./routes/contracts.js";
import { corporateBondsRouter } from "./routes/corporateBonds.js";
import { depositsRouter } from "./routes/deposits.js";
import { gameRouter } from "./routes/game.js";
import { governmentRouter } from "./routes/government.js";
import { infrastructureRouter } from "./routes/infrastructure.js";
import { loansRouter } from "./routes/loans.js";
import { marketRouter } from "./routes/market.js";
import { newsRouter } from "./routes/news.js";
import { stocksRouter } from "./routes/stocks.js";
import { techRouter } from "./routes/tech.js";
import { tutorialRouter } from "./routes/tutorial.js";
import { worldRouter } from "./routes/world.js";
import { startScheduler } from "./scheduler.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/game", gameRouter);
app.use("/api/companies", companiesRouter);
app.use("/api/market", marketRouter);
app.use("/api/stocks", stocksRouter);
app.use("/api/banks", banksRouter);
app.use("/api/loans", loansRouter);
app.use("/api/deposits", depositsRouter);
app.use("/api/bonds", bondsRouter);
app.use("/api/corporate-bonds", corporateBondsRouter);
app.use("/api/contracts", contractsRouter);
app.use("/api/government", governmentRouter);
app.use("/api/infrastructure", infrastructureRouter);
app.use("/api/world", worldRouter);
app.use("/api/news", newsRouter);
app.use("/api/tech", techRouter);
app.use("/api/tutorial", tutorialRouter);
app.use("/api/cheats", cheatsRouter);

// Serves the built client (packages/client/dist) when present, so one
// process can be the whole production deployment — no separate static file
// server needed. In dev, the client is never built to disk (Vite's dev
// server handles it on its own port instead), so this block is simply
// skipped and nothing changes about the local dev workflow.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  startScheduler();
});
