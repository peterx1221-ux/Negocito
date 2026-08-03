"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/pricing";
import { showToast } from "@/lib/toast";
import type { Product } from "@/lib/types";
import { smartFilter } from "@/lib/search";
import SearchInput from "@/components/SearchInput";

/** Una línea del carrito — puede venir del inventario (productId) o ser manual (productId: null). */
type CartLine = {
  key: string;
  productId: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
};

export default function VenderPage() {
  const supabase = createClient();
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [mode, setMode] = useState<"inventario" | "manual">("inventario");
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]);
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

  const filteredProducts = smartFilter(search, products);

  useEffect(() => {
    if (filteredProducts.length === 0) return;
    if (!filteredProducts.some((p) => p.id === productId)) {
      setProductId(filteredProducts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const selected = products.find((p) => p.id === productId);
  const cartTotal = cart.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);

  /** Agrega la selección actual (inventario o manual) como una línea del carrito. Si el mismo producto ya estaba, suma la cantidad en vez de duplicar la línea. */
  function addToCart() {
    if (mode === "inventario") {
      if (!selected) {
        showToast("Elige un producto de tu inventario");
        return;
      }
      const unitPrice = selected.is_remate && selected.remate_price != null ? selected.remate_price : selected.price;
      setCart((prev) => {
        const idx = prev.findIndex((l) => l.productId === selected.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + qty };
          return next;
        }
        return [...prev, { key: selected.id, productId: selected.id, name: selected.name, qty, unitPrice, unitCost: selected.cost }];
      });
      setSearch("");
    } else {
      const name = manualName.trim();
      if (!name) {
        showToast("Escribe el nombre del producto");
        return;
      }
      const unitPrice = parseFloat(manualPrice) || 0;
      setCart((prev) => {
        const idx = prev.findIndex((l) => l.productId === null && l.name.toLowerCase() === name.toLowerCase());
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + qty };
          return next;
        }
        return [...prev, { key: `manual-${Date.now()}`, productId: null, name, qty, unitPrice, unitCost: 0 }];
      });
      setManualName("");
      setManualPrice("");
    }
    setQty(1);
    showToast("Agregado al carrito 🛒");
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function updateCartQty(key: string, newQty: number) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.max(1, newQty) } : l)));
  }

  /** Arma una única línea a partir de lo seleccionado ahora mismo — se usa cuando NO se llegó a usar el carrito, para que vender un solo producto siga siendo tan rápido como antes. */
  function buildSingleLine(): CartLine | null {
    if (mode === "inventario") {
      if (!selected) {
        showToast("Elige un producto de tu inventario");
        return null;
      }
      const unitPrice = selected.is_remate && selected.remate_price != null ? selected.remate_price : selected.price;
      return { key: selected.id, productId: selected.id, name: selected.name, qty, unitPrice, unitCost: selected.cost };
    }
    if (!manualName.trim()) {
      showToast("Escribe el nombre del producto");
      return null;
    }
    return { key: "manual-single", productId: null, name: manualName.trim(), qty, unitPrice: parseFloat(manualPrice) || 0, unitCost: 0 };
  }

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

    const lines = cart.length > 0 ? cart : [buildSingleLine()].filter((l): l is CartLine => l !== null);
    if (lines.length === 0) {
      setSaving(false);
      return;
    }

    // Acumulamos los descuentos de stock por producto antes de escribir, por si el
    // mismo producto aparece en más de una línea (no debería, pero por si acaso).
    const stockAdjustments = new Map<string, number>();

    for (const line of lines) {
      const profit = (line.unitPrice - line.unitCost) * line.qty;

      const { data: sale, error } = await supabase
        .from("sales")
        .insert({
          user_id: user.id,
          product_id: line.productId,
          product_name: line.name,
          qty: line.qty,
          unit_price: line.unitPrice,
          unit_cost: line.unitCost,
          profit,
          buyer_name: buyer || null,
          is_fiado: fiado,
          paid: !fiado,
        })
        .select()
        .single();

      if (error || !sale) {
        showToast("No se pudo registrar una de las ventas — intenta de nuevo");
        setSaving(false);
        return;
      }

      if (line.productId) {
        const current = products.find((p) => p.id === line.productId);
        const base = stockAdjustments.has(line.productId) ? stockAdjustments.get(line.productId)! : current?.stock ?? 0;
        stockAdjustments.set(line.productId, base - line.qty);
      }

      if (fiado) {
        const { error: debtorError } = await supabase.from("debtors").insert({
          user_id: user.id,
          sale_id: sale.id,
          name: buyer || "Sin nombre",
          amount: line.unitPrice * line.qty,
          paid_amount: 0,
          paid: false,
        });
        if (debtorError) {
          showToast("La venta se guardó, pero no se pudo registrar como deuda — revisa que la tabla 'debtors' tenga la columna 'paid_amount'");
        }
      }
    }

    for (const [pid, newStock] of stockAdjustments) {
      await supabase.from("products").update({ stock: Math.max(0, newStock) }).eq("id", pid);
    }

    setSaving(false);
    showToast(lines.length > 1 ? `${lines.length} ventas registradas ✓` : "Venta registrada ✓");
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
            <>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="🔎 Buscar, o di algo como “aseo bajo $2000”…"
              />
              {filteredProducts.length === 0 ? (
                <div className="callout">No encontramos nada para &ldquo;{search}&rdquo;.</div>
              ) : (
                <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {Array.from(
                    filteredProducts.reduce((map, p) => {
                      const key = p.category?.trim() || "Sin categoría";
                      if (!map.has(key)) map.set(key, []);
                      map.get(key)!.push(p);
                      return map;
                    }, new Map<string, Product[]>())
                  ).map(([category, items]) => (
                    <optgroup label={category} key={category}>
                      {items.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.is_remate ? "🔥 " : ""}
                          {p.name} — stock {p.stock}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
              {selected?.is_remate && selected.remate_price != null && (
                <div className="callout" style={{ marginTop: 8 }}>
                  🔥 Este producto está en remate — se vende a {money(selected.remate_price)} en vez de {money(selected.price)}.
                </div>
              )}
            </>
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

      <button type="button" className="btn btn-ghost btn-block" style={{ marginBottom: 16 }} onClick={addToCart}>
        + Agregar al carrito
      </button>

      {cart.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            🛒 Carrito · {cart.length} producto{cart.length === 1 ? "" : "s"}
          </div>
          {cart.map((line) => (
            <div className="debt-row" key={line.key}>
              <div className="row-left">
                <div>
                  <div className="p-name">{line.name}</div>
                  <div className="p-sub">{money(line.unitPrice)} c/u</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) => updateCartQty(line.key, parseInt(e.target.value) || 1)}
                  style={{ width: 54, marginBottom: 0, padding: "6px 8px", textAlign: "center" }}
                />
                <div className="p-price" style={{ minWidth: 66, textAlign: "right" }}>
                  {money(line.qty * line.unitPrice)}
                </div>
                <button type="button" className="btn-danger-text" onClick={() => removeFromCart(line.key)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: 10,
              marginTop: 4,
              borderTop: "1.5px solid var(--paper-line)",
            }}
          >
            <div className="p-name">Total</div>
            <div className="p-price" style={{ fontSize: 16 }}>
              {money(cartTotal)}
            </div>
          </div>
        </div>
      )}

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
        {saving
          ? "Guardando…"
          : cart.length > 0
          ? `Confirmar venta · ${cart.length} producto${cart.length === 1 ? "" : "s"} · ${money(cartTotal)}`
          : "Confirmar venta"}
      </button>
    </form>
  );
}
