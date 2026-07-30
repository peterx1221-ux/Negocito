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

/** Palabras de relleno que se ignoran al buscar en lenguaje natural (no aportan al filtro). */
const FILLER_WORDS = new Set([
  "cosas", "cosa", "de", "del", "la", "el", "los", "las", "que", "sean", "sea",
  "algo", "algun", "alguna", "algunos", "algunas", "para", "con", "sin",
  "un", "una", "unos", "unas", "y", "o", "a", "en", "por", "productos", "producto",
]);

type ParsedQuery = { keywords: string[]; minPrice?: number; maxPrice?: number };

function parseAmount(raw: string): number {
  return parseInt(raw.replace(/[.,]/g, ""), 10);
}

// Frases típicas para acotar por precio en español chileno.
const MAX_PRICE_RE = /(?:bajo|menos de|menor a|menor que|debajo de|hasta|no mas de|maximo)\s*\$?\s*([\d.,]+)/;
const MIN_PRICE_RE = /(?:sobre|mas de|mayor a|mayor que|desde|minimo)\s*\$?\s*([\d.,]+)/;
const RANGE_PRICE_RE = /entre\s*\$?\s*([\d.,]+)\s*y\s*\$?\s*([\d.,]+)/;
const BARE_PRICE_RE = /\$\s*([\d.,]+)/;

/**
 * Interpreta una búsqueda en lenguaje natural tipo "cosas de aseo bajo $2000":
 * separa restricciones de precio (bajo/sobre/entre) del resto de las palabras clave.
 */
export function parseNaturalQuery(query: string): ParsedQuery {
  let q = normalizeText(query);
  let minPrice: number | undefined;
  let maxPrice: number | undefined;

  const range = q.match(RANGE_PRICE_RE);
  if (range) {
    minPrice = parseAmount(range[1]);
    maxPrice = parseAmount(range[2]);
    q = q.replace(range[0], " ");
  } else {
    const max = q.match(MAX_PRICE_RE);
    if (max) {
      maxPrice = parseAmount(max[1]);
      q = q.replace(max[0], " ");
    }
    const min = q.match(MIN_PRICE_RE);
    if (min) {
      minPrice = parseAmount(min[1]);
      q = q.replace(min[0], " ");
    }
    if (minPrice === undefined && maxPrice === undefined) {
      const bare = q.match(BARE_PRICE_RE);
      if (bare) {
        maxPrice = parseAmount(bare[1]);
        q = q.replace(bare[0], " ");
      }
    }
  }

  const keywords = q
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !FILLER_WORDS.has(w));

  return { keywords, minPrice, maxPrice };
}

/**
 * Búsqueda "inteligente": entiende restricciones de precio en lenguaje natural
 * ("bajo $2000", "entre 1000 y 3000") además de palabras clave por nombre/categoría.
 * Si no encuentra nada exacto, relaja el calce (alguna palabra en vez de todas) para
 * siempre ofrecer opciones — útil cuando el dictado por voz no es literal.
 */
export function smartFilter<T extends { name: string; category?: string | null; price?: number }>(
  query: string,
  items: T[]
): T[] {
  const q = query.trim();
  if (!q) return items;

  const { keywords, minPrice, maxPrice } = parseNaturalQuery(q);

  const passesPrice = (item: T) => {
    const price = item.price ?? 0;
    if (maxPrice !== undefined && price > maxPrice) return false;
    if (minPrice !== undefined && price < minPrice) return false;
    return true;
  };

  const haystack = (item: T) => normalizeText(`${item.name} ${item.category ?? ""}`);

  const withPrice = items.filter(passesPrice);

  if (keywords.length === 0) return withPrice;

  const strict = withPrice.filter((it) => keywords.every((k) => haystack(it).includes(k)));
  if (strict.length > 0) return strict;

  // Nada calzó exacto — ofrecemos opciones relajando a "alguna palabra clave".
  return withPrice.filter((it) => keywords.some((k) => haystack(it).includes(k)));
}
