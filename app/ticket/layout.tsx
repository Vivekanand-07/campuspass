import { Suspense } from "react";

export default function TicketLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
          <div className="mx-auto max-w-xl">
            <p className="text-2xl font-black tracking-tight">
              Campus<span className="text-cyan-400">Pass</span>
            </p>

            <p className="mt-2 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">
              Digital event ticket
            </p>

            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-300">
              Preparing your ticket...
            </div>
          </div>
        </main>
      }
    >
      {children}
    </Suspense>
  );
}