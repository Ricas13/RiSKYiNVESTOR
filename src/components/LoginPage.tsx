import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

export function LoginPage({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<unknown>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onLogin(username, password);
      window.history.replaceState({}, "", "/");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Login could not be completed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="brand-mark">RI</div>
          <div>
            <strong>Risky Investor</strong>
            <span>Private investment command centre</span>
          </div>
        </div>
        <div className="login-lock">
          <LockKeyhole size={26} />
        </div>
        <p className="eyebrow">Private access</p>
        <h1 id="login-title">Sign in to your dashboard</h1>
        <p className="login-copy">
          Strategy, trade and wealth data remain hidden until a valid secure session
          is established.
        </p>

        <form onSubmit={submit} className="login-form">
          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <div className="password-field">
              <input
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setVisible((current) => !current)}
                aria-label={visible ? "Hide password" : "Show password"}
              >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="button button--primary login-submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in securely"}
          </button>
        </form>

        <div className="login-security">
          <ShieldCheck size={17} />
          <span>HTTP-only session cookie · Credentials never enter the frontend bundle</span>
        </div>
      </section>
    </main>
  );
}
