import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { StatsResponse } from "@shared/api";
import { useAuth } from "../context/AuthContext";

export default function Index() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  const goAuth = (next: string) => nav(`/auth?next=${encodeURIComponent(next)}`);

    return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <img src="/favicon.ico" alt="CityIssueReporter" className="h-10 w-10 rounded-lg object-contain" />
          <span className="font-semibold tracking-tight text-lg">CityIssueReporter</span>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden sm:block text-sm text-slate-600">{user.name} · {user.role} · {user.points} pts</span>
              <Button variant="ghost" className="text-slate-700 border" onClick={logout}>Sign out</Button>
            </>
          ) : (
            <Button className="bg-slate-900 text-white" onClick={() => goAuth("/citizen")}>Sign in</Button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-24 pt-8">
        <section className="bg-white border rounded-2xl p-8 shadow">
          <div className="grid md:grid-cols-5 gap-10 items-center">
            <div className="md:col-span-3">
              <h1 className="text-3xl md:text-4xl font-extrabold leading-tight">Report issues. Get them resolved.</h1>
              <p className="mt-4 text-slate-600 max-w-prose">A calm, clean civic platform — AI-assisted reporting and transparent resolution.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button className="bg-primary text-primary-foreground" onClick={() => goAuth("/citizen")}>Citizen Dashboard</Button>
                <Button className="bg-secondary text-secondary-foreground" onClick={() => goAuth("/authority")}>Authority Dashboard</Button>
                <Button variant="outline" className="text-slate-700" onClick={() => nav("/transparency")}>Transparency</Button>
              </div>
              <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <Stat value={stats ? String(stats.totalReports) : "—"} label="Reports" />
                <Stat value={stats ? String(stats.resolvedCount) : "—"} label="Resolved" />
                <Stat value={stats ? `${Math.round((stats.resolutionRate||0)*100)}%` : "—"} label="Resolution rate" />
                <Stat value={stats?.averageResolutionHours != null ? `${Math.round(stats.averageResolutionHours)}h` : "—"} label="Avg. time" />
              </div>
            </div>
            <div className="md:col-span-2">
              <div className="aspect-[4/5] rounded-2xl border bg-slate-50 overflow-hidden relative flex items-center justify-center">
                <img src="/placeholder.webp" alt="City issue reporting" className="max-w-full max-h-full object-contain p-6" />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10 grid md:grid-cols-3 gap-6">
          <Block title="Citizen Dashboard" desc="Report issues with photo, GPS and time. AI handles spam and prioritization." onClick={() => goAuth("/citizen")} />
          <Block title="Authority Dashboard" desc="Auto-sorted queue by AI priority. Process, resolve, and notify citizens." onClick={() => goAuth("/authority")} />
          <Block title="Transparency" desc="Public map of resolved reports, stats and progress." onClick={() => nav("/transparency")} />
        </section>
      </main>

      <footer className="text-center text-slate-500 py-8">© {new Date().getFullYear()} CityIssueReporter</footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-slate-600">{label}</div>
    </div>
  );
}

function Block({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group text-left rounded-2xl border bg-white p-6 hover:shadow transition">
      <div className="text-slate-900 text-lg font-semibold flex items-center justify-between">
        {title}
        <span className="text-slate-400 group-hover:translate-x-1 transition">→</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{desc}</p>
    </button>
  );
}
