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
  // palabras de precio aproximado / unidades de plata chilenas — se manejan aparte,
  // así que si sobra alguna suelta no debe colarse como palabra clave.
  "cercano", "cerca", "aprox", "aproximadamente", "alrededor", "como",
  "mil", "lucas", "luca", "palos", "palo", "pesos",
]);

type ParsedQuery = { keywords: string[]; minPrice?: number; maxPrice?: number; approxPrice?: number };

function parseAmount(raw: string): number {
  return parseInt(raw.replace(/[.,]/g, ""), 10);
}

/** "20 lucas" → 20 * 1000, "2 palos" → 2 * 1.000.000, "20.000"/"pesos" → tal cual. */
function unitMultiplier(unit: string | undefined): number {
  if (!unit) return 1;
  if (unit.startsWith("luca") || unit === "mil") return 1000;
  if (unit.startsWith("palo")) return 1_000_000;
  return 1; // "pesos" u otra palabra sin efecto en la magnitud
}

/** Recibe una frase de monto ya capturada ("20", "20.000", "20 lucas", "2mil") y la convierte a pesos. */
function parseAmountPhrase(phrase: string): number {
  const digits = phrase.match(/[\d.,]+/)?.[0] ?? "0";
  const unit = phrase.match(/lucas?|palos?|mil/)?.[0];
  return parseAmount(digits) * unitMultiplier(unit);
}

// Un monto: dígitos (con puntos/comas de miles) + unidad chilena opcional (lucas/palos/mil).
const AMOUNT = "\\d[\\d.,]*(?:\\s*(?:lucas?|palos?|mil))?";

// Frases típicas para acotar por precio en español chileno — admiten "$2.000", "2000" o "2 lucas" por igual.
const MAX_PRICE_RE = new RegExp(`(?:bajo|menos de|menor a|menor que|debajo de|hasta|no mas de|maximo)\\s*\\$?\\s*(${AMOUNT})`);
const MIN_PRICE_RE = new RegExp(`(?:sobre|mas de|mayor a|mayor que|desde|minimo)\\s*\\$?\\s*(${AMOUNT})`);
const RANGE_PRICE_RE = new RegExp(`entre\\s*\\$?\\s*(${AMOUNT})\\s*y\\s*\\$?\\s*(${AMOUNT})`);
// Un monto suelto sin "bajo/sobre/entre" — "perfume de 20 lucas", "cercano a $5000", "colonia 20mil" —
// se toma como precio APROXIMADO (un objetivo, no un tope), ya que así se usa naturalmente al hablar.
const APPROX_PRICE_RE = new RegExp(`\\$\\s*(${AMOUNT})|(\\d[\\d.,]*\\s*(?:lucas?|palos?|mil|pesos))`);

/**
 * Interpreta una búsqueda en lenguaje natural tipo "perfume de 20 lucas" o
 * "cosas de aseo bajo $2000": separa restricciones de precio (bajo/sobre/entre/aprox)
 * del resto de las palabras clave, entendiendo "lucas"/"palos" como plata chilena.
 */
export function parseNaturalQuery(query: string): ParsedQuery {
  let q = normalizeText(query);
  let minPrice: number | undefined;
  let maxPrice: number | undefined;
  let approxPrice: number | undefined;

  const range = q.match(RANGE_PRICE_RE);
  if (range) {
    minPrice = parseAmountPhrase(range[1]);
    maxPrice = parseAmountPhrase(range[2]);
    q = q.replace(range[0], " ");
  } else {
    const max = q.match(MAX_PRICE_RE);
    if (max) {
      maxPrice = parseAmountPhrase(max[1]);
      q = q.replace(max[0], " ");
    }
    const min = q.match(MIN_PRICE_RE);
    if (min) {
      minPrice = parseAmountPhrase(min[1]);
      q = q.replace(min[0], " ");
    }
    if (minPrice === undefined && maxPrice === undefined) {
      const approx = q.match(APPROX_PRICE_RE);
      if (approx) {
        approxPrice = parseAmountPhrase(approx[1] ?? approx[2] ?? "");
        q = q.replace(approx[0], " ");
      }
    }
  }

  const keywords = q
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !FILLER_WORDS.has(w));

  return { keywords, minPrice, maxPrice, approxPrice };
}

/**
 * Búsqueda "inteligente": entiende restricciones de precio en lenguaje natural
 * ("bajo $2000", "entre 1000 y 3000", "de 20 lucas", "cercano a 15 mil") además
 * de palabras clave por nombre/categoría. Si no encuentra nada exacto, relaja el
 * calce (alguna palabra en vez de todas) para siempre ofrecer opciones — útil
 * cuando el dictado por voz no es literal.
 */
export function smartFilter<T extends { name: string; category?: string | null; price?: number }>(
  query: string,
  items: T[]
): T[] {
  const q = query.trim();
  if (!q) return items;

  const { keywords, minPrice, maxPrice, approxPrice } = parseNaturalQuery(q);

  const passesHardPrice = (item: T) => {
    const price = item.price ?? 0;
    if (maxPrice !== undefined && price > maxPrice) return false;
    if (minPrice !== undefined && price < minPrice) return false;
    return true;
  };

  const haystack = (item: T) => normalizeText(`${item.name} ${item.category ?? ""}`);

  const withPrice = items.filter(passesHardPrice);

  let results: T[];
  if (keywords.length === 0) {
    results = withPrice;
  } else {
    const strict = withPrice.filter((it) => keywords.every((k) => haystack(it).includes(k)));
    // Nada calzó exacto — ofrecemos opciones relajando a "alguna palabra clave".
    results = strict.length > 0 ? strict : withPrice.filter((it) => keywords.some((k) => haystack(it).includes(k)));
  }

  if (approxPrice !== undefined) {
    const distance = (it: T) => Math.abs((it.price ?? 0) - approxPrice);
    // Preferimos los que están razonablemente cerca (±35%); si nada cae en esa
    // ventana, igual mostramos las opciones más cercanas que haya, más cercano primero.
    const tolerance = approxPrice * 0.35;
    const close = results.filter((it) => distance(it) <= tolerance);
    const base = close.length > 0 ? close : results;
    results = [...base].sort((a, b) => distance(a) - distance(b));
  }

  return results;
}
