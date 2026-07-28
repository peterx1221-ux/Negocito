"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/resumen", icon: "🏠", label: "Resumen" },
  { href: "/inventario", icon: "📦", label: "Inventario" },
  { href: "/vender", icon: "➕", label: "Vender" },
  { href: "/deudores", icon: "📖", label: "Deudores" },
  { href: "/ajustes", icon: "⚙️", label: "Ajustes" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="bottomnav">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`navbtn ${pathname?.startsWith(tab.href) ? "active" : ""}`}
        >
          <span className="ic">{tab.icon}</span>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
