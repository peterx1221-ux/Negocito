"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { showToast } from "@/lib/toast";
import type { Product } from "@/lib/types";

export default function VenderPage() {
  const supabase = createClient();
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [mode, setMode] = useState<"inventario" | "manual">("inventario");
  const [productId, setProductId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [buyer, setBuyer] = useState("");
  const [fiado, setFiado] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("products")
      .select("*")
      .order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Product[];
        setProducts(list);
        if (list.length > 0) setProductId(list[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = products.find((p) => p.id === productId);

  async function confirmarVenta(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    let name: string;
    let unitPrice: number;
    let unitCost: number;

    if (mode === "inventario") {
      if (!selected) {
        showToast("Elige un producto de tu inventario");
        setSaving(false);
        return;
      }
      name = selected.name;
      unitPrice = selected.price;
      unitCost = selected.cost;
    } else {
      if (!manualName.trim()) {
        showToast("Escribe el nombre del producto");
        setSaving(false);
        return;
      }
      name = manualName.trim();
      unitPrice = parseFloat(manualPrice) || 0;
      unitCost = 0;
    }

    const profit = (unitPrice - unitCost) * qty;

    const { data: sale, error } = await supabase
      .from("sales")
      .insert({
        user_id: user.id,
        product_id: mode === "inventario" ? productId : null,
        product_name: name,
        qty,
        unit_price: unitPrice,
        unit_cost: unitCost,
        profit,
        buyer_name: buyer || null,
        is_fiado: fiado,
        paid: !fiado,
      })
      .select()
      .single();

    if (error) {
      showToast("No se pudo registrar la venta — intenta de nuevo");
      setSaving(false);
      return;
    }

    if (mode === "inventario" && selected) {
      await supabase
        .from("products")
        .update({ stock: Math.max(0, selected.stock - qty) })
        .eq("id", selected.id);
    }

    if (fiado) {
      await supabase.from("debtors").insert({
        user_id: user.id,
        sale_id: sale.id,
        name: buyer || "Sin nombre",
        amount: unitPrice * qty,
        paid: false,
      });
    }

    setSaving(false);
    showToast("Venta registrada ✓");
    router.push("/resumen");
    router.refresh();
  }

  return (
    <form onSubmit={confirmarVenta}>
      <div className="eyebrow">Registrar venta</div>

      <div className="quick-actions" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={mode === "inventario" ? "btn btn-primary" : "btn btn-secondary"}
          style={{ flex: 1 }}
          onClick={() => setMode("inventario")}
        >
          Desde inventario
        </button>
        <button
          type="button"
          className={mode === "manual" ? "btn btn-primary" : "btn btn-secondary"}
          style={{ flex: 1 }}
          onClick={() => setMode("manual")}
        >
          Manual
        </button>
      </div>

      {mode === "inventario" ? (
        <>
          <label className="field-label">Producto</label>
          {products.length === 0 ? (
            <div className="callout">Todavía no tienes productos en tu inventario.</div>
          ) : (
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — stock {p.stock}
                </option>
              ))}
            </select>
          )}
        </>
      ) : (
        <>
          <label className="field-label">Nombre del producto</label>
          <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Ej: Empanada" />
          <label className="field-label">Precio de venta (unitario)</label>
          <input type="number" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} placeholder="0" />
        </>
      )}

      <label className="field-label">Cantidad</label>
      <input type="number" min={1} value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} />

      <label className="field-label">Comprador (opcional)</label>
      <input type="text" value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Ej: Javiera R." />

      <div className="fiado-toggle">
        <div>
          <div className="p-name" style={{ fontSize: 13 }}>
            Venta al fiado
          </div>
          <div className="p-sub">Se agrega a deudores si no paga ahora</div>
        </div>
        <button
          type="button"
          className={`switch ${fiado ? "on" : ""}`}
          onClick={() => setFiado(!fiado)}
        >
          <div className="dot2" />
        </button>
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={saving}>
        {saving ? "Guardando…" : "Confirmar venta"}
      </button>
    </form>
  );
}
