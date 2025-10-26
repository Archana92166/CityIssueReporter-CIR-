import type { RequestHandler } from "express";
import type { Report, StatsResponse, User } from "@shared/api";
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

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
  imageHashes: new Map<string, string[]>(), // hash -> [reportId,...]
  recentReports: new Map<string, number[]>(), // userId -> timestamps (ms) for simple rate limiting
};

function saveDB() {
  try {
    const payload = {
      users: Array.from(db.users.values()),
      reports: Array.from(db.reports.values()),
      queueCounter: db.queueCounter,
      imageHashes: Object.fromEntries(Array.from(db.imageHashes.entries())),
      recentReports: Object.fromEntries(Array.from(db.recentReports.entries())),
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
    if (parsed.imageHashes && typeof parsed.imageHashes === 'object') {
      for (const [k, v] of Object.entries(parsed.imageHashes)) {
        if (Array.isArray(v)) db.imageHashes.set(k, v as string[]);
      }
    }
    if (parsed.recentReports && typeof parsed.recentReports === 'object') {
      for (const [k, v] of Object.entries(parsed.recentReports)) {
        if (Array.isArray(v)) db.recentReports.set(k, v as number[]);
      }
    }
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

  // Category detection: more specific patterns first to avoid substring collisions
  let category = "other";
  if (/\b(streetlight|street light|lamp post|light pole|lamp-post|bulb|street-lamp|street light pole)\b/.test(text)) {
    category = "streetlight";
  } else if (/\b(pothole|potholes|road|asphalt|pavement|manhole|speedbreaker|speed breaker|road surface)\b/.test(text)) {
    category = "road_damage";
  } else if (/\b(garbage|trash|waste|dump|litter|dumping)\b/.test(text)) {
    category = "garbage";
  } else if (/\b(water|leak|sewage|drain|flood|burst)\b/.test(text)) {
    category = "water";
  }

  // Priority heuristics: consider category and contextual keywords
  let priority: Report["priority"] = "Low";
  if (/\b(fire|accident|injur|collapse|flood)\b/.test(text)) {
    priority = "High";
  } else if (category === "road_damage") {
    // potholes that mention size/severity or causing accidents => High
    if (/\b(pothole).*(deep|large|huge|danger|dangerous|accident|cause|causing)\b/.test(text)) priority = "High";
    else priority = "Medium";
  } else if (category === "streetlight") {
    // exposed wiring, sparking, or darkness causing insecurity => High
    if (/\b(exposed|wire|sparking|electr|live wire|no light|dark|insecurity|unsafe)\b/.test(text)) priority = "High";
    else priority = "Medium";
  } else if (category === "garbage" || category === "water") {
    priority = "Medium";
  }

  return { spam_score, category, priority };
}

export const upsertUser: RequestHandler = (req, res) => {
  const { email, name, photoURL, phone, password } = req.body as Partial<User> & { password?: string };
  if (!name || !(email || phone)) return res.status(400).json({ error: "Missing name and (email or phone)" });
  let emailKey = email;
  if (!emailKey && phone) {
    emailKey = `${phone}@phone.local`;
  }

  let existing = Array.from(db.users.values()).find((u) => (u.email && emailKey && u.email.toLowerCase() === emailKey.toLowerCase()) || (phone && u.phone === phone));
  if (!existing) {
    const user: User = {
      id: uid(),
      email: emailKey as string,
      name,
      photoURL: photoURL ?? null,
      phone: phone ?? null,
      role: determineRole(emailKey as string),
      points: 0,
      createdAt: Date.now(),
      passwordHash: password ? bcrypt.hashSync(password, 10) : null,
    };
    db.users.set(user.id, user);
    existing = user;
    saveDB();
  } else {
    existing.name = name ?? existing.name;
    existing.photoURL = photoURL ?? existing.photoURL;
    existing.phone = phone ?? existing.phone;
    existing.role = determineRole(existing.email || "");
    if (password) existing.passwordHash = bcrypt.hashSync(password, 10);
    db.users.set(existing.id, existing);
    saveDB();
  }
  const out = { ...existing } as any;
  delete out.passwordHash;
  res.json(out);
};

export const authLogin: RequestHandler = (req, res) => {
  const { email, phone, password, name, photoURL } = req.body as Partial<User> & { password?: string };
  if (!email && !phone) return res.status(400).json({ error: 'email or phone required' });
  let emailKey = email;
  if (!emailKey && phone) emailKey = `${phone}@phone.local`;

  let existing = Array.from(db.users.values()).find((u) => (emailKey && u.email && u.email.toLowerCase() === emailKey.toLowerCase()) || (phone && u.phone === phone));
  if (!existing) {
    // register new user
    const user: User = {
      id: uid(),
      email: emailKey as string,
      name: name || (emailKey ? emailKey.split('@')[0] : 'Anonymous'),
      photoURL: photoURL ?? null,
      phone: phone ?? null,
      role: determineRole(emailKey as string),
      points: 0,
      createdAt: Date.now(),
      passwordHash: password ? bcrypt.hashSync(password, 10) : null,
    };
    db.users.set(user.id, user);
    saveDB();
    const out = { ...user } as any; delete out.passwordHash; return res.json(out);
  }

  // existing user: if passwordHash exists on record, require match
  if ((existing as any).passwordHash) {
    if (!password) return res.status(401).json({ error: 'Password required' });
    const ok = bcrypt.compareSync(password, (existing as any).passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    const out = { ...existing } as any; delete out.passwordHash; return res.json(out);
  }

  // existing user without passwordHash: if provided, set it (first-time set), else allow login (no password)
  if (password) {
    existing.passwordHash = bcrypt.hashSync(password, 10);
    db.users.set(existing.id, existing);
    saveDB();
  }
  const out = { ...existing } as any; delete out.passwordHash; return res.json(out);
};

export const createReport: RequestHandler = (req, res) => {
  const { userId, userName, userEmail, imageDataUrl, location, description, isLikelyScreen } = req.body as Partial<Report> & { imageDataUrl?: string; isLikelyScreen?: boolean };
  if (!userId || !userEmail || !imageDataUrl || !description) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // deterministic image hash (simple djb2 over base64) for duplicate detection
  function hashStr(s: string) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
    return String(h >>> 0);
  }
  const imgHash = hashStr(imageDataUrl);

  // rate limiting: allow up to 10 reports per hour per user
  const now = Date.now();
  const recent = db.recentReports.get(userId) ?? [];
  const hourAgo = now - 60 * 60 * 1000;
  const filtered = recent.filter((t) => t >= hourAgo);
  filtered.push(now);
  db.recentReports.set(userId, filtered);

  let heuristicsSpam = 0;

  if (filtered.length > 10) heuristicsSpam = Math.max(heuristicsSpam, 0.9);

  // duplicate image check - make this a softer signal unless clearly duplicate by same user/time/location
  if (db.imageHashes.has(imgHash)) {
    const ids = db.imageHashes.get(imgHash) || [];
    let duplicateLikely = false;
    for (const rid of ids) {
      const existing = db.reports.get(rid);
      if (!existing) continue;
      // time proximity (1 hour) + same user suggests duplicate submission
      if (Math.abs((existing.createdAt || 0) - now) < 60 * 60 * 1000 && existing.userId === userId) { duplicateLikely = true; break; }
      // location proximity within 100 meters suggests same incident
      if (existing.location && location) {
        const d = haversineMeters(existing.location, location);
        if (d <= 100) { duplicateLikely = true; break; }
      }
    }
    if (duplicateLikely) heuristicsSpam = Math.max(heuristicsSpam, 0.95);
    else heuristicsSpam = Math.max(heuristicsSpam, 0.5); // soft flag
  }

  // text heuristics
  const txt = (description || "").toLowerCase();
  if (txt.length < 5) heuristicsSpam = Math.max(heuristicsSpam, 0.8);
  const spamWords = ["win money", "free bitcoin", "click here", "subscribe", "promo", "http://", "https://"];
  for (const w of spamWords) if (txt.includes(w)) heuristicsSpam = Math.max(heuristicsSpam, 1);

  // missing location increases spam likelihood
  if (!location) heuristicsSpam = Math.max(heuristicsSpam, 0.6);

  // run existing classifier; prefer provided categoryHint when present
  const { spam_score: baseSpam, category: autoCategory, priority: aiPriority } = aiClassify(description, imageDataUrl);
  const finalCategory = (req.body as any).categoryHint || autoCategory;

  // combine deterministically: take max of signals but also soften screen-photo flag
  let spam_score = Math.max(baseSpam, heuristicsSpam, isLikelyScreen ? 0.65 : 0);
  // If captureSource is camera, treat as low spam (20%) to avoid false positives
  if ((req.body as any).captureSource === 'camera') {
    spam_score = 0.2; // 20%
  } else {
    // trust camera capture source to reduce false positives (if not overriding)
    if ((req.body as any).captureSource === 'upload') spam_score = Math.max(0, spam_score - 0.15);
  }
  // if a fresh geolocation is present, trust it and reduce spam likelihood
  const finalSpam = location ? Math.max(0, spam_score - 0.25) : spam_score;

  const base: Report = {
    id: uid(),
    userId,
    userName: userName ?? "",
    userEmail,
    imageDataUrl,
    location: location ?? null,
    description,
    createdAt: now,
    status: "submitted",
    ai_category: finalCategory,
    spam_score: finalSpam,
    is_spam: null,
    priority: aiPriority,
    queue_order: null,
    validated_at: Date.now(),
    resolved_at: null,
    resolution_description: null,
    resolution_photos: [],
  };

  // deterministic thresholding (use finalSpam which accounts for location trust)
  if (finalSpam >= 0.9) {
    base.is_spam = true;
    base.status = "spam";
    base.priority = "Low";
  } else if (finalSpam >= 0.6) {
    // uncertain: send to manual review queue (treat as queued but mark spam flag)
    base.is_spam = true;
    base.status = "queued";
    base.queue_order = ++db.queueCounter;
    base.priority = "Low";
  } else {
    base.is_spam = false;
    base.status = "queued";
    base.queue_order = ++db.queueCounter;
  }

  // strengthen priority for critical categories
  if (!base.is_spam) {
    if (base.ai_category === "road_damage") base.priority = "High";
    if (txt.match(/\b(fire|accident|injur|collapse|flood)\b/)) base.priority = "High";
    if (base.ai_category === "garbage" || base.ai_category === "water") base.priority = "Medium";
  }

  // persist hash to help future duplicate checks
  const prev = db.imageHashes.get(imgHash) || [];
  prev.push(base.id);
  db.imageHashes.set(imgHash, prev);

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

    // When resolved by authority, clear spam flag to ensure it appears in transparency and user's list
    report.is_spam = false;
    report.spam_score = Math.min(report.spam_score ?? 0, 0.25);
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
    .filter((u) => u.role === 'citizen')
    .sort((a, b) => b.points - a.points)
    .slice(0, 20)
    .map((u) => ({ id: u.id, name: u.name, points: u.points, role: u.role }));
  res.json(users);
};
