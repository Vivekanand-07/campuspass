"use client";

import { Suspense } from "react";
import { usePathname, useRouter } from "next/navigation";

function BackButtonContent() {
  const pathname = usePathname();
  const router = useRouter();

  // Homepage par back button mat dikhao.
  if (pathname === "/") {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "10px 14px",
        border: "1px solid var(--border, #333)",
        borderRadius: "12px",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        fontSize: "14px",
      }}
    >
      <span aria-hidden="true">←</span>
      <span>Back</span>
    </button>
  );
}

export default function BackButton() {
  return (
    <Suspense fallback={null}>
      <BackButtonContent />
    </Suspense>
  );
}