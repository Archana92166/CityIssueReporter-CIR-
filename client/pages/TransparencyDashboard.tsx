import { useEffect, useRef, useState } from "react";
import type { Report } from "@shared/api";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const GOOGLE_MAPS_KEY = "AIzaSyAiYX_C4-Nhq2JoPUY8V5qkbjAjM4Juq3k";

function loadGMaps(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('No window'));
    if ((window as any).google && (window as any).google.maps) return resolve();
    const id = 'gmaps-script';
    if (document.getElementById(id)) {
      const check = setInterval(() => {
        if ((window as any).google && (window as any).google.maps) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => { clearInterval(check); reject(new Error('Timeout loading Google Maps')); }, 15000);
      return;
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(s);
  });
}

export default function TransparencyDashboard() {
  const nav = useNavigate();
  const [resolved, setResolved] = useState<Report[]>([]);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());

  const [processing, setProcessing] = useState<Report[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadReports = async () => {
      try {
        setFetchError(null);
        const r = await fetch('/api/reports');
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const data: Report[] = await r.json();
        if (!mounted) return;
        setResolved(data.filter((d) => d.status === 'resolved'));
        setProcessing(data.filter((d) => d.status === 'processing'));
      } catch (e: any) {
        console.error('Failed to load reports', e);
        if (mounted) setFetchError(String(e.message || e));
      }
    };

    const init = async () => {
      try {
        await loadGMaps();
        if (!mounted) return;
        if (mapRef.current && !(mapInstance.current)) {
          const center = { lat: 20.5937, lng: 78.9629 };
          mapInstance.current = new (window as any).google.maps.Map(mapRef.current, { zoom: 5, center });
        }
        await loadReports();
        const iv = setInterval(loadReports, 5000);
        // reload when other parts of the UI notify of updates (e.g., authority resolved)
        const onUpdated = () => { loadReports().catch(() => {}); };
        window.addEventListener('reports:updated', onUpdated);
        return () => { clearInterval(iv); window.removeEventListener('reports:updated', onUpdated); };
      } catch (e) {
        console.error('Failed to init map', e);
        if (mounted) setFetchError('Failed to initialize map');
      }
    };

    const t = init();
    return () => { mounted = false; };
  }, []);

  // Update markers when resolved or processing changes
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const gm = (window as any).google.maps;
    const markers = markersRef.current;

    const all = [...resolved, ...processing];
    const keepIds = new Set(all.map((r) => r.id));

    // Remove markers not present
    for (const id of Array.from(markers.keys())) {
      if (!keepIds.has(id)) {
        const m = markers.get(id);
        m.setMap(null);
        markers.delete(id);
      }
    }

    function createIcon(status: string) {
      if (status === 'resolved') {
        return {
          path: gm.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#10B981',
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: '#ffffff',
        };
      }
      return {
        path: gm.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#F59E0B',
        fillOpacity: 1,
        strokeWeight: 2,
        strokeColor: '#ffffff',
      };
    }

    for (const r of all) {
      const loc = (r as any).resolved_location ?? r.location;
      if (!loc) continue;
      const pos = { lat: loc.lat, lng: loc.lng } as any;
      if (markers.has(r.id)) {
        const m = markers.get(r.id);
        m.setPosition(pos);
        m.setIcon(createIcon(r.status));
      } else {
        const marker = new gm.Marker({ position: pos, map, title: r.description, icon: createIcon(r.status) });
        const iw = new gm.InfoWindow({ content: buildInfoWindowContent(r) });
        marker.addListener('click', () => iw.open({ anchor: marker, map }));
        markers.set(r.id, marker);
      }
    }
  }, [resolved, processing]);

  function buildInfoWindowContent(r: Report) {
    const div = document.createElement('div');
    div.style.minWidth = '220px';
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '6px';
    title.textContent = r.description;
    div.appendChild(title);
    if (r.resolution_description) {
      const d = document.createElement('div');
      d.style.fontSize = '12px';
      d.style.marginBottom = '6px';
      d.textContent = `Resolution: ${r.resolution_description}`;
      div.appendChild(d);
    }
    if (Array.isArray(r.resolution_photos) && r.resolution_photos.length) {
      const pic = document.createElement('img');
      pic.src = r.resolution_photos[0];
      pic.style.width = '100%';
      pic.style.borderRadius = '6px';
      div.appendChild(pic);
    } else if (r.imageDataUrl) {
      const pic = document.createElement('img');
      pic.src = r.imageDataUrl;
      pic.style.width = '100%';
      pic.style.borderRadius = '6px';
      div.appendChild(pic);
    }
    return div;
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="text-slate-600" onClick={() => nav("/")}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.707 4.293a1 1 0 00-1.414 0L3.586 9h11.828a1 1 0 110 2H3.586l4.707 4.707a1 1 0 11-1.414 1.414l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
          </Button>
          <h1 className="text-xl font-bold">Transparency Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => nav("/")}>Home</Button>
          <Button variant="ghost" onClick={() => nav(`/auth?next=/transparency`)}>Login</Button>
        </div>
      </div>

      {fetchError && (
        <div className="max-w-6xl mx-auto px-6">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 mb-4">Failed to load reports: {fetchError}. Please check server or try again later.</div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-3 gap-6 pb-16">
        <div className="lg:col-span-2 bg-white rounded-xl border p-4">
          <div className="font-semibold mb-2">Map</div>
          <div ref={mapRef} className="relative h-[480px] rounded-lg overflow-hidden bg-white" />
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Locations</div>
            <div className="text-sm text-slate-500">Processing: {processing.length} · Resolved: {resolved.length}</div>
          </div>
          <div className="space-y-3 max-h-[320px] overflow-auto pr-2">
            {[...processing, ...resolved].map((r) => {
              const displayPic = Array.isArray((r as any).resolution_photos) && (r as any).resolution_photos.length ? (r as any).resolution_photos[0] : r.imageDataUrl;
              return (
                <div key={r.id} className="border rounded-lg overflow-hidden">
                  <img src={displayPic} alt="report" className="w-full aspect-video object-cover" />
                  <div className="p-3 flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium">{r.description}</div>
                      <div className="text-xs text-slate-600 mt-1">Status: <span className={`px-2 py-0.5 rounded text-white text-[11px] ${r.status === 'resolved' ? 'bg-emerald-600' : 'bg-amber-500'}`}>{r.status}</span></div>
                      {r.resolution_description && <div className="text-xs text-slate-600 mt-1">Resolution: {r.resolution_description}</div>}
                      <div className="text-xs text-slate-500 mt-1">Reporter: {r.userName} · <span className="font-medium">{(r as any).reporter_points ?? '—'} pts</span></div>
                    </div>
                    <div className="text-xs text-slate-400">{((r as any).resolved_location ?? r.location) ? `${(((r as any).resolved_location ?? r.location).lat).toFixed(3)}, ${(((r as any).resolved_location ?? r.location).lng).toFixed(3)}` : 'No location'}</div>
                  </div>
                </div>
              );
            })}
            {processing.length + resolved.length === 0 && <div className="text-sm text-slate-600">No locations yet.</div>}
          </div>

        </div>
      </div>
    </div>
  );
}
