import { NextResponse } from "next/server";
import { Cashfree, CFEnvironment } from "cashfree-pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

import { adminSupabase } from "../../../lib/admin";

const clientId = process.env.CASHFREE_CLIENT_ID;
const clientSecret = process.env.CASHFREE_CLIENT_SECRET;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
).replace(/\/$/, "");

const cashfree =
  clientId && clientSecret
    ? new Cashfree(CFEnvironment.SANDBOX, clientId, clientSecret)
    : null;

export async function POST(request: Request) {
  try {
    if (!cashfree) {
      return NextResponse.json(
        { error: "Cashfree Sandbox credentials are missing." },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !supabasePublishableKey) {
      return NextResponse.json(
        { error: "Supabase configuration is missing." },
        { status: 500 }
      );
    }

    // Authenticate the student.
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const accessToken = tokenMatch?.[1];

    if (!accessToken) {
      return NextResponse.json(
        { error: "Please sign in before booking a ticket." },
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
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        {
          error:
            "Your login session is invalid or expired. Please sign in again.",
        },
        { status: 401 }
      );
    }

    const body = await request.json();

    const eventId = body?.eventId;
    const quantity = body?.quantity;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
      typeof eventId !== "string" ||
      !uuidRegex.test(eventId) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 5
    ) {
      return NextResponse.json(
        { error: "Invalid event or ticket quantity." },
        { status: 400 }
      );
    }

    // Verify the published event.
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, title, status, ends_at, payment_type, ticket_price")
      .eq("id", eventId)
      .eq("status", "published")
      .maybeSingle();

    if (eventError) {
      console.error("Event lookup failed:", eventError.message);

      return NextResponse.json(
        { error: "Could not verify the event." },
        { status: 500 }
      );
    }

    if (!event) {
      return NextResponse.json(
        { error: "This event is unavailable." },
        { status: 404 }
      );
    }

    const expiryTime = event.ends_at
      ? new Date(event.ends_at).getTime()
      : Number.NaN;

    if (!Number.isFinite(expiryTime) || expiryTime <= Date.now()) {
      return NextResponse.json(
        { error: "This event has already ended." },
        { status: 400 }
      );
    }

    if (event.payment_type !== "paid") {
      return NextResponse.json(
        {
          error:
            "This is a free event. Use the normal registration flow.",
        },
        { status: 400 }
      );
    }

    const ticketPrice = Number(event.ticket_price);

    if (!Number.isFinite(ticketPrice) || ticketPrice <= 0) {
      return NextResponse.json(
        { error: "The ticket price is invalid." },
        { status: 400 }
      );
    }

    // Calculate the total booking amount.
    const amount = Number((ticketPrice * quantity).toFixed(2));

    // Calculate the platform's 2% commission.
    const platformFee = Number((amount * 0.02).toFixed(2));

    const amountInPaise = Math.round(amount * 100);

    if (
      !Number.isSafeInteger(amountInPaise) ||
      amountInPaise < 100 ||
      amountInPaise > 10000000
    ) {
      return NextResponse.json(
        { error: "The payment amount is outside the allowed limits." },
        { status: 400 }
      );
    }

    if (!user.email) {
      return NextResponse.json(
        {
          error:
            "Your account has no email address. Please update your account.",
        },
        { status: 400 }
      );
    }

    const orderId = `cp_${randomUUID().replace(/-/g, "")}`;

    const customerName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      "CampusPass Student";

    // Create the Cashfree Sandbox order.
    const cashfreeResponse = await cashfree.PGCreateOrder({
      order_id: orderId,
      order_amount: amount,
      order_currency: "INR",
      customer_details: {
        customer_id: user.id,
        customer_name: String(customerName).slice(0, 100),
        customer_email: user.email,
        customer_phone: "9999999999",
      },
      order_meta: {
        return_url: `${siteUrl}/payment/return?order_id=${encodeURIComponent(
          orderId
        )}`,
      },
      order_note: `CampusPass: ${event.title}, ${quantity} ticket(s)`,
    });

    const paymentSessionId =
      cashfreeResponse.data?.payment_session_id;

    if (!paymentSessionId) {
      console.error("Cashfree did not return a payment session ID.");

      return NextResponse.json(
        { error: "Cashfree could not start the payment." },
        { status: 502 }
      );
    }

    // Save the pending payment and platform commission.
    const { error: saveError } = await adminSupabase
      .from("payment_orders")
      .insert({
        order_id: orderId,
        payment_session_id: paymentSessionId,
        student_id: user.id,
        event_id: event.id,
        ticket_quantity: quantity,
        amount,
        platform_fee: platformFee,
        currency: "INR",
        status: "pending",
      });

    if (saveError) {
      console.error("Failed to save payment order:", saveError.message);

      return NextResponse.json(
        {
          error:
            "Could not save the payment order. Please try again.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      orderId,
      paymentSessionId,
      amount,
      currency: "INR",
    });
  } catch (error) {
    console.error(
      "Create payment order failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return NextResponse.json(
      { error: "Could not create the payment order." },
      { status: 500 }
    );
  }
}