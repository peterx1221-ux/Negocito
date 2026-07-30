import type { PricingRules } from "./types";

/**
 * Calcula el precio sugerido de venta a partir del costo real
 * (costo del producto + su parte proporcional de gastos del viaje).
 * Misma lógica que el mockup original, ahora tipada y reutilizable
 * en cliente y servidor.
 */
export function calcSuggestedPrice(costoReal: number, settings: PricingRules): number {
  let price: number;

  if (costoReal <= settings.low_max) {
    // Costo muy bajo: no funciona razonar en % (ej. $100 → $200 no es vendible),
    // se usa un precio fijo "vendible".
    price = settings.low_price;
  } else if (costoReal <= settings.mid_max) {
    const margen = costoReal * (settings.mid_percent / 100);
    const ganancia = Math.max(margen, settings.mid_min_profit);
    price = costoReal + ganancia;
  } else {
    price = costoReal * (1 + settings.high_percent / 100);
  }

  if (settings.rounding === "990") {
    price = Math.ceil(price / 1000) * 1000 - 10;
  } else if (settings.rounding === "500") {
    price = Math.ceil(price / 500) * 500;
  }

  return Math.round(price);
}

export function tierLabel(costoReal: number, settings: PricingRules): string {
  if (costoReal <= settings.low_max) return "Tramo bajo · redondeo a vendible";
  if (costoReal <= settings.mid_max) return `Tramo medio · ${settings.mid_percent}% margen`;
  return `Tramo alto · ${settings.high_percent}% margen`;
}

/**
 * Precio sugerido cuando un producto se marca "en remate": mismo costo + un
 * margen más chico (settings.remate_percent) en vez de los tramos normales.
 * Se redondea siempre hacia arriba a los $50 más cercanos, para no vender
 * nunca al costo o regalado — pero igual queda editable a mano, como todo.
 */
export function calcRematePrice(costoReal: number, settings: PricingRules): number {
  const raw = costoReal * (1 + settings.remate_percent / 100);
  return Math.ceil(raw / 50) * 50;
}

export function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}
