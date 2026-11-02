"use client";

import Link from "next/link";
import { FormEvent, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Cpu,
  Eye,
  EyeOff,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { BrandLogo } from "@/components/itis-logo";

export function LoginForm({ systemLogoUrl }: { systemLogoUrl?: string | null }) {
  const router = useRouter();
  const [sessionEnded,setSessionEnded]=useState(false);
  // Read the external navigation reason after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{setSessionEnded(new URLSearchParams(window.location.search).get("session")==="ended");},[]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionStep, setConnectionStep] = useState(0);

  const connectionMessages = [
    "Opening secure channel",
    "Verifying your session",
    "Synchronizing AI workspace",
    "Connection established",
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Unable to sign in.");
        setLoading(false);
        return;
      }
      setConnecting(true);
      setConnectionStep(0);
      for (let step = 1; step < connectionMessages.length; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, 620));
        setConnectionStep(step);
      }
      await new Promise((resolve) => setTimeout(resolve, 520));
      router.replace("/");
      router.refresh();
    } catch {
      setError("Unable to reach the iTis server. Please try again.");
      setLoading(false);
      setConnecting(false);
    }
  }

  return (
    <section className="login-stage w-full max-w-[1180px]" aria-label="Sign in to iTis">
      {connecting && (
        <div className="login-connection" role="status" aria-live="polite">
          <div className="login-connection-grid" />
          <div className="login-connection-orb">
            <div className="login-connection-ring login-connection-ring-a" />
            <div className="login-connection-ring login-connection-ring-b" />
            <div className="login-connection-ring login-connection-ring-c" />
            <div className="login-connection-pulse" />
            <div className="login-connection-core">
              {connectionStep === 3 ? (
                <ShieldCheck className="size-8" />
              ) : (
                <Fingerprint className="size-8" />
              )}
            </div>
          </div>
          <div className="login-connection-copy">
            <div className="login-connection-code">ITIS / SECURE HANDSHAKE</div>
            <h2>{connectionMessages[connectionStep]}</h2>
            <div className="login-connection-progress">
              <span style={{ width: `${25 + connectionStep * 25}%` }} />
            </div>
            <div className="login-connection-meta">
              <span>ENCRYPTED</span>
              <span>{25 + connectionStep * 25}%</span>
            </div>
          </div>
        </div>
      )}
      <div className="login-frame">
        <div className="login-visual" aria-hidden="true">
          <div className="login-grid-plane" />
          <div className="login-radar-beam" />
          <div className="login-portal">
            <div className="login-orbit login-orbit-a"><i /></div>
            <div className="login-orbit login-orbit-b"><i /><i /></div>
            <div className="login-orbit login-orbit-c" />
            <div className="login-core-halo" />
            <div className="login-core"><BrandLogo src={systemLogoUrl} size={86} /></div>
          </div>
          <div className="login-visual-copy">
            <div className="login-kicker">
              <span className="login-live-dot" /> INTELLIGENCE SYSTEM ONLINE
            </div>
            <h1>One gateway.<br /><span>Every AI capability.</span></h1>
            <p>A private workspace connecting OpenAI and local models in one seamless experience.</p>
          </div>
          <div className="login-telemetry">
            <span><Cpu className="size-3.5" /> DUAL ENGINE</span>
            <span><ShieldCheck className="size-3.5" /> PRIVATE DATA</span>
            <span><Activity className="size-3.5" /> LIVE CONTEXT</span>
          </div>
        </div>

        <div className="login-panel">
          <div className="login-panel-scan" aria-hidden="true" />
          <form onSubmit={submit} className="login-form">
            <div className="login-brand">
              <div className="login-brand-mark"><BrandLogo src={systemLogoUrl} size={42} /></div>
              <div>
                <div className="text-[17px] font-semibold tracking-[-.02em]">iTis</div>
                <div className="text-[10px] uppercase tracking-[.22em] text-muted-foreground">Intelligence workspace</div>
              </div>
            </div>
            <div className="login-heading">
              <div className="login-eyebrow"><Fingerprint className="size-3.5" /> Secure access</div>
              <h2>Welcome back</h2>
              <p>Sign in to continue your private workspace.</p>
              {sessionEnded&&<p role="status" className="mt-3 text-sm text-primary">Your previous session ended. Please sign in again.</p>}
              <Link href="/forgot-password" className="mt-3 inline-block text-sm text-primary">Forgot password?</Link>
            </div>
            <div className="login-fields">
              <label className="login-field">
                <span>Email</span>
                <div className="login-input-wrap">
                  <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" inputMode="email" autoCapitalize="none" autoComplete="username" placeholder="name@company.com" required autoFocus />
                  <span className="login-input-corner" />
                </div>
              </label>
              <label className="login-field">
                <span>Password</span>
                <div className="login-input-wrap">
                  <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" required />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="login-password-toggle">
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </label>
            </div>
            {error && <div className="login-error" role="alert"><span />{error}</div>}
            <button disabled={loading} className="login-submit">
              <span className="login-submit-glow" />
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading ? <Sparkles className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
                {loading ? "Authenticating…" : "Open iTis workspace"}
                {!loading && <ArrowRight className="size-4" />}
              </span>
            </button>
            <div className="login-security-note"><ShieldCheck className="size-3.5" /> Your session is protected and stored privately on your system</div>
          </form>
        </div>
      </div>
      <div className="login-frame-corners" aria-hidden="true" />
    </section>
  );
}
