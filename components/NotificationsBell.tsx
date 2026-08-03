"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/pricing";
import type { Debtor } from "@/lib/types";

type Alert = { key: string; icon: string; text: string; href: string };

export default function NotificationsBell() {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  async function loadAlerts() {
    const [{ data: products }, { data: debtors }] = await Promise.all([
      supabase.from("products").select("id, name, stock").lte("stock", 2),
      supabase.from("debtors").select("*").eq("paid", false),
    ]);

    const list: Alert[] = [];

    for (const p of (products ?? []) as { id: string; name: string; stock: number }[]) {
      list.push({
        key: `stock-${p.id}`,
        icon: "⚠️",
        text: `Queda${p.stock === 1 ? "" : "n"} ${p.stock} unidad${p.stock === 1 ? "" : "es"} de "${p.name}" — stock bajo`,
        href: "/inventario",
      });
    }

    for (const d of (debtors ?? []) as Debtor[]) {
      const rem = Math.max(0, d.amount - d.paid_amount);
      if (rem <= 0) continue; // por si quedó paid_amount al día pero paid aún no se marcó
      list.push({ key: `debt-${d.id}`, icon: "🕒", text: `${d.name} te debe ${money(rem)}`, href: "/deudores" });
    }

    setAlerts(list);
    setLoaded(true);
  }

  // Carga inicial silenciosa, solo para mostrar el numerito en la campana.
  useEffect(() => {
    loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Siempre trae datos frescos al abrir — así nunca queda una alerta pegada
    // después de pagar una deuda o reponer stock en otra pantalla.
    if (next) loadAlerts();
  }

  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="bell-btn" onClick={toggle} aria-label="Notificaciones">
        🔔
        {alerts.length > 0 && <span className="bell-badge">{alerts.length > 9 ? "9+" : alerts.length}</span>}
      </button>

      {open && (
        <>
          <div className="bell-backdrop" onClick={() => setOpen(false)} />
          <div className="bell-panel">
            <div className="bell-panel-title">Notificaciones</div>
            {!loaded ? (
              <div className="empty">Cargando…</div>
            ) : alerts.length === 0 ? (
              <div className="empty">Todo al día ✓</div>
            ) : (
              alerts.map((a) => (
                <Link href={a.href} key={a.key} className="bell-item" onClick={() => setOpen(false)}>
                  <span>{a.icon}</span>
                  <span>{a.text}</span>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
