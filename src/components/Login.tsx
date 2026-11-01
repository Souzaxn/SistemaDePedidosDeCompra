import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import tecarLogo from "../imports/image-1.png";

export default function Login() {
  const { signIn, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setError("");
  }, [email, password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || loading) return;
    setError("");
    setSubmitting(true);
    const err = await signIn(email.trim(), password);
    if (err) setError(err);
    setSubmitting(false);
  };

  return (
    <div className="login-page app-canvas min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="login-card w-full max-w-sm bg-white border border-slate-200">
        <div className="login-brand text-center">
          <span className="login-logo"><img src={tecarLogo} alt="Grupo Tecar" /></span>
          <h1 className="text-slate-900 text-xl font-bold tracking-tight">Pedidos de Compra</h1>
          <div className="login-subtitles">
            <p>02 - TECAR FIAT BSB W3</p>
            <p>SEP/N Quadra 512 Conjunto C · Brasília-DF</p>
          </div>
        </div>
        <div className="login-form-panel p-7">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">E-mail</label>
              <div className="login-input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 6.5 12 13l9-6.5M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z" /></svg>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  disabled={submitting}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Senha</label>
              <div className="login-input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 10V8a5 5 0 0 1 10 0v2m-9 10h8a3 3 0 0 0 3-3v-4a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3Z" /></svg>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={submitting}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition disabled:opacity-50"
                />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" strokeWidth="1.8" /></svg>
                </button>
              </div>
            </div>

            {error && (
              <p className="login-error text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg py-2.5 text-sm transition cursor-pointer disabled:cursor-not-allowed"
            >
              {submitting && <span className="button-spinner" />}
              {submitting ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
