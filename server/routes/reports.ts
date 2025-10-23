import type { RequestHandler } from "express";
import type { Report, StatsResponse, User } from "@shared/api";
import fs from 'fs';
import path from 'path';

// In-memory store (replace with SQL later)
const authorityWhitelist = new Set([
  "test.authority@gov.in",
  "admin@test.com",
  "authority@test.com",
  "officer@test.com",
]);

const DB_FILE = path.join(process.cwd(), 'server', 'data', 'db.json');

const db = {
  users: new Map<string, User>(),
  reports: new Map<string, Report>(),
  queueCounter: 0,
};

function saveDB() {
  try {
    const payload = {
      users: Array.from(db.users.values()),
      reports: Array.from(db.reports.values()),
      queueCounter: db.queueCounter,
    };
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save DB', e);
  }
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.users)) {
      for (const u of parsed.users) db.users.set(u.id, u);
    }
    if (Array.isArray(parsed.reports)) {
      for (const r of parsed.reports) db.reports.set(r.id, r);
    }
    if (typeof parsed.queueCounter === 'number') db.queueCounter = parsed.queueCounter;
  } catch (e) {
    console.error('Failed to load DB', e);
  }
}

// load persisted DB on startup
loadDB();

function determineRole(email: string): User["role"] {
  if (email.toLowerCase().endsWith("@gov.in") || authorityWhitelist.has(email.toLowerCase())) {
    return "authority";
  }
  return "citizen";
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Very simple AI-like classifier (deterministic). Replace with real AI later.
function aiClassify(description: string, imageDataUrl: string) {
  const text = `${description}`.toLowerCase();
  const spamIndicators = ["win money", "free bitcoin", "click here", "subscribe", "promo"];
  let spam_score = 0;
  for (const k of spamIndicators) {
    if (text.includes(k)) spam_score += 0.25;
  }
  spam_score = Math.max(0, Math.min(1, spam_score));

  let category = "other";
  if (/(pothole|road|asphalt|street)/.test(text)) category = "road_damage";
  else if (/(garbage|trash|waste|dump)/.test(text)) category = "garbage";
  else if (/(streetlight|light|lamp)/.test(text)) category = "streetlight";
  else if (/(water|leak|sewage|drain)/.test(text)) category = "water";

  let priority: Report["priority"] = "Medium";
  if (/(fire|accident|injur|collapse|flood)/.test(text)) priority = "High";
  else if (/(pothole|leak|garbage)/.test(text)) priority = "Medium";
  else priority = "Low";

  return { spam_score, category, priority };
}

export const upsertUser: RequestHandler = (req, res) => {
  const { email, name, photoURL, phone } = req.body as Partial<User>;
  if (!email || !name) return res.status(400).json({ error: "Missing email or name" });

  let existing = Array.from(db.users.values()).find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!existing) {
    const user: User = {
      id: uid(),
      email,
      name,
      photoURL: photoURL ?? null,
      phone: phone ?? null,
      role: determineRole(email),
      points: 0,
      createdAt: Date.now(),
    };
    db.users.set(user.id, user);
    existing = user;
    saveDB();
  } else {
    existing.name = name ?? existing.name;
    existing.photoURL = photoURL ?? existing.photoURL;
    existing.phone = phone ?? existing.phone;
    existing.role = determineRole(email);
    db.users.set(existing.id, existing);
    saveDB();
  }
  res.json(existing);
};

export const createReport: RequestHandler = (req, res) => {
  const { userId, userName, userEmail, imageDataUrl, location, description, isLikelyScreen } = req.body as Partial<Report> & { imageDataUrl?: string; isLikelyScreen?: boolean };
  if (!userId || !userEmail || !imageDataUrl || !description) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const base: Report = {
    id: uid(),
    userId,
    userName: userName ?? "",
    userEmail,
    imageDataUrl,
    location: location ?? null,
    description,
    createdAt: Date.now(),
    status: "submitted",
    ai_category: null,
    spam_score: null,
    is_spam: null,
    priority: null,
    queue_order: null,
    validated_at: null,
    resolved_at: null,
    resolution_description: null,
    resolution_photos: [],
  };

  // Run classifier
  const { spam_score: baseSpam, category, priority } = aiClassify(description, imageDataUrl);
  let spam_score = baseSpam;

  // If client flagged possible screen photo, increase spam likelihood
  if (isLikelyScreen) spam_score = Math.max(spam_score, 0.9);

  base.spam_score = spam_score;
  base.ai_category = category;
  base.priority = priority;
  base.validated_at = Date.now();

  if (spam_score > 0.6) {
    base.is_spam = true;
    base.status = "spam";
  } else {
    base.is_spam = false;
    base.status = "queued";
    base.queue_order = ++db.queueCounter;
  }

  // Adjust priority for important categories
  if (base.ai_category === "road_damage" && !base.is_spam) {
    base.priority = "High";
  }
  if (base.is_spam) base.priority = "Low";

  db.reports.set(base.id, base);
  saveDB();
  res.status(201).json(base);
};


export const listReports: RequestHandler = (req, res) => {
  const status = (req.query.status as string) || undefined;
  const items = Array.from(db.reports.values())
    .filter((r) => (status ? r.status === status : true))
    .sort((a, b) => {
      const prioRank = (p: Report["priority"]) => (p === "High" ? 3 : p === "Medium" ? 2 : 1);
      const byPrio = (prioRank(b.priority || "Low") - prioRank(a.priority || "Low"));
      if (byPrio !== 0) return byPrio;
      return (a.queue_order || 0) - (b.queue_order || 0);
    })
    .map((r) => ({ ...r, reporter_points: db.users.get(r.userId)?.points ?? 0 }));
  res.json(items);
};

export const updateReportStatus: RequestHandler = (req, res) => {
  const { id } = req.params as { id: string };
  const { status, resolution_description, resolution_photos, resolved_location } = req.body as Partial<Report> & { resolved_location?: { lat: number; lng: number } };
  const report = db.reports.get(id);
  if (!report) return res.status(404).json({ error: "Report not found" });

  const prevStatus = report.status;
  report.status = status || report.status;

  if (report.status === "resolved") {
    // resolution photos are mandatory
    if (!Array.isArray(resolution_photos) || resolution_photos.length === 0) {
      // accept but mark unresolved? better to reject to enforce authority upload
      return res.status(400).json({ error: 'resolution_photos required when marking resolved' });
    }

    report.resolved_at = Date.now();
    report.resolution_description = resolution_description ?? report.resolution_description;
    report.resolution_photos = resolution_photos as string[];
    if (resolved_location && typeof resolved_location.lat === "number" && typeof resolved_location.lng === "number") {
      report.resolved_location = resolved_location as any;
    }

    // Verify location proximity to original report location (if original exists)
    let verified = false;
    if (report.location && report.resolved_location) {
      const distMeters = haversineMeters(report.location, report.resolved_location);
      // within 500 meters considered valid
      if (distMeters <= 500) verified = true;
    } else if (!report.location) {
      // no original location — cannot verify, keep unverified
      verified = false;
    }
    report.resolution_verified = verified;

    // Award points only when transitioning into resolved AND verified
    if (prevStatus !== "resolved" && verified) {
      const user = db.users.get(report.userId);
      if (user) {
        user.points += 10;
        db.users.set(user.id, user);
        saveDB();
      }
    }
  }

  db.reports.set(report.id, report);
  saveDB();
  res.json(report);
};

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371e3; // meters
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lng - a.lng);
  const s = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

export const getStats: RequestHandler = (_req, res) => {
  const all = Array.from(db.reports.values());
  const resolved = all.filter((r) => r.status === "resolved");
  const totalReports = all.length;
  const resolvedCount = resolved.length;
  const resolutionRate = totalReports === 0 ? 0 : resolvedCount / totalReports;
  let averageResolutionHours: number | null = null;
  if (resolvedCount > 0) {
    const hours = resolved
      .filter((r) => r.resolved_at)
      .map((r) => ((r.resolved_at! - r.createdAt) / 36e5));
    if (hours.length) averageResolutionHours = hours.reduce((a, b) => a + b, 0) / hours.length;
  }
  const response: StatsResponse = { totalReports, resolvedCount, resolutionRate, averageResolutionHours };
  res.json(response);
};

export const listResolved: RequestHandler = (_req, res) => {
  const items = Array.from(db.reports.values()).filter((r) => r.status === "resolved").map((r) => ({ ...r, reporter_points: db.users.get(r.userId)?.points ?? 0 }));
  res.json(items);
};

export const getUser: RequestHandler = (req, res) => {
  const { id } = req.params as { id: string };
  const user = db.users.get(id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
};

export const getLeaderboard: RequestHandler = (_req, res) => {
  const users = Array.from(db.users.values())
    .sort((a, b) => b.points - a.points)
    .slice(0, 20)
    .map((u) => ({ id: u.id, name: u.name, points: u.points, role: u.role }));
  res.json(users);
};
