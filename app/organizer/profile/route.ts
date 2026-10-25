import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminSupabase } from "@/app/lib/admin";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function getSupabaseUserClient(accessToken: string) {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase configuration is missing.");
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];

  if (!token) {
    return {
      user: null,
      error: "Please sign in to continue.",
    };
  }

  const supabase = getSupabaseUserClient(token);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return {
      user: null,
      error: "Your session has expired. Please sign in again.",
    };
  }

  return { user, error: null };
}

export async function GET(request: Request) {
  try {
    const auth = await authenticate(request);

    if (!auth.user) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    const { data, error } = await adminSupabase
      .from("organizers")
      .select(
        "user_id, approved, created_at, full_name, organization_name, email, phone, cashfree_beneficiary_id, payout_status"
      )
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      console.error("Organizer profile lookup failed:", error.message);

      return NextResponse.json(
        { error: "Could not load your organizer profile." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      profile: data ?? {
        user_id: auth.user.id,
        full_name: String(
          auth.user.user_metadata?.full_name ??
          auth.user.user_metadata?.name ??
          ""
        ),
        organization_name: "",
        email: auth.user.email ?? "",
        phone: "",
        cashfree_beneficiary_id: null,
        payout_status: "not_configured",
        approved: false,
      },
    });
  } catch (error) {
    console.error(
      "Organizer profile GET failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return NextResponse.json(
      { error: "Could not load organizer details." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticate(request);

    if (!auth.user) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    const body = await request.json();

    const fullName =
      typeof body.full_name === "string"
        ? body.full_name.trim()
        : "";

    const organizationName =
      typeof body.organization_name === "string"
        ? body.organization_name.trim()
        : "";

    const phone =
      typeof body.phone === "string"
        ? body.phone.trim()
        : "";

    if (
      fullName.length < 2 ||
      fullName.length > 100 ||
      organizationName.length < 2 ||
      organizationName.length > 150 ||
      !/^[0-9+\-\s()]{8,20}$/.test(phone)
    ) {
      return NextResponse.json(
        {
          error:
            "Enter a valid name, organization name, and phone number.",
        },
        { status: 400 }
      );
    }

    const email = auth.user.email;

    if (!email) {
      return NextResponse.json(
        { error: "Your account must have an email address." },
        { status: 400 }
      );
    }

    // Preserve approval and payout status from existing records.
    const { data: existing, error: lookupError } = await adminSupabase
      .from("organizers")
      .select("user_id, approved, cashfree_beneficiary_id, payout_status")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (lookupError) {
      console.error("Organizer profile lookup failed:", lookupError.message);

      return NextResponse.json(
        { error: "Could not check your existing organizer profile." },
        { status: 500 }
      );
    }

    const profileData = {
      user_id: auth.user.id,
      full_name: fullName,
      organization_name: organizationName,
      email,
      phone,
      approved: existing?.approved ?? false,
      cashfree_beneficiary_id:
        existing?.cashfree_beneficiary_id ?? null,
      payout_status:
        existing?.payout_status ?? "not_configured",
    };

    const { data, error } = await adminSupabase
      .from("organizers")
      .upsert(profileData, { onConflict: "user_id" })
      .select(
        "user_id, approved, created_at, full_name, organization_name, email, phone, cashfree_beneficiary_id, payout_status"
      )
      .single();

    if (error) {
      console.error("Organizer profile save failed:", error.message);

      return NextResponse.json(
        {
          error:
            "Could not save organizer details. Please check the organizers table and its constraints.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      profile: data,
      message: "Organizer profile saved successfully.",
    });
  } catch (error) {
    console.error(
      "Organizer profile POST failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return NextResponse.json(
      { error: "Could not save organizer details." },
      { status: 500 }
    );
  }
}