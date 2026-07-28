"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/pricing";
import { showToast } from "@/lib/toast";
import type { Product } from "@/lib/types";

export default function InventarioPage() {
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", cost: "", price: "", stock: "" });

  async function load() {
    const { data } = await supabase.from("products").select("*").order("name");
    setProducts((data ?? []) as Product[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("products").insert({
      user_id: user.id,
      name: form.name,
      cost: parseFloat(form.cost) || 0,
      price: parseFloat(form.price) || 0,
      stock: parseFloat(form.stock) || 0,
    });
    if (error) {
      showToast("No se pudo agregar — intenta de nuevo");
      return;
    }
    setForm({ name: "", cost: "", price: "", stock: "" });
    setShowAdd(false);
    showToast(`"${form.name}" agregado a tu inventario ✓`);
    load();
  }

  async function updateField(id: string, field: "price" | "stock", value: number) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    await supabase.from("products").update({ [field]: value, updated_at: new Date().toISOString() }).eq("id", id);
  }

  async function deleteProduct(id: string, name: string) {
    if (!confirm(`¿Eliminar "${name}" de tu inventario?`)) return;
    await supabase.from("products").delete().eq("id", id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast(`"${name}" eliminado`);
  }

  return (
    <>
      <div className="eyebrow">{loading ? "Cargando…" : `${products.length} producto${products.length === 1 ? "" : "s"}`}</div>

      <div className="card">
        {products.length === 0 && !loading ? (
          <div className="empty">Aún no tienes productos.</div>
        ) : (
          products.map((p) => (
            <div className="product-row" key={p.id} style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div className="p-name">{p.name}</div>
                <button className="btn-danger-text" onClick={() => deleteProduct(p.id, p.name)}>
                  Eliminar
                </button>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <label className="field-label">Precio</label>
                  <input
                    type="number"
                    defaultValue={p.price}
                    onBlur={(e) => updateField(p.id, "price", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="field-label">Stock</label>
                  <input
                    type="number"
                    defaultValue={p.stock}
                    onBlur={(e) => updateField(p.id, "stock", parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className="p-sub">Costo: {money(p.cost)}</div>
            </div>
          ))
        )}
      </div>

      {showAdd ? (
        <form className="card" onSubmit={addProduct}>
          <label className="field-label">Nombre</label>
          <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="field-label">Costo</label>
          <input type="number" required value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          <label className="field-label">Precio de venta</label>
          <input type="number" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <label className="field-label">Stock</label>
          <input type="number" required value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          <button className="btn btn-primary btn-block" type="submit">
            Guardar producto
          </button>
        </form>
      ) : (
        <button className="btn btn-ghost btn-block" style={{ marginBottom: 10 }} onClick={() => setShowAdd(true)}>
          + Agregar producto a mano
        </button>
      )}

      <Link href="/escanear" className="btn btn-secondary btn-block">
        📷 Agregar productos desde boleta
      </Link>
    </>
  );
}
