/**
 * Shared code between client and server
 * Useful to share types between client and server
 * and/or small pure JS functions that can be used on both client and server
 */

export type UserRole = "citizen" | "authority";

export interface User {
  id: string;
  name: string;
  email: string;
  photoURL?: string | null;
  phone?: string | null;
  role: UserRole;
  points: number;
  createdAt: number; // epoch ms
  passwordHash?: string | null;
}

export type ReportStatus =
  | "submitted"
  | "queued"
  | "processing"
  | "resolved"
  | "spam"
  | "rejected";

export interface Location {
  lat: number;
  lng: number;
}

export interface Report {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  imageDataUrl: string; // data URL to keep this repo self-contained; can be swapped for cloud storage later
  location: Location | null;
  description: string;
  createdAt: number; // epoch ms
  status: ReportStatus;
  ai_category?: string | null;
  spam_score?: number | null; // 0..1
  is_spam?: boolean | null;
  priority?: "Low" | "Medium" | "High" | null;
  queue_order?: number | null;
  validated_at?: number | null;
  resolved_at?: number | null;
  resolution_description?: string | null;
  resolution_photos?: string[]; // data URLs
  resolved_location?: Location | null;
  resolution_verified?: boolean;
}

export interface StatsResponse {
  totalReports: number;
  resolvedCount: number;
  resolutionRate: number; // 0..1
  averageResolutionHours: number | null;
}

export interface ApiError { error: string }

export interface DemoResponse {
  message: string;
}
