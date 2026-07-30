"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { calcSuggestedPrice, tierLabel, money } from "@/lib/pricing";
import { showToast } from "@/lib/toast";
import { SETTINGS_PUBLIC_COLUMNS, defaultSettingsPublic, CATEGORY_SUGGESTIONS, type SettingsPublic, type ReviewItem, type Product } from "@/lib/types";
import { compressImage } from "@/lib/image";
import { uploadProductPhoto, getSignedUrls } from "@/lib/photos";

type Step = "method" | "photos" | "pdf" | "loading" | "review" | "gastos" | "precios" | "fotos" | "sin-clave";

type PendingPhoto = { base64: string; mediaType: string; previewUrl: string };

type PriceResult = { name: string; cost: number; qty: number; category: string; costoRealUnit: number; precioFinal: number };

/** Producto ya guardado en el inventario (recién creado o actualizado) al que se le puede agregar foto. */
type SavedProduct = { id: string; name: string; photo_path: string | null };

export default function EscanearPage() {
  const supabase = createClient();
  const router = useRouter();

  const [step, setStep] = useState<Step>("method");
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [pdf, setPdf] = useState<{ base64: string; name: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [tripExpense, setTripExpense] = useState("0");
  const [priceResults, setPriceResults] = useState<PriceResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedProducts, setSavedProducts] = useState<SavedProduct[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("settings").select(SETTINGS_PUBLIC_COLUMNS).eq("user_id", user.id).single();
      const s = (data as SettingsPublic) ?? defaultSettingsPublic(user.id);
      setSettings(s);
      if (!s.gemini_key_set) setStep("sin-clave");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function filesToBase64(files: FileList): Promise<PendingPhoto[]> {
    const results: PendingPhoto[] = [];
    for (const file of Array.from(files)) {
      const previewUrl = URL.createObjectURL(file);
      try {
        // Se achica a un ancho razonable para OCR (más grande que las miniaturas de producto,
        // para que la IA siga leyendo bien el texto de la boleta).
        const compressed = await compressImage(file, 1600, 0.85);
        const base64 = await blobToBase64(compressed);
        results.push({ base64, mediaType: "image/jpeg", previewUrl });
      } catch {
        // Si por algún motivo no se pudo comprimir, se manda la original igual.
        const base64 = await blobToBase64(file);
        results.push({ base64, mediaType: file.type, previewUrl });
      }
    }
    return results;
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(blob);
    });
  }

  async function onPhotosSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const converted = await filesToBase64(files);
    setPhotos((prev) => [...prev, ...converted]);
  }

  async function onPdfSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size > 4 * 1024 * 1024) {
      setErrorMsg("Ese PDF pesa demasiado (más de 4 MB). Prueba sacando una foto a la boleta en vez de subir el PDF.");
      return;
    }
    const base64 = await blobToBase64(file);
    setPdf({ base64, name: file.name });
  }

  async function escanear() {
    setErrorMsg(null);

    const payloadImages = photos.map((p) => ({ base64: p.base64, mediaType: p.mediaType }));
    const payloadPdf = pdf ? { base64: pdf.base64 } : null;
    const totalBase64Chars =
      payloadImages.reduce((a, p) => a + p.base64.length, 0) + (payloadPdf ? payloadPdf.base64.length : 0);

    // ~4MB en base64 (con margen bajo el límite real de 4.5MB del servidor).
    if (totalBase64Chars > 4_000_000) {
      setErrorMsg("Las fotos juntas pesan demasiado. Prueba escaneando menos fotos a la vez (2 o 3), o con menos zoom/resolución.");
      return;
    }

    setStep("loading");

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: payloadImages, pdf: payloadPdf }),
      });

      let data: { items?: ReviewItem[]; error?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error(
          res.status === 413
            ? "Las fotos pesan demasiado para subir. Prueba con menos fotos a la vez."
            : "El servidor no respondió correctamente. Intenta de nuevo en un momento."
        );
      }
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo leer la boleta");

      setReviewItems(data.items as ReviewItem[]);
      setStep("review");
    } catch (err) {
      setErrorMsg((err as Error).message?.toString().slice(0, 160) || "Error desconocido");
      setStep(photos.length > 0 ? "photos" : "pdf");
    }
  }

  function updateReviewItem(i: number, field: keyof ReviewItem, value: string | number) {
    setReviewItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }

  function calcularPrecios() {
    if (!settings) return;
    const trip = parseFloat(tripExpense) || 0;
    const totalCosto = reviewItems.reduce((a, it) => a + it.cost * it.qty, 0) || 1;
    const results = reviewItems.map((it) => {
      const share = (it.cost * it.qty) / totalCosto * trip;
      const costoRealUnit = it.cost + share / it.qty;
      const sugerido = calcSuggestedPrice(costoRealUnit, settings);
      return { name: it.name, cost: it.cost, qty: it.qty, category: it.category, costoRealUnit, precioFinal: sugerido };
    });
    setPriceResults(results);
    setStep("precios");
  }

  async function guardarEnInventario() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setSaving(true);

    const { data: existingProducts } = await supabase.from("products").select("*").eq("user_id", user.id);
    const existing = (existingProducts ?? []) as Product[];

    let totalCompra = 0;
    const saved: SavedProduct[] = [];

    for (const r of priceResults) {
      totalCompra += r.cost * r.qty;
      const match = existing.find((p) => p.name.toLowerCase() === r.name.toLowerCase());
      if (match) {
        await supabase
          .from("products")
          .update({ stock: match.stock + r.qty, cost: r.cost, price: r.precioFinal, updated_at: new Date().toISOString() })
          .eq("id", match.id);
        saved.push({ id: match.id, name: match.name, photo_path: match.photo_path });
      } else {
        const { data: inserted } = await supabase
          .from("products")
          .insert({
            user_id: user.id,
            name: r.name,
            category: r.category,
            cost: r.cost,
            price: r.precioFinal,
            stock: r.qty,
          })
          .select()
          .single();
        if (inserted) saved.push({ id: inserted.id, name: inserted.name, photo_path: null });
      }
    }

    const trip = parseFloat(tripExpense) || 0;
    totalCompra += trip;

    await supabase.from("purchases").insert({
      user_id: user.id,
      description: `Boleta agregada · ${priceResults.length} producto${priceResults.length === 1 ? "" : "s"}`,
      amount: totalCompra,
      trip_expense: trip,
      item_count: priceResults.length,
    });

    setSaving(false);
    showToast(`Se agregaron ${priceResults.length} producto(s) a tu inventario ✓`);

    setSavedProducts(saved);
    const paths = saved.map((p) => p.photo_path).filter((p): p is string => !!p);
    if (paths.length > 0) setPhotoUrls(await getSignedUrls(paths));
    setStep("fotos");
  }

  async function onFotoSelected(product: SavedProduct, file: File | undefined) {
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
      setSavedProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, photo_path: path } : p)));

      const urls = await getSignedUrls([path]);
      setPhotoUrls((prev) => ({ ...prev, ...urls }));
      showToast("Foto guardada ✓");
    } catch {
      showToast("No se pudo subir la foto — intenta de nuevo");
    } finally {
      setUploadingId(null);
    }
  }

  function terminarEscaneo() {
    router.push("/inventario");
    router.refresh();
  }

  // ---------- Render por paso ----------

  if (step === "sin-clave") {
    return (
      <>
        <div className="eyebrow">Falta tu clave de Gemini</div>
        <div className="callout">
          Para escanear boletas con IA primero necesitas agregar tu clave gratuita de Gemini en Ajustes.
        </div>
        <button className="btn btn-primary btn-block" onClick={() => router.push("/ajustes")}>
          Ir a Ajustes
        </button>
      </>
    );
  }

  if (step === "method") {
    return (
      <>
        <div className="eyebrow">Agregar productos desde boleta</div>
        <button className="method-card" onClick={() => setStep("photos")}>
          <div className="method-icon">📷</div>
          <div>
            <div className="method-title">Subir una o más fotos</div>
            <div className="method-desc">Ideal para boletas largas — puedes sacar varias fotos en tramos.</div>
          </div>
        </button>
        <button className="method-card" onClick={() => setStep("pdf")}>
          <div className="method-icon">📄</div>
          <div>
            <div className="method-title">Subir un PDF</div>
            <div className="method-desc">Para boletas o facturas electrónicas.</div>
          </div>
        </button>
      </>
    );
  }

  if (step === "photos") {
    return (
      <>
        <div className="eyebrow">Fotos de la boleta</div>
        {errorMsg && <div className="callout callout-error">{errorMsg}</div>}
        <div className="quick-actions" style={{ marginBottom: 14 }}>
          <label className="file-label" style={{ flex: 1, margin: 0, padding: "16px 10px" }}>
            <input type="file" accept="image/*" multiple capture="environment" onChange={(e) => onPhotosSelected(e.target.files)} />
            <div className="icon">📷</div>
            <p>Tomar foto</p>
          </label>
          <label className="file-label" style={{ flex: 1, margin: 0, padding: "16px 10px" }}>
            <input type="file" accept="image/*" multiple onChange={(e) => onPhotosSelected(e.target.files)} />
            <div className="icon">🖼️</div>
            <p>Elegir de galería</p>
          </label>
        </div>
        {photos.map((p, i) => (
          <div className="photo-thumb" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.previewUrl} alt="" />
            <span>Foto {i + 1}</span>
          </div>
        ))}
        <button className="btn btn-primary btn-block" disabled={photos.length === 0} onClick={escanear}>
          Leer boleta con IA
        </button>
      </>
    );
  }

  if (step === "pdf") {
    return (
      <>
        <div className="eyebrow">PDF de la boleta o factura</div>
        {errorMsg && <div className="callout callout-error">{errorMsg}</div>}
        <label className="file-label">
          <input type="file" accept="application/pdf" onChange={(e) => onPdfSelected(e.target.files)} />
          <div className="icon">📄</div>
          <p>Toca para elegir el archivo PDF</p>
        </label>
        {pdf && <div className="photo-thumb">📄 <span>{pdf.name}</span></div>}
        <button className="btn btn-primary btn-block" disabled={!pdf} onClick={escanear}>
          Leer boleta con IA
        </button>
      </>
    );
  }

  if (step === "loading") {
    return (
      <div className="spinner-wrap">
        <div className="spinner" />
        <p>La IA está leyendo tus productos</p>
        <span>Uniendo la información y evitando duplicados…</span>
      </div>
    );
  }

  if (step === "review") {
    return (
      <>
        <div className="eyebrow">Revisa lo que detectamos</div>
        {reviewItems.length > 1 && (
          <div className="callout">🧠 La IA revisó las fotos y armó una sola lista, uniendo productos repetidos por el traslape entre tramos.</div>
        )}
        {reviewItems.map((it, i) => (
          <div className={`review-item ${it.confidence === "baja" ? "warn" : ""}`} key={i}>
            {it.confidence === "baja" && <div className="warn-tag">⚠️ No se leyó muy claro, revisa el nombre</div>}
            <input type="text" value={it.name} onChange={(e) => updateReviewItem(i, "name", e.target.value)} />
            <label className="field-label">Costo unitario</label>
            <input type="number" value={it.cost} onChange={(e) => updateReviewItem(i, "cost", parseFloat(e.target.value) || 0)} />
            <label className="field-label">Cantidad</label>
            <input type="number" min={1} value={it.qty} onChange={(e) => updateReviewItem(i, "qty", parseInt(e.target.value) || 1)} />
            <label className="field-label">Categoría</label>
            <input
              type="text"
              list="categorias-sugeridas"
              value={it.category}
              onChange={(e) => updateReviewItem(i, "category", e.target.value)}
            />
          </div>
        ))}
        <datalist id="categorias-sugeridas">
          {CATEGORY_SUGGESTIONS.map((c) => (
            <option value={c} key={c} />
          ))}
        </datalist>
        <button className="btn btn-primary btn-block" onClick={() => setStep("gastos")}>
          Continuar
        </button>
      </>
    );
  }

  if (step === "gastos") {
    return (
      <>
        <div className="eyebrow">Gastos de esta compra</div>
        <label className="field-label">Bencina / locomoción</label>
        <input type="number" value={tripExpense} onChange={(e) => setTripExpense(e.target.value)} />
        <div className="callout">Este gasto se reparte automáticamente entre los productos de esta boleta, según su costo.</div>
        <button className="btn btn-primary btn-block" onClick={calcularPrecios}>
          Calcular precios sugeridos
        </button>
      </>
    );
  }

  if (step === "precios") {
    return (
      <>
        <div className="eyebrow">Precios sugeridos</div>
        {priceResults.map((r, i) => (
          <div className="price-tier-card" key={i}>
            <div className="name">{r.name}</div>
            <div className="tierlabel" style={{ marginRight: 6 }}>{r.category}</div>
            <div className="breakdown">Costo real: {money(r.costoRealUnit)} (costo + gasto del viaje repartido)</div>
            <div className="tierlabel">{settings ? tierLabel(r.costoRealUnit, settings) : ""}</div>
            <input
              type="number"
              value={r.precioFinal}
              onChange={(e) =>
                setPriceResults((prev) => prev.map((p, idx) => (idx === i ? { ...p, precioFinal: parseFloat(e.target.value) || 0 } : p)))
              }
            />
          </div>
        ))}
        <div className="callout">Tú decides — puedes dejar el precio sugerido o cambiarlo, como siempre.</div>
        <button className="btn btn-primary btn-block" disabled={saving} onClick={guardarEnInventario}>
          {saving ? "Guardando…" : "Guardar en mi inventario"}
        </button>
      </>
    );
  }

  // step === "fotos"
  return (
    <>
      <div className="eyebrow">Ya está en tu inventario ✓</div>
      <div className="callout">
        Aprovecha de agregarles una foto ahora, así no tienes que volver a repasar el inventario después solo para eso. Es opcional.
      </div>
      <div className="card">
        {savedProducts.map((p) => (
          <div className="product-row" key={p.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ cursor: "pointer", flexShrink: 0 }}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => onFotoSelected(p, e.target.files?.[0])}
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
              <div className="p-name">{p.name}</div>
              <div className="p-sub">{p.photo_path ? "Foto agregada ✓" : "Toca el ícono para agregar una foto"}</div>
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-primary btn-block" onClick={terminarEscaneo}>
        Listo
      </button>
    </>
  );
}
