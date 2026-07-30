"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
};

/**
 * Input de búsqueda con botón de micrófono (dictado por voz).
 * Si el navegador no soporta reconocimiento de voz, el botón simplemente no aparece
 * y el input funciona como uno normal.
 */
export default function SearchInput({ value, onChange, placeholder, style }: Props) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang = "es-CL";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript ?? "";
      if (text) onChange(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);

    recRef.current = rec;
    setSupported(true);

    return () => {
      try {
        rec.stop();
      } catch {
        // no-op
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleListening() {
    if (!recRef.current) return;
    if (listening) {
      recRef.current.stop();
      setListening(false);
      return;
    }
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  return (
    <div className="search-input-wrap" style={style}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {supported && (
        <button
          type="button"
          className={`search-mic-btn ${listening ? "listening" : ""}`}
          onClick={toggleListening}
          aria-label={listening ? "Detener dictado" : "Buscar por voz"}
          title={listening ? "Detener dictado" : "Buscar por voz"}
        >
          {listening ? "🔴" : "🎙️"}
        </button>
      )}
    </div>
  );
}
