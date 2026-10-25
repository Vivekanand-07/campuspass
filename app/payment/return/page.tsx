"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabase";

type PaymentResult = {
  status: "checking" | "success" | "pending" | "failed";
  message: string;
};

function PaymentReturnContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id");

  const [result, setResult] = useState<PaymentResult>({
    status: "checking",
    message: "Checking your payment status…",
  });

  useEffect(() => {
    let cancelled = false;

    async function checkPayment() {
      if (!orderId) {
        setResult({
          status: "failed",
          message:
            "The payment order ID is missing. We could not check this payment.",
        });
        return;
      }

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError || !session?.access_token) {
          if (!cancelled) {
            setResult({
              status: "failed",
              message:
                "Please sign in again to verify your payment. If money was deducted, check your payment status before paying again.",
            });
          }
          return;
        }

        const response = await fetch(
          `/api/verify?order_id=${encodeURIComponent(orderId)}`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

        const data = await response.json();

        if (cancelled) return;

        if (
          response.ok &&
          data.status === "paid" &&
          data.bookingStatus === "confirmed"
        ) {
          setResult({
            status: "success",
            message:
              "Payment verified successfully. Your booking is confirmed.",
          });
        } else if (
          response.status === 202 ||
          data.status === "pending"
        ) {
          setResult({
            status: "pending",
            message:
              "Your payment is still being processed. Please check again shortly.",
          });
        } else if (response.ok && data.status === "paid") {
          setResult({
            status: "pending",
            message:
              "Payment was received, but your booking is not confirmed yet. Please do not pay again.",
          });
        } else {
          setResult({
            status: "failed",
            message:
              data.error ||
              "We could not verify the payment. Your booking is not confirmed yet.",
          });
        }
      } catch {
        if (!cancelled) {
          setResult({
            status: "pending",
            message:
              "We could not check the payment right now. Please try again.",
          });
        }
      }
    }

    checkPayment();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const isSuccess = result.status === "success";
  const isPending =
    result.status === "pending" || result.status === "checking";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#0b0b14",
        color: "#f7f6ff",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 520,
          padding: 32,
          borderRadius: 20,
          border: "1px solid rgba(169,155,255,.28)",
          background: "#151522",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>
          {result.status === "checking"
            ? "⏳"
            : isSuccess
              ? "✅"
              : isPending
                ? "⌛"
                : "⚠️"}
        </div>

        <p
          style={{
            margin: "0 0 10px",
            color: "#a99bff",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 2,
          }}
        >
          CAMPUSPASS · PAYMENT STATUS
        </p>

        <h1 style={{ margin: "0 0 16px", fontSize: 28 }}>
          {result.status === "checking"
            ? "Checking payment"
            : isSuccess
              ? "Payment successful!"
              : isPending
                ? "Payment processing"
                : "Payment not confirmed"}
        </h1>

        <p style={{ lineHeight: 1.7, color: "#c7c5d8" }}>
          {result.message}
        </p>

        {orderId && (
          <p
            style={{
              marginTop: 20,
              fontSize: 12,
              color: "#9c9aaf",
              overflowWrap: "anywhere",
            }}
          >
            Order ID: {orderId}
          </p>
        )}

        {result.status === "pending" && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 18,
              padding: "12px 18px",
              borderRadius: 10,
              border: "1px solid #a99bff",
              background: "rgba(169,155,255,.12)",
              color: "#f7f6ff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Check again
          </button>
        )}

        <div style={{ marginTop: 26 }}>
          <Link
            href={isSuccess ? "/my-registrations" : "/"}
            style={{
              display: "inline-block",
              padding: "12px 18px",
              borderRadius: 10,
              background: "#a99bff",
              color: "#151522",
              textDecoration: "none",
              fontWeight: 800,
            }}
          >
            {isSuccess ? "View my registrations" : "Back to CampusPass"}
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#0b0b14",
            color: "#f7f6ff",
            fontFamily: "Arial, sans-serif",
          }}
        >
          Checking payment…
        </main>
      }
    >
      <PaymentReturnContent />
    </Suspense>
  );
}