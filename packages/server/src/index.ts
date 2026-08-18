import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth.js";
import { gameRouter } from "./routes/game.js";
import { marketRouter } from "./routes/market.js";
import { newsRouter } from "./routes/news.js";
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
app.use("/api/market", marketRouter);
app.use("/api/world", worldRouter);
app.use("/api/news", newsRouter);
app.use("/api/tech", techRouter);

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  startScheduler();
});
