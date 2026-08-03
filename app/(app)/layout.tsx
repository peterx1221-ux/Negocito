import BottomNav from "@/components/BottomNav";
import Toaster from "@/components/Toaster";
import SignOutButton from "@/components/SignOutButton";
import NotificationsBell from "@/components/NotificationsBell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <div className="topbar">
        <div>
          <h1>Cuaderno</h1>
          <div className="sub">Tu negocio</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <NotificationsBell />
          <SignOutButton />
        </div>
      </div>

      <div className="screen">{children}</div>

      <Toaster />
      <BottomNav />
    </div>
  );
}
