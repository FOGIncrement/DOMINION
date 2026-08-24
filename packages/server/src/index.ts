import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth.js";
import { banksRouter } from "./routes/banks.js";
import { cheatsRouter } from "./routes/cheats.js";
import { companiesRouter } from "./routes/companies.js";
import { depositsRouter } from "./routes/deposits.js";
import { gameRouter } from "./routes/game.js";
import { governmentRouter } from "./routes/government.js";
import { loansRouter } from "./routes/loans.js";
import { marketRouter } from "./routes/market.js";
import { newsRouter } from "./routes/news.js";
import { stocksRouter } from "./routes/stocks.js";
import { techRouter } from "./routes/tech.js";
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
app.use("/api/government", governmentRouter);
app.use("/api/world", worldRouter);
app.use("/api/news", newsRouter);
app.use("/api/tech", techRouter);
app.use("/api/cheats", cheatsRouter);

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  startScheduler();
});
