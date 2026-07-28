import BottomNav from "@/components/BottomNav";
import Toaster from "@/components/Toaster";
import SignOutButton from "@/components/SignOutButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <div className="topbar">
        <div>
          <h1>Cuaderno</h1>
          <div className="sub">Tu negocio</div>
        </div>
        <SignOutButton />
      </div>

      <div className="screen">{children}</div>

      <Toaster />
      <BottomNav />
    </div>
  );
}
