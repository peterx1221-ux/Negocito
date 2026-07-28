import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const INSTRUCTIONS = `Eres un asistente que lee boletas de compra chilenas. Puede haber varias fotos que son tramos consecutivos de una misma boleta larga (de arriba hacia abajo, con posible traslape entre ellas) — únelos en una sola lista sin duplicar productos que aparezcan repetidos por el traslape. Devuelve SOLO un JSON válido, sin texto adicional ni backticks, con este formato exacto:
{"items":[{"nombre":"...", "costo_unitario":1234, "cantidad":1, "confianza":"alta"}], "total_boleta":12345}
Si un nombre no se lee con claridad, usa tu mejor inferencia igual y pon "confianza":"baja" en ese ítem. Los costos son números enteros en pesos chilenos, sin puntos ni signos.`;

type ItemIn = { nombre: string; costo_unitario: number; cantidad?: number; confianza?: string };

export async function POST(request: Request) {
  // 1) Confirmar sesión — nadie puede usar esta ruta sin haber iniciado sesión.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // 2) Leer la clave de Gemini SOLO acá, del lado del servidor.
  //    Nunca se envía al navegador en ningún momento.
  const { data: settings } = await supabase
    .from("settings")
    .select("gemini_key, gemini_model")
    .eq("user_id", user.id)
    .single();

  if (!settings?.gemini_key) {
    return NextResponse.json({ error: "No tienes una clave de Gemini guardada en Ajustes" }, { status: 400 });
  }

  let body: { images?: { base64: string; mediaType: string }[]; pdf?: { base64: string } | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const images = body.images ?? [];
  const pdf = body.pdf ?? null;

  if (images.length === 0 && !pdf) {
    return NextResponse.json({ error: "No se recibió ninguna imagen o PDF" }, { status: 400 });
  }

  const parts: Record<string, unknown>[] = [{ text: INSTRUCTIONS }];
  images.forEach((img) => parts.push({ inline_data: { mime_type: img.mediaType, data: img.base64 } }));
  if (pdf) parts.push({ inline_data: { mime_type: "application/pdf", data: pdf.base64 } });

  const model = settings.gemini_model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    // La clave va en un header, no en la URL, para que no quede en logs por accidente.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.gemini_key,
      },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    const data = await response.json();

    if (data.error) {
      return NextResponse.json({ error: data.error.message || "Error de la API de Gemini" }, { status: 502 });
    }

    const textOut: string =
      data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ?? "";
    if (!textOut) {
      return NextResponse.json({ error: "Gemini no devolvió texto" }, { status: 502 });
    }

    const clean = textOut.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    const items = ((parsed.items || []) as ItemIn[]).map((it) => ({
      name: it.nombre,
      cost: it.costo_unitario,
      qty: it.cantidad || 1,
      confidence: it.confianza === "baja" ? "baja" : "alta",
    }));

    if (items.length === 0) {
      return NextResponse.json({ error: "No se detectaron productos en la boleta" }, { status: 422 });
    }

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con Gemini" }, { status: 502 });
  }
}
