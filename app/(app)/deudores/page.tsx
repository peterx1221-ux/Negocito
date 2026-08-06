"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/pricing";
import { showToast } from "@/lib/toast";
import { normalizeText } from "@/lib/search";
import type { Debtor } from "@/lib/types";

type HistItem = {
  id: string;
  kind: "compra" | "venta";
  desc: string;
  date: string;
  amount: number;
};

/** Deudor enriquecido con el detalle del producto de esa venta (si existe). */
type DebtorWithSale = Debtor & {
  product_name?: string;
  qty?: number;
  unit_price?: number;
};

function remaining(d: Debtor): number {
  return Math.max(0, d.amount - d.paid_amount);
}

export default function DeudoresPage() {
  const supabase = createClient();
  const router = useRouter();
  const [debtors, setDebtors] = useState<DebtorWithSale[]>([]);
  const [history, setHistory] = useState<HistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [abonandoId, setAbonandoId] = useState<string | null>(null);
  const [abonoValue, setAbonoValue] = useState("");
  const [abonandoProfile, setAbonandoProfile] = useState<string | null>(null);
  const [abonoProfileValue, setAbonoProfileValue] = useState("");
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());

  async function load() {
    const [{ data: deb }, { data: purchases }, { data: sales }] = await Promise.all([
      supabase.from("debtors").select("*").eq("paid", false).order("created_at", { ascending: false }),
      supabase.from("purchases").select("*").order("date", { ascending: false }).limit(10),
      supabase.from("sales").select("*").order("date", { ascending: false }).limit(10),
    ]);

    const debtorList = (deb ?? []) as Debtor[];
    const saleIds = debtorList.map((d) => d.sale_id).filter((id): id is string => !!id);

    const salesById: Record<string, { product_name: string; qty: number; unit_price: number }> = {};
    if (saleIds.length > 0) {
      const { data: linkedSales } = await supabase.from("sales").select("id, product_name, qty, unit_price").in("id", saleIds);
      for (const s of linkedSales ?? []) salesById[s.id] = s;
    }

    const enriched: DebtorWithSale[] = debtorList.map((d) => ({
      ...d,
      ...(d.sale_id && salesById[d.sale_id] ? salesById[d.sale_id] : {}),
    }));
    setDebtors(enriched);

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

  // Agrupa por nombre (ignorando tildes/mayúsculas) — así alguien con más de una
  // deuda pendiente aparece como un solo "perfil" con el detalle de cada producto.
  const groups = useMemo(() => {
    const map = new Map<string, DebtorWithSale[]>();
    for (const d of debtors) {
      const key = normalizeText(d.name);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.values());
  }, [debtors]);

  async function registrarAbono(d: DebtorWithSale) {
    const amount = parseFloat(abonoValue);
    if (!amount || amount <= 0) return;

    const nuevoPagado = Math.min(d.paid_amount + amount, d.amount);
    const quedaPagado = nuevoPagado >= d.amount;

    const { error } = await supabase.from("debtors").update({ paid_amount: nuevoPagado, paid: quedaPagado }).eq("id", d.id);
    if (error) {
      showToast(`No se pudo guardar el abono: ${error.message}`);
      return;
    }

    if (quedaPagado && d.sale_id) {
      const { error: saleError } = await supabase.from("sales").update({ paid: true }).eq("id", d.sale_id);
      if (saleError) showToast(`Abono guardado, pero la venta no se actualizó: ${saleError.message}`);
    }

    if (quedaPagado) {
      setDebtors((prev) => prev.filter((x) => x.id !== d.id));
      showToast(`Deuda de ${d.name} pagada por completo ✓`);
    } else {
      setDebtors((prev) => prev.map((x) => (x.id === d.id ? { ...x, paid_amount: nuevoPagado } : x)));
      showToast(`Abono de ${money(amount)} registrado`);
    }
    setAbonandoId(null);
    setAbonoValue("");
    router.refresh();
  }

  async function marcarPagado(d: DebtorWithSale) {
    const { error } = await supabase.from("debtors").update({ paid: true, paid_amount: d.amount }).eq("id", d.id);
    if (error) {
      showToast(`No se pudo marcar como pagado: ${error.message}`);
      return;
    }
    if (d.sale_id) {
      const { error: saleError } = await supabase.from("sales").update({ paid: true }).eq("id", d.sale_id);
      if (saleError) showToast(`Deuda marcada como pagada, pero la venta no se actualizó: ${saleError.message}`);
    }
    setDebtors((prev) => prev.filter((x) => x.id !== d.id));
    showToast(`Marcado como pagado: ${d.name}`);
    router.refresh();
  }

  /**
   * Abono "a la deuda total": un monto suelto (lo que se pueda) que se reparte
   * solo entre todas las deudas pendientes de esa persona, de la más antigua a
   * la más nueva, en vez de tener que calzar el monto exacto de un producto.
   */
  async function registrarAbonoPerfil(group: DebtorWithSale[], amountStr: string) {
    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) return;

    const ordenadas = [...group].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    let restante = amount;
    const updates: { id: string; sale_id: string | null; paid_amount: number; paid: boolean }[] = [];

    for (const d of ordenadas) {
      if (restante <= 0) break;
      const deudaLinea = remaining(d);
      if (deudaLinea <= 0) continue;
      const pago = Math.min(deudaLinea, restante);
      const nuevoPagado = d.paid_amount + pago;
      updates.push({ id: d.id, sale_id: d.sale_id, paid_amount: nuevoPagado, paid: nuevoPagado >= d.amount });
      restante -= pago;
    }

    const fallidas: string[] = [];
    const exitosas: typeof updates = [];

    for (const u of updates) {
      const { error } = await supabase.from("debtors").update({ paid_amount: u.paid_amount, paid: u.paid }).eq("id", u.id);
      if (error) {
        fallidas.push(u.id);
        continue;
      }
      exitosas.push(u);
      if (u.paid && u.sale_id) {
        await supabase.from("sales").update({ paid: true }).eq("id", u.sale_id);
      }
    }

    if (fallidas.length > 0) {
      showToast(`Ojo: ${fallidas.length} de ${updates.length} líneas no se pudieron guardar — revisa los permisos de la tabla "debtors"`);
    }

    setDebtors((prev) => {
      const mapped = prev.map((x) => {
        const u = exitosas.find((up) => up.id === x.id);
        return u ? { ...x, paid_amount: u.paid_amount, paid: u.paid } : x;
      });
      return mapped.filter((x) => !x.paid);
    });

    const completas = exitosas.filter((u) => u.paid).length;
    if (restante > 0) {
      showToast(`Abono de ${money(amount)} aplicado — sobraron ${money(restante)}, ya no tenía más deuda que cubrir`);
    } else if (completas > 0) {
      showToast(`Abono de ${money(amount)} aplicado — ${completas} deuda${completas === 1 ? "" : "s"} quedó${completas === 1 ? "" : "aron"} pagada${completas === 1 ? "" : "s"} por completo`);
    } else {
      showToast(`Abono de ${money(amount)} aplicado a la deuda más antigua`);
    }

    setAbonandoProfile(null);
    setAbonoProfileValue("");
    router.refresh();
  }

  function toggleProfile(key: string) {
    setExpandedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderLine(d: DebtorWithSale, showName: boolean) {
    const rem = remaining(d);
    const detail = d.product_name
      ? `${d.product_name}${d.qty ? ` x${d.qty}` : ""}${d.unit_price ? ` · ${money(d.unit_price)} c/u` : ""}`
      : null;

    return (
      <div className="debt-row" key={d.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div className="row-left">
            <div className="icon-circle">🧾</div>
            <div>
              <div className="p-name">{showName ? d.name : detail ?? d.name}</div>
              <div className="p-sub">
                {showName && detail ? detail + " · " : ""}
                {d.paid_amount > 0 ? `Abonado ${money(d.paid_amount)} · queda ${money(rem)}` : `Debe ${money(rem)}`}
              </div>
            </div>
          </div>
          <div className="p-price">{money(rem)}</div>
        </div>

        {abonandoId === d.id ? (
          <div className="quick-actions" style={{ marginTop: 8 }}>
            <input
              type="number"
              autoFocus
              placeholder="Monto del abono"
              value={abonoValue}
              onChange={(e) => setAbonoValue(e.target.value)}
              style={{ flex: 1, marginBottom: 0 }}
            />
            <button className="btn btn-primary" style={{ flex: "none" }} onClick={() => registrarAbono(d)}>
              Confirmar
            </button>
            <button
              className="btn btn-ghost"
              style={{ flex: "none" }}
              onClick={() => {
                setAbonandoId(null);
                setAbonoValue("");
              }}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="quick-actions" style={{ marginTop: 8 }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={() => {
                setAbonandoId(d.id);
                setAbonoValue("");
              }}
            >
              Abonar
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => marcarPagado(d)}>
              Pagar todo
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="eyebrow">{loading ? "Cargando…" : debtors.length === 0 ? "Deudores" : `${debtors.length} pendiente${debtors.length === 1 ? "" : "s"}`}</div>

      {debtors.length === 0 && !loading ? (
        <div className="card">
          <div className="empty">Nadie te debe por ahora ✓</div>
        </div>
      ) : (
        groups.map((group) => {
          if (group.length === 1) {
            return (
              <div className="card" key={group[0].id}>
                {renderLine(group[0], true)}
              </div>
            );
          }

          const totalRemaining = group.reduce((sum, d) => sum + remaining(d), 0);
          const profileKey = normalizeText(group[0].name);
          const isExpanded = expandedProfiles.has(profileKey);
          const productPreview = group.map((d) => d.product_name || d.name).join(", ");

          return (
            <div className="card" key={profileKey}>
              <button
                type="button"
                onClick={() => toggleProfile(profileKey)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: "var(--ink-soft)", flexShrink: 0 }}>{isExpanded ? "▾" : "▸"}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="p-name" style={{ fontSize: 15 }}>👤 {group[0].name}</div>
                    {!isExpanded && (
                      <div
                        className="p-sub"
                        style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {productPreview}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <div className="badge">{group.length} productos</div>
                  <div className="p-price">{money(totalRemaining)}</div>
                </div>
              </button>

              {isExpanded && (
                <>
                  <div className="p-sub" style={{ margin: "10px 0" }}>
                    Debe en total: <strong>{money(totalRemaining)}</strong>
                  </div>

                  {abonandoProfile === profileKey ? (
                    <div className="quick-actions" style={{ marginBottom: 12 }}>
                      <input
                    type="number"
                    autoFocus
                    placeholder="Monto — lo que se pueda"
                    value={abonoProfileValue}
                    onChange={(e) => setAbonoProfileValue(e.target.value)}
                    style={{ flex: 1, marginBottom: 0 }}
                  />
                  <button className="btn btn-primary" style={{ flex: "none" }} onClick={() => registrarAbonoPerfil(group, abonoProfileValue)}>
                    Confirmar
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ flex: "none" }}
                    onClick={() => {
                      setAbonandoProfile(null);
                      setAbonoProfileValue("");
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-secondary btn-block"
                  style={{ marginBottom: 12 }}
                  onClick={() => {
                    setAbonandoProfile(profileKey);
                    setAbonoProfileValue("");
                  }}
                >
                  💰 Abonar a la deuda total
                </button>
              )}

              <div className="callout" style={{ marginBottom: 10 }}>
                Este abono se reparte solo entre sus deudas, de la más antigua a la más nueva. Si prefieres pagar un producto específico, usa el botón "Abonar" de esa línea.
              </div>

              {group.map((d) => renderLine(d, false))}
                </>
              )}
            </div>
          );
        })
      )}

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
