"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money, calcRematePrice } from "@/lib/pricing";
import { showToast } from "@/lib/toast";
import {
  CATEGORY_SUGGESTIONS,
  SETTINGS_PUBLIC_COLUMNS,
  defaultSettingsPublic,
  type Product,
  type SettingsPublic,
} from "@/lib/types";
import { smartFilter } from "@/lib/search";
import { compressImage } from "@/lib/image";
import { uploadProductPhoto, deleteProductPhoto, getSignedUrls } from "@/lib/photos";
import SearchInput from "@/components/SearchInput";

const SIN_CATEGORIA = "Sin categoría";

export default function InventarioPage() {
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", cost: "", price: "", stock: "" });
  const [search, setSearch] = useState("");
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkCategory, setShowBulkCategory] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data } = await supabase.from("products").select("*").order("name");
    const list = (data ?? []) as Product[];
    setProducts(list);
    setLoading(false);

    const paths = list.map((p) => p.photo_path).filter((p): p is string => !!p);
    if (paths.length > 0) {
      const urls = await getSignedUrls(paths);
      setPhotoUrls(urls);
    }

    if (user) {
      const { data: s } = await supabase.from("settings").select(SETTINGS_PUBLIC_COLUMNS).eq("user_id", user.id).single();
      setSettings((s as SettingsPublic) ?? defaultSettingsPublic(user.id));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const filtered = smartFilter(search, products);
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

  async function updateField(id: string, field: "price" | "stock" | "remate_price", value: number) {
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

  // ---- Modo selección / acciones en lote ----

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
    setShowBulkCategory(false);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`¿Eliminar ${ids.length} producto${ids.length === 1 ? "" : "s"} de tu inventario?`)) return;

    setBulkBusy(true);
    const toDelete = products.filter((p) => selectedIds.has(p.id));
    for (const p of toDelete) {
      if (p.photo_path) await deleteProductPhoto(p.photo_path);
    }
    await supabase.from("products").delete().in("id", ids);
    setProducts((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
    setBulkBusy(false);
    showToast(`${ids.length} producto${ids.length === 1 ? "" : "s"} eliminado${ids.length === 1 ? "" : "s"}`);
  }

  async function bulkSetCategory() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const value = bulkCategoryValue.trim();

    setBulkBusy(true);
    await supabase.from("products").update({ category: value || null, updated_at: new Date().toISOString() }).in("id", ids);
    setProducts((prev) => prev.map((p) => (selectedIds.has(p.id) ? { ...p, category: value || null } : p)));
    setBulkBusy(false);
    setShowBulkCategory(false);
    setBulkCategoryValue("");
    setSelectedIds(new Set());
    showToast("Categoría actualizada ✓");
  }

  async function bulkMarkRemate() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !settings) return;

    setBulkBusy(true);
    const toMark = products.filter((p) => selectedIds.has(p.id));
    for (const p of toMark) {
      const remate_price = calcRematePrice(p.cost, settings);
      await supabase
        .from("products")
        .update({ is_remate: true, remate_price, updated_at: new Date().toISOString() })
        .eq("id", p.id);
    }
    setProducts((prev) =>
      prev.map((p) =>
        selectedIds.has(p.id) ? { ...p, is_remate: true, remate_price: calcRematePrice(p.cost, settings) } : p
      )
    );
    setBulkBusy(false);
    setSelectedIds(new Set());
    showToast(`${ids.length} producto${ids.length === 1 ? "" : "s"} en remate 🔥`);
  }

  async function bulkUnmarkRemate() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setBulkBusy(true);
    await supabase.from("products").update({ is_remate: false, updated_at: new Date().toISOString() }).in("id", ids);
    setProducts((prev) => prev.map((p) => (selectedIds.has(p.id) ? { ...p, is_remate: false } : p)));
    setBulkBusy(false);
    setSelectedIds(new Set());
    showToast("Se quitó el remate");
  }

  return (
    <>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="🔎 Buscar, o di algo como “aseo bajo $2000”…"
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="eyebrow" style={{ marginBottom: 0 }}>
          {loading ? "Cargando…" : `${products.length} producto${products.length === 1 ? "" : "s"}`}
        </div>
        {!loading && products.length > 0 && (
          <button type="button" className="btn-danger-text" onClick={toggleSelectMode}>
            {selectMode ? "Cancelar selección" : "Seleccionar"}
          </button>
        )}
      </div>

      {selectMode && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="p-sub" style={{ marginBottom: 10 }}>
            {selectedIds.size === 0
              ? "Toca los productos de la lista para seleccionarlos."
              : `${selectedIds.size} producto${selectedIds.size === 1 ? "" : "s"} seleccionado${selectedIds.size === 1 ? "" : "s"}`}
          </div>

          {showBulkCategory ? (
            <>
              <label className="field-label">Nueva categoría para los seleccionados</label>
              <input
                type="text"
                list="categorias-sugeridas"
                value={bulkCategoryValue}
                onChange={(e) => setBulkCategoryValue(e.target.value)}
                placeholder="Ej: Perfumería y cosmética"
              />
              <div className="quick-actions">
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={bulkBusy} onClick={bulkSetCategory}>
                  Aplicar
                </button>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowBulkCategory(false)}>
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <div className="quick-actions" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1, minWidth: 130 }}
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={() => setShowBulkCategory(true)}
              >
                Cambiar categoría
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1, minWidth: 130 }}
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={bulkMarkRemate}
              >
                🔥 Marcar en remate
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1, minWidth: 130 }}
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={bulkUnmarkRemate}
              >
                Quitar remate
              </button>
              <button
                type="button"
                className="btn-danger-text"
                style={{ flex: 1, minWidth: 130 }}
                disabled={selectedIds.size === 0 || bulkBusy}
                onClick={bulkDelete}
              >
                Eliminar seleccionados
              </button>
            </div>
          )}
        </div>
      )}

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
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      style={{ width: 20, height: 20, flexShrink: 0, marginTop: 18 }}
                    />
                  )}
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
                      <div className="p-name">
                        {p.is_remate && "🔥 "}
                        {p.name}
                      </div>
                      {!selectMode && (
                        <button className="btn-danger-text" onClick={() => deleteProduct(p.id, p.name)}>
                          Eliminar
                        </button>
                      )}
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
                {p.is_remate && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
                    <div style={{ flex: 1 }}>
                      <label className="field-label" style={{ color: "var(--rust)" }}>
                        🔥 Precio remate
                      </label>
                      <input
                        type="number"
                        defaultValue={p.remate_price ?? 0}
                        onBlur={(e) => updateField(p.id, "remate_price", parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                )}
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
