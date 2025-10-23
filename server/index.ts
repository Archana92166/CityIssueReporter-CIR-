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
} from "./routes/reports";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Health & demo
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });
  app.get("/api/demo", handleDemo);

  // Users
  app.post("/api/users/upsert", upsertUser);
  app.get("/api/users/:id", getUser);

  // Reports
  app.get("/api/reports", listReports);
  app.post("/api/reports", createReport);
  app.patch("/api/reports/:id/status", updateReportStatus);
  app.get("/api/stats", getStats);
  app.get("/api/reports-resolved", listResolved);
  app.get("/api/leaderboard", getLeaderboard);

  return app;
}
