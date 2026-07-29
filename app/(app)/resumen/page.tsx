import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/pricing";
import type { Product, Debtor } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ResumenPage() {
  const supabase = await createClient();

  const [{ data: products }, { data: sales }, { data: purchases }, { data: debtors }] = await Promise.all([
    supabase.from("products").select("*").order("name"),
    supabase.from("sales").select("profit"),
    supabase.from("purchases").select("amount"),
    supabase.from("debtors").select("*").eq("paid", false).order("created_at", { ascending: false }),
  ]);

  const productList = (products ?? []) as Product[];
  const debtorList = (debtors ?? []) as Debtor[];

  const gananciaVentas = (sales ?? []).reduce((a, s) => a + (Number(s.profit) || 0), 0);
  const gastos = (purchases ?? []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const inventarioValor = productList.reduce((a, p) => a + p.cost * p.stock, 0);

  const bajoStock = productList.filter((p) => p.stock <= 2).slice(0, 2);
  const deudoresAlerta = debtorList.slice(0, 2);

  return (
    <>
      <div className="ledger-card">
        <div className="row">
          <span className="label">Ganancia por ventas registradas</span>
          <span className="num num-pos">+{money(gananciaVentas)}</span>
        </div>
        <div className="row">
          <span className="label">Gastos (compras + viajes)</span>
          <span className="num num-neg">-{money(gastos)}</span>
        </div>
        <div className="row">
          <span className="label">Inventario valorizado</span>
          <span className="num">{money(inventarioValor)}</span>
        </div>
        <div className="row">
          <span className="label">Saldo</span>
          <span className="num total">{money(gananciaVentas)}</span>
        </div>
      </div>

      <div className="quick-actions">
        <Link href="/escanear" className="btn btn-primary" style={{ flex: 1 }}>
          📷 Escanear boleta
        </Link>
        <Link href="/vender" className="btn btn-secondary">
          Registrar venta
        </Link>
      </div>

      {bajoStock.map((p) => (
        <div className="alert-card" key={p.id}>
          ⚠️ Queda{p.stock === 1 ? "" : "n"} {p.stock} unidad{p.stock === 1 ? "" : "es"} de &ldquo;{p.name}&rdquo; — stock bajo
        </div>
      ))}
      {deudoresAlerta.map((d) => (
        <div className="alert-card" key={d.id}>
          🕒 {d.name} te debe {money(d.amount)}
        </div>
      ))}

      <div className="eyebrow">Precios de tus productos</div>
      <div className="card">
        {productList.length === 0 ? (
          <div className="empty">Aún no tienes productos. Escanea una boleta para empezar.</div>
        ) : (
          productList.map((p) => (
            <div className="price-row" key={p.id}>
              <div className="row-left">
                <div className="icon-circle">📦</div>
                <div>
                  <div className="p-name">{p.name}</div>
                  <div className="p-sub">
                    {p.category ? `${p.category} · ` : ""}Stock: {p.stock}
                  </div>
                </div>
              </div>
              <div className="p-price">{money(p.price)}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
