"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { showToast } from "@/lib/toast";
import { SETTINGS_PUBLIC_COLUMNS, defaultSettingsPublic, type SettingsPublic } from "@/lib/types";

export default function AjustesPage() {
  const supabase = createClient();
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase.from("settings").select(SETTINGS_PUBLIC_COLUMNS).eq("user_id", user.id).single();
    setSettings((data as SettingsPublic) ?? defaultSettingsPublic(user.id));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof SettingsPublic>(key: K, value: SettingsPublic[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function guardarReglas(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    // Ojo: nunca incluir gemini_key acá — esta pantalla solo maneja las
    // reglas de precio y el modelo, la clave se guarda por separado.
    const { error } = await supabase.from("settings").upsert({
      user_id: settings.user_id,
      low_max: settings.low_max,
      low_price: settings.low_price,
      mid_max: settings.mid_max,
      mid_percent: settings.mid_percent,
      mid_min_profit: settings.mid_min_profit,
      high_percent: settings.high_percent,
      rounding: settings.rounding,
      gemini_model: settings.gemini_model,
    });
    setSaving(false);
    if (error) {
      showToast("No se pudo guardar — intenta de nuevo");
      return;
    }
    showToast("Reglas guardadas ✓");
  }

  async function guardarClave() {
    if (!settings || !newKey.trim()) return;
    setSavingKey(true);
    const { error } = await supabase.from("settings").update({ gemini_key: newKey.trim() }).eq("user_id", settings.user_id);
    setSavingKey(false);
    if (error) {
      showToast("No se pudo guardar la clave — intenta de nuevo");
      return;
    }
    setNewKey("");
    setSettings((prev) => (prev ? { ...prev, gemini_key_set: true } : prev));
    showToast("Clave guardada ✓");
  }

  async function borrarClave() {
    if (!settings) return;
    if (!confirm("¿Borrar tu clave de Gemini? No podrás escanear boletas hasta que agregues una nueva.")) return;
    await supabase.from("settings").update({ gemini_key: null }).eq("user_id", settings.user_id);
    setSettings((prev) => (prev ? { ...prev, gemini_key_set: false } : prev));
    showToast("Clave eliminada");
  }

  async function borrarTodo() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    if (!confirm("Esto borra todos tus productos, ventas, compras y deudores. ¿Continuar?")) return;

    await Promise.all([
      supabase.from("products").delete().eq("user_id", user.id),
      supabase.from("sales").delete().eq("user_id", user.id),
      supabase.from("purchases").delete().eq("user_id", user.id),
      supabase.from("debtors").delete().eq("user_id", user.id),
    ]);
    showToast("Se borraron tus datos");
  }

  if (loading || !settings) {
    return <div className="empty">Cargando…</div>;
  }

  return (
    <>
      <form onSubmit={guardarReglas}>
        <div className="eyebrow">Reglas de precio</div>

        <div className="tier-row">
          <div className="th">Productos baratos</div>
          <div className="tier-inline">
            <span>Costo hasta</span>
            <input type="number" value={settings.low_max} onChange={(e) => set("low_max", parseFloat(e.target.value) || 0)} />
            <span>→ vender desde</span>
            <input type="number" value={settings.low_price} onChange={(e) => set("low_price", parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="tier-row">
          <div className="th">Productos medios</div>
          <div className="tier-inline">
            <span>Hasta</span>
            <input type="number" value={settings.mid_max} onChange={(e) => set("mid_max", parseFloat(e.target.value) || 0)} />
            <span>→ margen</span>
            <input type="number" value={settings.mid_percent} onChange={(e) => set("mid_percent", parseFloat(e.target.value) || 0)} />
            <span>% · ganancia mín. $</span>
            <input type="number" value={settings.mid_min_profit} onChange={(e) => set("mid_min_profit", parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="tier-row">
          <div className="th">Productos caros</div>
          <div className="tier-inline">
            <span>Más de ese monto →</span>
            <input type="number" value={settings.high_percent} onChange={(e) => set("high_percent", parseFloat(e.target.value) || 0)} />
            <span>% margen</span>
          </div>
        </div>

        <label className="field-label">Redondeo de precio final</label>
        <select value={settings.rounding} onChange={(e) => set("rounding", e.target.value as SettingsPublic["rounding"])}>
          <option value="990">Terminación .990</option>
          <option value="500">Terminación .500</option>
          <option value="none">Sin redondeo</option>
        </select>

        <button className="btn btn-primary btn-block" type="submit" disabled={saving}>
          {saving ? "Guardando…" : "Guardar reglas"}
        </button>
        <div className="callout" style={{ marginTop: 12 }}>
          Estas reglas solo sugieren el precio — siempre puedes cambiarlo a mano al vender o al agregar una boleta.
        </div>
      </form>

      <div className="eyebrow">IA para leer boletas (Gemini, gratis)</div>
      <div className="card">
        <div className="callout" style={{ marginBottom: 14 }}>
          {settings.gemini_key_set ? "Ya tienes una clave guardada ✓ (no se muestra por seguridad)." : "Todavía no has guardado una clave."}
        </div>

        <label className="field-label">{settings.gemini_key_set ? "Reemplazar por una clave nueva" : "Tu clave de API de Gemini"}</label>
        <input
          type="password"
          placeholder="Pega tu clave aquí"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <button className="btn btn-primary btn-block" onClick={guardarClave} disabled={savingKey || !newKey.trim()} type="button">
          {savingKey ? "Guardando…" : "Guardar clave"}
        </button>
        {settings.gemini_key_set && (
          <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={borrarClave} type="button">
            Eliminar clave guardada
          </button>
        )}

        <label className="field-label" style={{ marginTop: 14 }}>
          Modelo
        </label>
        <input type="text" value={settings.gemini_model} onChange={(e) => set("gemini_model", e.target.value)} onBlur={guardarReglas} />
        <div className="callout">
          Consíguela gratis en <b>aistudio.google.com</b> (botón &ldquo;Get API key&rdquo;), sin tarjeta. Queda guardada solo en tu cuenta y nunca se muestra de nuevo en pantalla.
        </div>
      </div>

      <div className="eyebrow">Datos</div>
      <button className="btn btn-ghost btn-block" onClick={borrarTodo}>
        Borrar todos mis datos
      </button>
    </>
  );
}
