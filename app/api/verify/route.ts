import { NextResponse } from "next/server";
import { Cashfree, CFEnvironment } from "cashfree-pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { adminSupabase } from "@/app/lib/admin";

const clientId = process.env.CASHFREE_CLIENT_ID;
const clientSecret = process.env.CASHFREE_CLIENT_SECRET;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const cashfree =
  clientId && clientSecret
    ? new Cashfree(CFEnvironment.SANDBOX, clientId, clientSecret)
    : null;

export async function GET(request: Request) {
  try {
    if (!cashfree || !supabaseUrl || !supabasePublishableKey) {
      return NextResponse.json(
        { error: "Payment verification is not configured." },
        { status: 500 }
      );
    }

    // Authenticate the signed-in user.
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const accessToken = tokenMatch?.[1];

    if (!accessToken) {
      return NextResponse.json(
        { error: "Please sign in to verify your payment." },
        { status: 401 }
      );
    }

    const supabase = createSupabaseClient(
      supabaseUrl,
      supabasePublishableKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("order_id");

    if (!orderId || !/^cp_[a-f0-9]{32}$/i.test(orderId)) {
      return NextResponse.json(
        { error: "Invalid payment order ID." },
        { status: 400 }
      );
    }

    // Only the owner of this order can verify it.
    const { data: paymentOrder, error: lookupError } = await adminSupabase
      .from("payment_orders")
      .select(
        "id, order_id, student_id, event_id, ticket_quantity, amount, currency, status, registration_id"
      )
      .eq("order_id", orderId)
      .eq("student_id", user.id)
      .maybeSingle();

    if (lookupError) {
      console.error("Payment order lookup failed:", lookupError.message);
      return NextResponse.json(
        { error: "Could not look up your payment." },
        { status: 500 }
      );
    }

    if (!paymentOrder) {
      return NextResponse.json(
        { error: "Payment order not found for your account." },
        { status: 404 }
      );
    }

    // If already registered, return the existing confirmation.
    if (paymentOrder.status === "paid" && paymentOrder.registration_id) {
      return NextResponse.json({
        status: "paid",
        bookingStatus: "confirmed",
        registrationId: paymentOrder.registration_id,
        message: "Payment verified and booking confirmed successfully.",
      });
    }

    // Verify the actual order with Cashfree.
    const cashfreeResponse = await cashfree.PGFetchOrder(orderId);
    const cashfreeOrder = cashfreeResponse.data;

    if (!cashfreeOrder) {
      return NextResponse.json(
        { error: "Cashfree did not return the order details." },
        { status: 502 }
      );
    }

    const paidAmount = Number(cashfreeOrder.order_amount);
    const expectedAmount = Number(paymentOrder.amount);

    if (
      !Number.isFinite(paidAmount) ||
      paidAmount !== expectedAmount ||
      cashfreeOrder.order_currency !== paymentOrder.currency
    ) {
      console.error("Cashfree order amount/currency mismatch:", orderId);
      return NextResponse.json(
        { error: "Payment details do not match this order." },
        { status: 400 }
      );
    }

    if (cashfreeOrder.order_status !== "PAID") {
      if (
        cashfreeOrder.order_status === "EXPIRED" ||
        cashfreeOrder.order_status === "TERMINATED"
      ) {
        const { error: failedUpdateError } = await adminSupabase
          .from("payment_orders")
          .update({
            status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", paymentOrder.id)
          .eq("status", "pending");

        if (failedUpdateError) {
          console.error(
            "Failed to update expired payment:",
            failedUpdateError.message
          );
          return NextResponse.json(
            { error: "Could not save the failed payment status." },
            { status: 500 }
          );
        }

        return NextResponse.json({
          status: "failed",
          error: "This payment order has expired or failed.",
        });
      }

      return NextResponse.json(
        {
          status: "pending",
          message: "Cashfree has not confirmed the payment yet.",
        },
        { status: 202 }
      );
    }

    // Save verified payment status if it is still pending.
    if (paymentOrder.status === "pending") {
      const { error: updateError } = await adminSupabase
        .from("payment_orders")
        .update({
          status: "paid",
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentOrder.id)
        .eq("status", "pending");

      if (updateError) {
        console.error("Payment status update failed:", updateError.message);
        return NextResponse.json(
          {
            error:
              "Cashfree confirms payment, but we could not save its status. Please do not pay again.",
          },
          { status: 500 }
        );
      }
    }

    // Create the registration using the secure database function.
    const { data: registrationId, error: bookingError } =
      await adminSupabase.rpc("confirm_paid_booking", {
        p_order_id: orderId,
      });

    if (bookingError || !registrationId) {
      console.error(
        "Paid booking confirmation failed:",
        bookingError?.message ?? "No registration ID returned"
      );

      return NextResponse.json({
        status: "paid",
        bookingStatus: "not_confirmed",
        message:
          "Payment is verified, but booking confirmation is still processing. Please do not pay again.",
      });
    }

    return NextResponse.json({
      status: "paid",
      bookingStatus: "confirmed",
      registrationId,
      message: "Payment verified and booking confirmed successfully.",
    });
  } catch (error) {
    console.error(
      "Payment verification failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return NextResponse.json(
      { error: "Could not verify your payment right now." },
      { status: 500 }
    );
  }
}