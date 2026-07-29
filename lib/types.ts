export type Product = {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  photo_path: string | null;
  cost: number;
  price: number;
  stock: number;
  created_at?: string;
  updated_at?: string;
};

/** Categorías sugeridas para mantener consistencia — no es una lista cerrada, se puede escribir otra. */
export const CATEGORY_SUGGESTIONS = [
  "Perfumería y cosmética",
  "Aseo y limpieza",
  "Alimentos y bebidas",
  "Hogar y bazar",
  "Ropa y accesorios",
  "Otros",
];

export type PricingRules = {
  low_max: number;
  low_price: number;
  mid_max: number;
  mid_percent: number;
  mid_min_profit: number;
  high_percent: number;
  rounding: "990" | "500" | "none";
};

export const DEFAULT_PRICING_RULES: PricingRules = {
  low_max: 500,
  low_price: 1000,
  mid_max: 3000,
  mid_percent: 40,
  mid_min_profit: 500,
  high_percent: 35,
  rounding: "990",
};

/**
 * Fila completa de la tabla `settings`, incluyendo la clave real de Gemini.
 * SOLO se debe leer en el servidor (API routes / server components) — nunca
 * en un componente de cliente, para que la clave no viaje al navegador.
 */
export type Settings = PricingRules & {
  user_id: string;
  gemini_key: string | null;
  gemini_model: string;
};

/**
 * Versión segura para usar en componentes de cliente: nunca trae la clave
 * real, solo si existe o no (`gemini_key_set`).
 */
export type SettingsPublic = PricingRules & {
  user_id: string;
  gemini_model: string;
  gemini_key_set: boolean;
};

export function defaultSettingsPublic(user_id: string): SettingsPublic {
  return {
    user_id,
    ...DEFAULT_PRICING_RULES,
    gemini_model: "gemini-3.6-flash",
    gemini_key_set: false,
  };
}

/** Columnas seguras para pedir desde el cliente (excluye gemini_key a propósito). */
export const SETTINGS_PUBLIC_COLUMNS =
  "user_id, low_max, low_price, mid_max, mid_percent, mid_min_profit, high_percent, rounding, gemini_model, gemini_key_set";

export type Sale = {
  id: string;
  user_id: string;
  product_id: string | null;
  product_name: string;
  qty: number;
  unit_price: number;
  unit_cost: number;
  profit: number;
  buyer_name: string | null;
  is_fiado: boolean;
  paid: boolean;
  date: string;
};

export type Debtor = {
  id: string;
  user_id: string;
  sale_id: string | null;
  name: string;
  amount: number;
  paid: boolean;
  created_at: string;
};

export type Purchase = {
  id: string;
  user_id: string;
  description: string;
  amount: number;
  trip_expense: number;
  item_count: number;
  date: string;
};

/** Ítem detectado por la IA al escanear una boleta, antes de guardarse. */
export type ReviewItem = {
  name: string;
  cost: number;
  qty: number;
  confidence: "alta" | "baja";
  category: string;
};
