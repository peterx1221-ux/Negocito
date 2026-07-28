"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        setError(traducirError(error.message));
        return;
      }
      router.push("/resumen");
      router.refresh();
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      setLoading(false);
      if (error) {
        setError(traducirError(error.message));
        return;
      }
      setNotice("Cuenta creada. Si tu proyecto pide confirmar el correo, revisa tu bandeja de entrada y luego inicia sesión.");
      setMode("login");
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Cuaderno</h1>
        <div className="sub">
          {mode === "login" ? "Entra a tu cuenta para ver tu negocio." : "Crea tu cuenta — tus datos quedan solo para ti."}
        </div>

        {error && <div className="callout callout-error">{error}</div>}
        {notice && <div className="callout">{notice}</div>}

        <form onSubmit={handleSubmit}>
          <label className="field-label">Correo</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tucorreo@ejemplo.com"
          />
          <label className="field-label">Contraseña</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
          />
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? "Un momento…" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </form>

        <div className="auth-toggle">
          {mode === "login" ? (
            <>
              ¿No tienes cuenta?{" "}
              <button onClick={() => { setMode("signup"); setError(null); }}>Crear una</button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button onClick={() => { setMode("login"); setError(null); }}>Iniciar sesión</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function traducirError(msg: string): string {
  if (msg.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (msg.includes("User already registered")) return "Ya existe una cuenta con ese correo.";
  if (msg.includes("Password should be")) return "La contraseña debe tener al menos 6 caracteres.";
  return msg;
}
