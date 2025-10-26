import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import {
  upsertUser,
  createReport,
  listReports,
  updateReportStatus,
  getStats,
  listResolved,
  getLeaderboard,
  getUser,
  authLogin,
} from "./routes/reports";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  // Increase JSON/body size limit to allow camera images (base64) — adjust as needed
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Health & demo
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });
  app.get("/api/demo", handleDemo);

  // Users
  app.post("/api/users/upsert", upsertUser);
  app.post("/api/auth/login", authLogin);
  app.get("/api/users/:id", getUser);

  // Reports
  app.get("/api/reports", listReports);
  app.post("/api/reports", createReport);
  app.patch("/api/reports/:id/status", updateReportStatus);
  app.get("/api/stats", getStats);
  app.get("/api/reports-resolved", listResolved);
  app.get("/api/leaderboard", getLeaderboard);

  // Graceful error handler for payloads that exceed the configured limit
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err && (err.type === 'entity.too.large' || /payload/i.test(err.message || ''))) {
      return res.status(413).json({ error: 'Payload too large. Reduce image size or switch to multipart uploads.' });
    }
    console.error('Unhandled server error', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
