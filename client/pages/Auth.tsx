import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Auth() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetLabel = useMemo(() => {
    if (next === "/authority") return "Authority Login";
    if (next === "/citizen") return "Citizen Login";
    return "Sign In";
  }, [next]);

  useEffect(() => {
    if (user) nav(next);
  }, [user, next, nav]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login({ email, password, name: name || email.split("@")[0], phone });
      nav(next);
    } catch (err: any) {
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-md mx-auto px-4 pt-8">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" className="text-slate-600" onClick={() => nav("/")}>{/* left arrow */}
            <span className="sr-only">Back</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.293 16.293a1 1 0 010-1.414L15.586 11H4a1 1 0 110-2h11.586l-3.293-3.293a1 1 0 011.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
          </Button>
          <h1 className="text-lg font-semibold">{targetLabel}</h1>
        </div>

        <div className="bg-white border rounded-lg p-6 shadow-sm">
          <p className="text-sm text-slate-600 mb-4">
            Use email and password to continue. For authority access, sign up with an email ending in @gov.in or use admin@test.com.
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-700 mb-1">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <label className="block text-sm text-slate-700 mb-1">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" required />
            </div>
            <div>
              <label className="block text-sm text-slate-700 mb-1">Password</label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" type="password" required />
            </div>
            <div>
              <label className="block text-sm text-slate-700 mb-1">Phone (optional)</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <Button disabled={loading} className="w-full h-11 bg-slate-900 text-white">
              {loading ? "Please wait..." : "Continue"}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-slate-500 text-sm">
          Tip: Use an email ending with @gov.in or admin@test.com for Authority.
        </p>
      </div>
    </div>
  );
}
