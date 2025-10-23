import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Report } from "@shared/api";

export default function CitizenDashboard() {
  const { user, logout, refreshUser } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!user) nav("/auth?next=/citizen");
  }, [user, nav]);

  const [description, setDescription] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [isLikelyScreen, setIsLikelyScreen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [timestamp, setTimestamp] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const load = async () => {
      try {
        const r = await fetch('/api/reports');
        const all: Report[] = await r.json();
        if (mounted) setReports(all.filter((x) => x.userId === user.id));
      } catch {}
    };
    load();

    // Refresh local user info (points may have changed) periodically
    const iv = setInterval(() => { try { refreshUser(); } catch {} }, 5000);

    return () => { mounted = false; clearInterval(iv); };
  }, [user, refreshUser]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setLocation(null),
      );
    }
  }, []);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e: any) {
      setError("Camera access failed. You can upload from gallery instead.");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const detectScreenPhoto = async (dataUrl: string) => {
    try {
      const img = document.createElement("img");
      img.src = dataUrl;
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej();
      });
      const w = Math.min(400, img.naturalWidth);
      const h = Math.min(400, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      // Sample central region and compute brightness variance
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);
      const sample = 40;
      for (let y = cy - sample; y < cy + sample; y += 4) {
        if (y < 0 || y >= h) continue;
        for (let x = cx - sample; x < cx + sample; x += 4) {
          if (x < 0 || x >= w) continue;
          const idx = (y * w + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += lum;
          sumSq += lum * lum;
          count++;
        }
      }
      if (count === 0) return false;
      const mean = sum / count;
      const variance = sumSq / count - mean * mean;
      // Heuristic: screens tend to have high contrast and low texture variance in central area
      const isScreen = mean > 50 && mean < 220 && variance < 4000;
      return isScreen;
    } catch (e) {
      return false;
    }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setImageDataUrl(dataUrl);
    const flagged = await detectScreenPhoto(dataUrl);
    setIsLikelyScreen(!!flagged);
    setTimestamp(new Date().toLocaleString());
    stopCamera();
  };

  const onFile = async (file: File) => {
    const img = await file.arrayBuffer();
    const blob = new Blob([img], { type: "image/*" });
    const b = await blobToJpeg(blob);
    setImageDataUrl(b);
    const flagged = await detectScreenPhoto(b);
    setIsLikelyScreen(!!flagged);
    setTimestamp(new Date().toLocaleString());
  };

  const blobToJpeg = async (blob: Blob): Promise<string> => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(blob);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 1024;
    canvas.height = img.naturalHeight || 768;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const jpeg = canvas.toDataURL("image/jpeg", 0.9);
    URL.revokeObjectURL(url);
    return jpeg;
  };

  const submit = async () => {
    if (!user || !imageDataUrl || !description) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        imageDataUrl,
        description,
        location,
        isLikelyScreen,
      };
      const r = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("Submit failed");
      const rep: Report = await r.json();
      setReports((prev) => [rep, ...prev]);
      setDescription("");
      setImageDataUrl(null);
    } catch (e: any) {
      setError(e?.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const readableTime = useMemo(() => (timestamp ? timestamp : new Date().toLocaleString()), [timestamp]);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="text-slate-600" onClick={() => nav("/")}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.707 4.293a1 1 0 00-1.414 0L3.586 9h11.828a1 1 0 110 2H3.586l4.707 4.707a1 1 0 11-1.414 1.414l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
          </Button>
          <h1 className="text-xl font-bold">Citizen Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          {user && <span className="text-sm text-slate-600">{user.name} · {user.points} pts</span>}
          <Button variant="ghost" onClick={logout}>Sign out</Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-5 gap-8 pb-16">
        <div className="md:col-span-3 bg-white rounded-xl border p-4">
          <h2 className="font-semibold mb-2">Report an Issue</h2>
          <p className="text-sm text-slate-600 mb-4">Attach a photo. Location and time are captured automatically.</p>
          <div className="flex gap-3 flex-wrap mb-3">
            <Button onClick={startCamera}>Open Camera</Button>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files && onFile(e.target.files[0])} />
            </label>
          </div>
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-slate-100 rounded-lg overflow-hidden">
              {!imageDataUrl && <video ref={videoRef} className="w-full aspect-video bg-black" muted playsInline />}
              {imageDataUrl && <img src={imageDataUrl} alt="capture" className="w-full" />}
              <div className="p-2 flex items-center gap-2">
                {!imageDataUrl ? (
                  <Button size="sm" onClick={capturePhoto}>Capture</Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setImageDataUrl(null)}>Retake</Button>
                )}
                <span className="text-xs text-slate-600 ml-auto">{readableTime}</span>
              </div>
              {isLikelyScreen && (
                <div className="p-2 text-sm text-rose-600">Detected: photo of a screen/phone. AI will mark this as likely spam.</div>
              )}
            </div>
            <div>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue..." className="min-h-[220px]" />
              <div className="text-xs text-slate-600 mt-2">
                Location: {location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : "Not captured"}
              </div>
              <Button disabled={!imageDataUrl || !description || submitting} onClick={submit} className="mt-3 w-full">Submit Report</Button>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 bg-white rounded-xl border p-4">
          <h2 className="font-semibold mb-2">My Reports</h2>
          <div className="space-y-3">
            {reports.map((r) => (
              <div key={r.id} className="border rounded-lg overflow-hidden">
                <img src={r.imageDataUrl} alt="report" className="w-full aspect-video object-cover" />
                <div className="p-3">
                  <div className="text-sm font-medium">{r.description}</div>
                  <div className="text-xs text-slate-600 mt-1 flex gap-2 flex-wrap">
                    <span>Status: {r.status}</span>
                    {r.ai_category && <span>Category: {r.ai_category}</span>}
                    {r.priority && <span>Priority: {r.priority}</span>}
                    {typeof r.spam_score === 'number' && <span>Spam score: {Math.round(r.spam_score*100)}%</span>}
                  </div>
                </div>
              </div>
            ))}
            {reports.length === 0 && <div className="text-sm text-slate-600">No reports yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
