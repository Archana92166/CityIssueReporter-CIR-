import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "@/components/ui/button";
import type { Report } from "@shared/api";
import { Textarea } from "@/components/ui/textarea";

export default function AuthorityDashboard() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!user) nav("/auth?next=/authority");
  }, [user, nav]);

  const isAuthority = user?.role === "authority";

  const [queued, setQueued] = useState<Report[]>([]);
  const [processing, setProcessing] = useState<Report[]>([]);
  const [resolved, setResolved] = useState<Report[]>([]);

  const load = async () => {
    try {
      const res = await fetch("/api/reports");
      if (!res.ok) throw new Error('Failed to load reports');
      const all: Report[] = await res.json();
      setQueued(all.filter((r) => r.status === "queued"));
      setProcessing(all.filter((r) => r.status === "processing"));
      setResolved(all.filter((r) => r.status === "resolved"));
    } catch (e) {
      console.error('Failed to load reports', e);
    }
  };

  useEffect(() => { load(); }, []);

  const setStatus = async (r: Report, status: Report["status"], resolution_description?: string, resolved_location?: { lat: number; lng: number }, resolution_photos?: string[]) => {
    try {
      const body: any = { status };
      if (resolution_description) body.resolution_description = resolution_description;
      if (resolved_location) body.resolved_location = resolved_location;
      if (Array.isArray(resolution_photos) && resolution_photos.length) body.resolution_photos = resolution_photos;
      const res = await fetch(`/api/reports/${r.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) console.error('Failed to update status', await res.text());
    } catch (e) {
      console.error('Failed to update status', e);
    }
    await load();
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="text-slate-600" onClick={() => nav("/")}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.707 4.293a1 1 0 00-1.414 0L3.586 9h11.828a1 1 0 110 2H3.586l4.707 4.707a1 1 0 11-1.414 1.414l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
          </Button>
          <h1 className="text-xl font-bold">Authority Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">{user.name} · {user.role}</span>
          <Button variant="ghost" onClick={logout}>Sign out</Button>
        </div>
      </div>

      {!isAuthority && (
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-xl border bg-white p-4 text-sm text-red-600">Access denied. Use an @gov.in email or admin@test.com to access this page.</div>
        </div>
      )}

      {isAuthority && (
        <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-3 gap-6 pb-16">
          <Column title="Queued" items={queued} actions={(r) => (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setStatus(r, "processing")}>Start</Button>
              <ResolveButton report={r} onResolve={(opts) => setStatus(r, "resolved", opts.text, opts.resolvedLocation, opts.resolutionPhotos)} />
            </div>
          )} />
          <Column title="Processing" items={processing} actions={(r) => (
            <div className="flex gap-2">
              <ResolveButton report={r} onResolve={(opts) => setStatus(r, "resolved", opts.text, opts.resolvedLocation, opts.resolutionPhotos)} />
            </div>
          )} />
          <Column title="Resolved" items={resolved} actions={() => null} />
        </div>
      )}
    </div>
  );
}

function Column({ title, items, actions }: { title: string; items: Report[]; actions: (r: Report) => React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="font-semibold mb-3">{title} ({items.length})</div>
      <div className="space-y-3">
        {items.map((r) => (
          <div key={r.id} className="border rounded-lg overflow-hidden">
            <img src={r.imageDataUrl} alt="report" className="w-full aspect-video object-cover" />
            <div className="p-3">
              <div className="text-sm font-medium">{r.description}</div>
              <div className="text-xs text-slate-600 mt-1 flex gap-2 flex-wrap">
                <span>Priority: {r.priority}</span>
                <span>Category: {r.ai_category}</span>
                <span>Spam: {typeof r.spam_score === 'number' ? `${Math.round(r.spam_score*100)}%` : '—'}</span>
              </div>
              <div className="mt-2">{actions(r)}</div>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-sm text-slate-600">No items.</div>}
      </div>
    </div>
  );
}

function ResolveButton({ report, onResolve }: { report: Report; onResolve: (opts: { text: string; resolvedLocation?: { lat: number; lng: number }; resolutionPhotos?: string[] }) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [lat, setLat] = useState<string>(report.location ? String(report.location.lat) : "");
  const [lng, setLng] = useState<string>(report.location ? String(report.location.lng) : "");
  const [photos, setPhotos] = useState<string[]>([]);

  const onFile = (f?: File) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotos((p) => [...p, reader.result as string]);
    };
    reader.readAsDataURL(f);
  };

  const removePhoto = (idx: number) => setPhotos((p) => p.filter((_, i) => i !== idx));

  const submit = () => {
    const loc = lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : (report.location ?? undefined);
    if (!loc) {
      // should not happen due to disabled button, but guard
      alert('Please provide a resolution location or use the report\'s existing location');
      return;
    }
    onResolve({ text, resolvedLocation: loc, resolutionPhotos: photos });
    setOpen(false);
    setPhotos([]);
    setText("");
  };

  return (
    <div>
      {!open ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Resolve</Button>
      ) : (
        <div className="flex flex-col gap-2 w-full">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Resolution notes" />
          <div className="flex gap-2">
            <input className="border rounded px-2 py-1 text-sm" placeholder="lat" value={lat} onChange={(e) => setLat(e.target.value)} />
            <input className="border rounded px-2 py-1 text-sm" placeholder="lng" value={lng} onChange={(e) => setLng(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-600">Add photo as proof (required)</label>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
            <div className="flex gap-2 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p} className="w-24 h-16 object-cover rounded border" alt={`photo-${i}`} />
                  <button className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-5 h-5 text-xs" onClick={() => removePhoto(i)}>×</button>
                </div>
              ))}
            </div>
            {!photos.length && <div className="text-xs text-red-600">At least one photo is required for resolution proof.</div>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={photos.length === 0 || !(lat || lng || report.location)}>Submit</Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setPhotos([]); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
