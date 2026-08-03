import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/pricing";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

type SaleRow = {
  product_id: string | null;
  product_name: string;
  qty: number;
  unit_price: number;
  profit: number;
  paid: boolean;
  buyer_name: string | null;
  date: string;
};

function Bar({ label, value, max, sublabel }: { label: string; value: number; max: number; sublabel?: string }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: "var(--ink-soft)" }}>{sublabel}</span>
      </div>
      <div style={{ background: "var(--paper-line)", borderRadius: 6, height: 10, overflow: "hidden" }}>
        <div style={{ background: "var(--marigold)", width: `${pct}%`, height: "100%" }} />
      </div>
    </div>
  );
}

export default async function EstadisticasPage() {
  const supabase = await createClient();

  const [{ data: products }, { data: sales }, { data: purchases }] = await Promise.all([
    supabase.from("products").select("*"),
    supabase.from("sales").select("product_id, product_name, qty, unit_price, profit, paid, buyer_name, date"),
    supabase.from("purchases").select("amount, date"),
  ]);

  const productList = (products ?? []) as Product[];
  const saleList = (sales ?? []) as SaleRow[];
  const purchaseList = (purchases ?? []) as { amount: number; date: string }[];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const isThisMonth = (d: string) => new Date(d) >= monthStart;

  // Igual que en Resumen: solo cuenta como ganancia lo que ya se cobró.
  const gananciaMes = saleList.filter((s) => isThisMonth(s.date) && s.paid).reduce((a, s) => a + (Number(s.profit) || 0), 0);
  const gastosMes = purchaseList.filter((p) => isThisMonth(p.date)).reduce((a, p) => a + (Number(p.amount) || 0), 0);

  // Top vendidos (por cantidad, histórico)
  const qtyByName = new Map<string, number>();
  for (const s of saleList) {
    qtyByName.set(s.product_name, (qtyByName.get(s.product_name) || 0) + Number(s.qty || 0));
  }
  const topVendidos = Array.from(qtyByName.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxVendido = topVendidos[0]?.[1] || 1;

  // Productos que casi no se venden (con stock, ordenados por menos vendidos)
  const soldByProductId = new Map<string, number>();
  for (const s of saleList) {
    if (!s.product_id) continue;
    soldByProductId.set(s.product_id, (soldByProductId.get(s.product_id) || 0) + Number(s.qty || 0));
  }
  const casiNoSeVenden = productList
    .filter((p) => p.stock > 0)
    .map((p) => ({ product: p, sold: soldByProductId.get(p.id) || 0 }))
    .sort((a, b) => a.sold - b.sold)
    .slice(0, 5);

  // Por reponer
  const porReponer = productList
    .filter((p) => p.stock <= 2)
    .sort((a, b) => a.stock - b.stock);

  // Top clientes
  const spentByBuyer = new Map<string, { total: number; count: number }>();
  for (const s of saleList) {
    const name = s.buyer_name?.trim();
    if (!name) continue;
    const prev = spentByBuyer.get(name) || { total: 0, count: 0 };
    spentByBuyer.set(name, { total: prev.total + s.unit_price * s.qty, count: prev.count + 1 });
  }
  const topClientes = Array.from(spentByBuyer.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);
  const maxCliente = topClientes[0]?.[1].total || 1;

  return (
    <>
      <div className="ledger-card">
        <div className="row">
          <span className="label">Ganancia este mes</span>
          <span className="num num-pos">+{money(gananciaMes)}</span>
        </div>
        <div className="row">
          <span className="label">Compras este mes</span>
          <span className="num num-neg">-{money(gastosMes)}</span>
        </div>
      </div>

      <div className="eyebrow">Productos que más salen</div>
      <div className="card">
        {topVendidos.length === 0 ? (
          <div className="empty">Todavía no hay ventas registradas.</div>
        ) : (
          topVendidos.map(([name, qty]) => (
            <Bar key={name} label={name} value={qty} max={maxVendido} sublabel={`${qty} vendido${qty === 1 ? "" : "s"}`} />
          ))
        )}
      </div>

      <div className="eyebrow">Productos que casi no se venden</div>
      <div className="card">
        {casiNoSeVenden.length === 0 ? (
          <div className="empty">No hay suficientes datos todavía.</div>
        ) : (
          casiNoSeVenden.map(({ product, sold }) => (
            <div className="price-row" key={product.id}>
              <div className="row-left">
                <div className="icon-circle">🐌</div>
                <div>
                  <div className="p-name">{product.name}</div>
                  <div className="p-sub">Stock actual: {product.stock}</div>
                </div>
              </div>
              <div className="p-price">{sold === 0 ? "Sin ventas" : `${sold} vendido${sold === 1 ? "" : "s"}`}</div>
            </div>
          ))
        )}
      </div>

      <div className="eyebrow">Productos por reponer</div>
      <div className="card">
        {porReponer.length === 0 ? (
          <div className="empty">Ningún producto con stock bajo por ahora ✓</div>
        ) : (
          porReponer.slice(0, 10).map((p) => (
            <div className="price-row" key={p.id}>
              <div className="row-left">
                <div className="icon-circle">⚠️</div>
                <div>
                  <div className="p-name">{p.name}</div>
                  {p.category && <div className="p-sub">{p.category}</div>}
                </div>
              </div>
              <div className="p-price">{p.stock === 0 ? "Sin stock" : `Quedan ${p.stock}`}</div>
            </div>
          ))
        )}
        {porReponer.length > 10 && <div className="p-sub" style={{ marginTop: 8 }}>y {porReponer.length - 10} más…</div>}
      </div>

      <div className="eyebrow">Clientes que más compran</div>
      <div className="card">
        {topClientes.length === 0 ? (
          <div className="empty">Todavía no hay ventas con nombre de comprador registrado.</div>
        ) : (
          topClientes.map(([name, info]) => (
            <Bar key={name} label={name} value={info.total} max={maxCliente} sublabel={`${money(info.total)} · ${info.count} compra${info.count === 1 ? "" : "s"}`} />
          ))
        )}
      </div>
    </>
  );
}
