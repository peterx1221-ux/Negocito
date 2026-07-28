# Cuaderno

App para llevar inventario, ventas, gastos y deudores de un pequeño negocio,
con escaneo de boletas por IA (Gemini). Cada persona tiene su propia cuenta,
con sus datos completamente separados.

**Stack:** Next.js (App Router) + Supabase (Auth + Postgres) + Vercel (hosting) + API de Gemini (gratis, con la clave del propio usuario).

## 1. Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo (gratis).
2. Ve a **SQL Editor** → pega todo el contenido de `supabase/schema.sql` → **Run**.
   Esto crea las tablas, la seguridad por usuario (RLS) y el trigger que
   prepara la configuración por defecto de cada cuenta nueva.
3. Ve a **Project Settings → API** y copia:
   - `Project URL`
   - `anon public key`
4. Opcional: en **Authentication → Providers**, revisa si quieres exigir
   confirmación de correo al registrarse (activado por defecto).

## 2. Configurar el proyecto localmente

```bash
npm install
cp .env.local.example .env.local
```

Edita `.env.local` y pega los dos valores de Supabase:

```
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
```

Luego:

```bash
npm run dev
```

Abre `http://localhost:3000` — te va a pedir crear una cuenta (correo + contraseña).

## 3. Obtener la clave gratuita de Gemini

Cada usuaria/o pega su propia clave dentro de la app (pantalla **Ajustes**):

1. Ve a [aistudio.google.com](https://aistudio.google.com).
2. Botón **"Get API key"** (no pide tarjeta).
3. Copia la clave y pégala en Ajustes → "Tu clave de API de Gemini".

La clave queda guardada en la cuenta de esa persona en Supabase (tabla
`settings`), protegida por las mismas reglas de seguridad — nadie más puede
leerla.

## 4. Desplegar en Vercel

1. Sube este proyecto a un repositorio de GitHub.
2. En [vercel.com](https://vercel.com), importa el repositorio.
3. En **Environment Variables**, agrega las mismas dos variables de
   `.env.local` (`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Deploy.

## Estructura del proyecto

```
app/
  login/              → inicio de sesión / registro
  (app)/               → pantallas internas (requieren sesión)
    resumen/           → ganancia, gastos, inventario valorizado, alertas
    inventario/        → lista de productos, editar precio/stock, agregar a mano
    vender/            → registrar venta (inventario o manual), marcar al fiado
    deudores/          → quién debe cuánto + historial reciente
    ajustes/           → reglas de precio por tramo + clave de Gemini
    escanear/          → asistente: fotos/PDF → IA → revisión → gastos → precios
  layout.tsx, page.tsx, globals.css
lib/
  supabase/            → clientes de Supabase (browser, server)
  types.ts             → tipos compartidos
  pricing.ts           → calculadora de precio por tramos (idéntica al mockup)
  toast.ts             → notificaciones simples
supabase/
  schema.sql           → tablas + seguridad (RLS) — pégalo en el SQL Editor
middleware.ts          → protege rutas y mantiene la sesión activa
```

## Seguridad

- **La clave de Gemini nunca llega al navegador.** Se guarda en la tabla
  `settings` y solo se lee desde `app/api/gemini/route.ts` (código de
  servidor). El navegador solo manda las fotos/PDF; es el servidor el que
  llama a Gemini con la clave. La pantalla de Ajustes tampoco vuelve a
  mostrar la clave guardada una vez escrita — solo indica si hay una
  guardada o no.
- **RLS (Row Level Security)** está activo en las 5 tablas: cada fila exige
  `auth.uid() = user_id`, así que aunque alguien conozca la URL o la clave
  pública de Supabase, no puede leer ni modificar datos de otra cuenta.
- Las variables `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  están hechas para ser públicas (aparecen en el navegador) — la seguridad
  la da RLS, no el secreto de esa clave.
- Como creador del proyecto en Supabase, tú vas a tener acceso de
  administrador a todos los datos desde el panel de Supabase — eso es
  normal y no depende de la app; nadie más lo tiene salvo que compartas tus
  credenciales de Supabase.
- **Registro abierto:** por defecto, cualquiera con el link puede crear una
  cuenta. Si esta app es solo para tu familia, puedes desactivar el
  registro público en Supabase (Authentication → Providers → Email →
  desactivar "Allow new users to sign up") y crear las cuentas tú mismo
  desde el panel.

## Qué falta / próximos pasos posibles

- **Comparar precio** (fase 2 del plan original): buscar el mismo producto en
  otros lugares — no está implementado todavía.
- Reconocimiento de código de barras: quedó descartado por ahora (las
  boletas no traen el código de los productos).
- Pulir la experiencia de "varias fotos = una sola boleta larga": hoy Gemini
  recibe todas las fotos juntas en una sola llamada y las combina él mismo,
  tal como en el mockup original.
