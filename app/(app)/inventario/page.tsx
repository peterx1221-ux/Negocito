"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/pricing";
import { showToast } from "@/lib/toast";
import { CATEGORY_SUGGESTIONS, type Product } from "@/lib/types";
import { matchesSearch } from "@/lib/search";
import { compressImage } from "@/lib/image";
import { uploadProductPhoto, deleteProductPhoto, getSignedUrls } from "@/lib/photos";

const SIN_CATEGORIA = "Sin categoría";

export default function InventarioPage() {
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", cost: "", price: "", stock: "" });
  const [search, setSearch] = useState("");
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("products").select("*").order("name");
    const list = (data ?? []) as Product[];
    setProducts(list);
    setLoading(false);

    const paths = list.map((p) => p.photo_path).filter((p): p is string => !!p);
    if (paths.length > 0) {
      const urls = await getSignedUrls(paths);
      setPhotoUrls(urls);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const filtered = products.filter((p) => matchesSearch(search, p.name, p.category));
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const key = p.category?.trim() || SIN_CATEGORIA;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === SIN_CATEGORIA) return 1;
      if (b === SIN_CATEGORIA) return -1;
      return a.localeCompare(b, "es");
    });
  }, [products, search]);

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("products").insert({
      user_id: user.id,
      name: form.name,
      category: form.category || null,
      cost: parseFloat(form.cost) || 0,
      price: parseFloat(form.price) || 0,
      stock: parseFloat(form.stock) || 0,
    });
    if (error) {
      showToast("No se pudo agregar — intenta de nuevo");
      return;
    }
    setForm({ name: "", category: "", cost: "", price: "", stock: "" });
    setShowAdd(false);
    showToast(`"${form.name}" agregado a tu inventario ✓`);
    load();
  }

  async function updateField(id: string, field: "price" | "stock", value: number) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    await supabase.from("products").update({ [field]: value, updated_at: new Date().toISOString() }).eq("id", id);
  }

  async function updateCategory(id: string, value: string) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, category: value || null } : p)));
    await supabase.from("products").update({ category: value || null, updated_at: new Date().toISOString() }).eq("id", id);
  }

  async function deleteProduct(id: string, name: string) {
    if (!confirm(`¿Eliminar "${name}" de tu inventario?`)) return;
    await supabase.from("products").delete().eq("id", id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast(`"${name}" eliminado`);
  }

  async function onPhotoSelected(product: Product, file: File | undefined) {
    if (!file) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    setUploadingId(product.id);
    try {
      const blob = await compressImage(file);
      const path = await uploadProductPhoto(user.id, product.id, blob);
      if (!path) throw new Error();

      await supabase.from("products").update({ photo_path: path, updated_at: new Date().toISOString() }).eq("id", product.id);
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, photo_path: path } : p)));

      const urls = await getSignedUrls([path]);
      setPhotoUrls((prev) => ({ ...prev, ...urls }));
      showToast("Foto guardada ✓");
    } catch {
      showToast("No se pudo subir la foto — intenta de nuevo");
    } finally {
      setUploadingId(null);
    }
  }

  async function removePhoto(product: Product) {
    if (!product.photo_path) return;
    if (!confirm("¿Quitar la foto de este producto?")) return;
    await deleteProductPhoto(product.photo_path);
    await supabase.from("products").update({ photo_path: null }).eq("id", product.id);
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, photo_path: null } : p)));
    showToast("Foto eliminada");
  }

  return (
    <>
      <input
        type="text"
        placeholder="🔎 Buscar por nombre o categoría…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 6 }}
      />

      <div className="eyebrow">{loading ? "Cargando…" : `${products.length} producto${products.length === 1 ? "" : "s"}`}</div>

      {products.length === 0 && !loading && (
        <div className="card">
          <div className="empty">Aún no tienes productos.</div>
        </div>
      )}

      {products.length > 0 && groups.length === 0 && (
        <div className="card">
          <div className="empty">No encontramos nada para &ldquo;{search}&rdquo;.</div>
        </div>
      )}

      {groups.map(([category, items]) => (
        <div key={category}>
          <div className="eyebrow">
            {category} · {items.length}
          </div>
          <div className="card">
            {items.map((p) => (
              <div className="product-row" key={p.id} style={{ display: "block" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                  <label style={{ cursor: "pointer", flexShrink: 0 }}>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => onPhotoSelected(p, e.target.files?.[0])}
                    />
                    {photoUrls[p.photo_path ?? ""] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrls[p.photo_path ?? ""]}
                        alt={p.name}
                        style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 10,
                          background: "var(--paper-line)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 22,
                        }}
                      >
                        {uploadingId === p.id ? "…" : "📷"}
                      </div>
                    )}
                  </label>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div className="p-name">{p.name}</div>
                      <button className="btn-danger-text" onClick={() => deleteProduct(p.id, p.name)}>
                        Eliminar
                      </button>
                    </div>
                    <div className="p-sub">
                      {p.photo_path ? (
                        <button className="btn-danger-text" style={{ padding: 0 }} onClick={() => removePhoto(p)}>
                          Quitar foto
                        </button>
                      ) : (
                        "Toca el ícono para agregar una foto"
                      )}
                    </div>
                  </div>
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
                <label className="field-label">Categoría</label>
                <input
                  type="text"
                  list="categorias-sugeridas"
                  defaultValue={p.category ?? ""}
                  placeholder="Sin categoría"
                  onBlur={(e) => updateCategory(p.id, e.target.value)}
                />
                <div className="p-sub">Costo: {money(p.cost)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <datalist id="categorias-sugeridas">
        {CATEGORY_SUGGESTIONS.map((c) => (
          <option value={c} key={c} />
        ))}
      </datalist>

      {showAdd ? (
        <form className="card" onSubmit={addProduct}>
          <label className="field-label">Nombre</label>
          <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="field-label">Categoría</label>
          <input
            type="text"
            list="categorias-sugeridas"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="Ej: Perfumería y cosmética"
          />
          <label className="field-label">Costo</label>
          <input type="number" required value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          <label className="field-label">Precio de venta</label>
          <input type="number" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <label className="field-label">Stock</label>
          <input type="number" required value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          <button className="btn btn-primary btn-block" type="submit">
            Guardar producto
          </button>
          <div className="callout" style={{ marginTop: 10 }}>
            Después de guardar, puedes tocar su ícono en la lista para agregarle una foto.
          </div>
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
