export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** true si `query` aparece en alguno de los campos dados (ignorando tildes/mayúsculas). Vacío = todo calza. */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  return fields.some((f) => f && normalizeText(f).includes(q));
}
