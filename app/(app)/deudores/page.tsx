"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/pricing";
import { showToast } from "@/lib/toast";
import type { Debtor } from "@/lib/types";

type HistItem = {
  id: string;
  kind: "compra" | "venta";
  desc: string;
  date: string;
  amount: number;
};

export default function DeudoresPage() {
  const supabase = createClient();
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [history, setHistory] = useState<HistItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [{ data: deb }, { data: purchases }, { data: sales }] = await Promise.all([
      supabase.from("debtors").select("*").eq("paid", false).order("created_at", { ascending: false }),
      supabase.from("purchases").select("*").order("date", { ascending: false }).limit(10),
      supabase.from("sales").select("*").order("date", { ascending: false }).limit(10),
    ]);

    setDebtors((deb ?? []) as Debtor[]);

    const compras: HistItem[] = (purchases ?? []).map((p) => ({
      id: p.id,
      kind: "compra",
      desc: `Boleta agregada · ${p.item_count} producto${p.item_count === 1 ? "" : "s"}`,
      date: p.date,
      amount: p.amount,
    }));
    const ventas: HistItem[] = (sales ?? []).map((s) => ({
      id: s.id,
      kind: "venta",
      desc: `Venta · ${s.product_name} x${s.qty}`,
      date: s.date,
      amount: s.profit,
    }));
    const merged = [...compras, ...ventas].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);
    setHistory(merged);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function marcarPagado(d: Debtor) {
    await supabase.from("debtors").update({ paid: true }).eq("id", d.id);
    if (d.sale_id) {
      await supabase.from("sales").update({ paid: true }).eq("id", d.sale_id);
    }
    setDebtors((prev) => prev.filter((x) => x.id !== d.id));
    showToast(`Marcado como pagado: ${d.name}`);
  }

  return (
    <>
      <div className="eyebrow">{loading ? "Cargando…" : debtors.length === 0 ? "Deudores" : `${debtors.length} pendiente${debtors.length === 1 ? "" : "s"}`}</div>
      <div className="card">
        {debtors.length === 0 && !loading ? (
          <div className="empty">Nadie te debe por ahora ✓</div>
        ) : (
          debtors.map((d) => (
            <div className="debt-row" key={d.id}>
              <div className="row-left">
                <div className="icon-circle">🧾</div>
                <div>
                  <div className="p-name">{d.name}</div>
                  <div className="p-sub">{money(d.amount)}</div>
                </div>
              </div>
              <button className="btn btn-secondary" style={{ flex: "none" }} onClick={() => marcarPagado(d)}>
                Marcar pagado
              </button>
            </div>
          ))
        )}
      </div>

      <div className="eyebrow">Historial reciente</div>
      <div className="card">
        {history.length === 0 ? (
          <div className="empty">Todavía no hay movimientos.</div>
        ) : (
          history.map((h) => (
            <div className="hist-row" key={`${h.kind}-${h.id}`}>
              <div>
                <div className="p-name" style={{ fontSize: 13 }}>
                  {h.desc}
                </div>
                <div className="p-sub">{new Date(h.date).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
              </div>
              <div className={h.kind === "venta" ? "p-price" : "p-price"} style={{ color: h.kind === "venta" ? "#4f7c77" : "#b5473a" }}>
                {h.kind === "venta" ? "+" : "-"}
                {money(h.amount)}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
