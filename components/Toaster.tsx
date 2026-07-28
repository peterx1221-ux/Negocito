"use client";

import { useEffect, useRef, useState } from "react";

export default function Toaster() {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      setMsg(detail);
      setShow(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShow(false), 2400);
    }
    window.addEventListener("cuaderno:toast", onToast);
    return () => window.removeEventListener("cuaderno:toast", onToast);
  }, []);

  return <div className={`toast ${show ? "show" : ""}`}>{msg}</div>;
}
