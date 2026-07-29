import { createClient } from "@/lib/supabase/client";

export const PHOTOS_BUCKET = "product-photos";

export function photoPathFor(userId: string, productId: string): string {
  return `${userId}/${productId}.jpg`;
}

/** Sube (o reemplaza) la foto de un producto. Devuelve la ruta guardada, o null si falló. */
export async function uploadProductPhoto(userId: string, productId: string, blob: Blob): Promise<string | null> {
  const supabase = createClient();
  const path = photoPathFor(userId, productId);
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) return null;
  return path;
}

export async function deleteProductPhoto(path: string): Promise<void> {
  const supabase = createClient();
  await supabase.storage.from(PHOTOS_BUCKET).remove([path]);
}

/** Pide URLs firmadas (temporales) para poder mostrar varias fotos privadas de una vez. */
export async function getSignedUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const supabase = createClient();
  const { data } = await supabase.storage.from(PHOTOS_BUCKET).createSignedUrls(paths, 3600);
  const map: Record<string, string> = {};
  (data ?? []).forEach((item) => {
    if (item.signedUrl && item.path) map[item.path] = item.signedUrl;
  });
  return map;
}
