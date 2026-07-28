import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cuaderno",
  description: "Inventario, ventas y deudores — simple y claro.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
