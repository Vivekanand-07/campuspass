
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type TicketEvent = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  venue: string | null;
  starts_at: string;
  organizer_id: string | null;
};

type Booking = {
  id: string;
  event_id: string;
  ticket_quantity: number;
  checked_in: boolean;
  checked_in_at: string | null;
};

type CheckInResult = {
  status: "checked_in" | "already_checked_in";
  event_title: string;
  ticket_quantity: number;
  checked_in_at: string | null;
};

type TicketPageProps = {
  params: Promise<{ ticketId: string }>;
};

const REQUEST_TIMEOUT_MS = 10000;

function withTimeout<T>(
  request: PromiseLike<T>,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    Promise.resolve(request),
    new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out after 10 seconds`));
      }, REQUEST_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export default function TicketPage({ params }: TicketPageProps) {
  const { ticketId } = use(params);

  const [event, setEvent] = useState<TicketEvent | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [isAssignedOrganizer, setIsAssignedOrganizer] = useState(false);
  const [message, setMessage] = useState("");
  const [checkInMessage, setCheckInMessage] = useState("");
  const [checkInError, setCheckInError] = useState(false);

  useEffect(() => {
    let active = true;
    let completed = false;

    const finishWithError = (text: string) => {
      if (!active || completed) return;
      completed = true;
      setMessage(text);
      setLoading(false);
    };

    const failSafe = window.setTimeout(() => {
      finishWithError(
        "Ticket loading exceeded 15 seconds. Check your connection and reload. If the problem continues, the event database request may be blocked or unavailable."
      );
    }, 15000);

    async function loadTicket() {
      setLoading(true);
      setMessage("");
      setEvent(null);
      setBooking(null);
      setTicketQuantity(1);
      setIsAssignedOrganizer(false);
      setCheckInMessage("");
      setCheckInError(false);

      if (!ticketId || ticketId === "Unavailable") {
        finishWithError("This ticket link is incomplete or invalid.");
        return;
      }

      try {
        const urlParams = new URLSearchParams(window.location.search);
        const eventIdFromUrl = urlParams.get("eventId");
        const quantityFromUrl = Number(urlParams.get("ticketQuantity"));

        if (
          Number.isFinite(quantityFromUrl) &&
          quantityFromUrl > 0
        ) {
          setTicketQuantity(Math.floor(quantityFromUrl));
        }

        let loadedBooking: Booking | null = null;
        let eventId = eventIdFromUrl;

        // If eventId is missing from the QR, try finding the booking first.
        if (!eventId) {
          console.info("[CampusPass ticket] QR has no eventId; looking up booking.");

          const { data, error } = await withTimeout(
            supabase
              .from("registrations")
              .select(
                "id, event_id, ticket_quantity, checked_in, checked_in_at"
              )
              .eq("id", ticketId)
              .maybeSingle(),
            "Booking lookup"
          );

          if (!active || completed) return;

          if (error) {
            console.error("[CampusPass ticket] Booking lookup failed:", error);
            finishWithError(
              `Booking lookup failed: ${error.message}`
            );
            return;
          }

          if (!data) {
            finishWithError(
              "We couldn't find this booking. Open My Registrations and scan its current QR code."
            );
            return;
          }

          loadedBooking = data as Booking;
          eventId = loadedBooking.event_id;
        }

        if (!eventId) {
          finishWithError(
            "This QR code does not contain a valid event ID."
          );
          return;
        }

        console.info("[CampusPass ticket] Loading event:", eventId);

        // Event details are loaded separately so the page can show the
        // precise error if public event access or the network fails.
        const { data: eventData, error: eventError } = await withTimeout(
          supabase
            .from("events")
            .select(
              "id, title, description, category, venue, starts_at, organizer_id"
            )
            .eq("id", eventId)
            .maybeSingle(),
          "Event details lookup"
        );

        if (!active || completed) return;

        if (eventError) {
          console.error("[CampusPass ticket] Event query failed:", eventError);
          finishWithError(
            `We couldn't load the event: ${eventError.message}. Check the events table permissions and your Supabase connection.`
          );
          return;
        }

        if (!eventData) {
          finishWithError(
            "No event was found for this QR code. The event ID may be incorrect, or the event may not be publicly readable."
          );
          return;
        }

        const loadedEvent = eventData as TicketEvent;

        setEvent(loadedEvent);
        completed = true;
        setLoading(false);

        console.info("[CampusPass ticket] Event loaded successfully.");

        // Booking details are optional for displaying event information.
        if (!loadedBooking) {
          try {
            const { data, error } = await withTimeout(
              supabase
                .from("registrations")
                .select(
                  "id, event_id, ticket_quantity, checked_in, checked_in_at"
                )
                .eq("id", ticketId)
                .maybeSingle(),
              "Booking details lookup"
            );

            if (!active) return;

            if (error) {
              console.warn(
                "[CampusPass ticket] Booking details unavailable:",
                error
              );
            } else if (data) {
              loadedBooking = data as Booking;
            }
          } catch (error) {
            console.warn(
              "[CampusPass ticket] Booking lookup did not finish:",
              error
            );
          }
        }

        if (active && loadedBooking) {
          setBooking(loadedBooking);
          setTicketQuantity(
            Math.max(1, Number(loadedBooking.ticket_quantity) || 1)
          );
        }

        // Organizer verification must not prevent a ticket from displaying.
        try {
          const {
            data: { user },
            error: authError,
          } = await withTimeout(
            supabase.auth.getUser(),
            "Organizer authentication lookup"
          );

          if (
            !active ||
            authError ||
            !user ||
            loadedEvent.organizer_id !== user.id
          ) {
            return;
          }

          const { data: profile, error: profileError } = await withTimeout(
            supabase
              .from("profiles")
              .select("role")
              .eq("id", user.id)
              .maybeSingle(),
            "Organizer profile lookup"
          );

          if (
            active &&
            !profileError &&
            profile?.role === "organizer"
          ) {
            setIsAssignedOrganizer(true);
          }
        } catch (error) {
          console.warn(
            "[CampusPass ticket] Organizer verification unavailable:",
            error
          );
        }
      } catch (error) {
        console.error("[CampusPass ticket] Loading failed:", error);

        finishWithError(
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while loading this ticket."
        );
      }
    }

    void loadTicket();

    return () => {
      active = false;
      window.clearTimeout(failSafe);
    };
  }, [ticketId]);

  async function handleCheckIn() {
    if (!booking || !isAssignedOrganizer || checkingIn) return;

    setCheckingIn(true);
    setCheckInMessage("");
    setCheckInError(false);

    try {
      const { data, error } = await withTimeout(
        supabase.rpc("check_in_booking", {
          p_registration_id: booking.id,
        }),
        "Check-in request"
      );

      if (error) throw new Error(error.message);

      const result = data as CheckInResult;

      if (
        result.status !== "checked_in" &&
        result.status !== "already_checked_in"
      ) {
        throw new Error("Unexpected check-in response from the server.");
      }

      setBooking((previous) =>
        previous
          ? {
              ...previous,
              checked_in: true,
              checked_in_at:
                result.checked_in_at ?? previous.checked_in_at,
            }
          : previous
      );

      setTicketQuantity(
        Math.max(1, Number(result.ticket_quantity) || 1)
      );

      setCheckInMessage(
        result.status === "already_checked_in"
          ? "This booking has already been checked in."
          : `Check-in successful! ${result.ticket_quantity} ticket(s) checked in for ${result.event_title}.`
      );
    } catch (error) {
      console.error("[CampusPass ticket] Check-in failed:", error);
      setCheckInError(true);

      setCheckInMessage(
        error instanceof Error
          ? error.message.includes("assigned event organizer")
            ? "Access denied. Only the assigned event organizer can check in this booking."
            : error.message.includes("sign in")
              ? "Please sign in with the assigned organizer account."
              : `Check-in failed: ${error.message}`
          : "Check-in failed. Please try again."
      );
    } finally {
      setCheckingIn(false);
    }
  }

  function formatDate(value: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Date to be announced";
    }

    return date.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatTicketId(id: string) {
    return `CP-${id.replace(/-/g, "").toUpperCase()}`;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="text-2xl font-black tracking-tight">
          Campus<span className="text-cyan-400">Pass</span>
        </Link>

        <p className="mt-2 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">
          Digital event ticket
        </p>

        {loading ? (
          <div
            role="status"
            className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-300"
          >
            Loading ticket details...
          </div>
        ) : message ? (
          <div
            role="alert"
            className="mt-8 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-6"
          >
            <h1 className="text-xl font-bold">Ticket could not be loaded</h1>
            <p className="mt-3 break-words text-amber-100">{message}</p>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950"
            >
              Retry
            </button>

            <Link
              href="/my-registrations"
              className="ml-3 mt-5 inline-flex rounded-xl border border-white/20 px-5 py-3 font-bold text-white"
            >
              My Registrations
            </Link>
          </div>
        ) : event ? (
          <article className="campuspass-ticket mt-8 overflow-hidden rounded-3xl border border-cyan-300/40 bg-slate-900 shadow-2xl shadow-cyan-950/30">
            <div className="flex items-center justify-between gap-3 border-b border-dashed border-white/15 bg-cyan-400/10 px-6 py-5">
              <span className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">
                CampusPass · Digital Ticket
              </span>

              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  booking?.checked_in
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-white/10 text-slate-300"
                }`}
              >
                {booking?.checked_in ? "✓ Checked in" : "Ticket opened"}
              </span>
            </div>

            <div className="p-6">
              <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                {event.category || "Campus event"}
              </span>

              <h1 className="mt-4 text-3xl font-black">{event.title}</h1>

              <p className="mt-3 text-sm leading-6 text-slate-300">
                {event.description || "No event description provided."}
              </p>

              <div className="mt-6 space-y-3 text-sm text-slate-200">
                <p>📅 {formatDate(event.starts_at)}</p>
                <p>📍 {event.venue || "Venue to be announced"}</p>
              </div>

              <div className="mt-6 rounded-2xl border border-cyan-300/40 bg-cyan-400/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Booking quantity
                </p>
                <p className="mt-2 text-2xl font-black text-cyan-200">
                  {ticketQuantity}{" "}
                  <span className="text-base font-semibold">
                    {ticketQuantity === 1 ? "ticket" : "tickets"}
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  One booking QR covers this entire quantity.
                </p>
              </div>

              <div className="mt-6 rounded-2xl border border-dashed border-cyan-300/40 bg-slate-950/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Unique ticket ID
                </p>
                <p className="mt-2 break-all font-mono text-sm font-bold tracking-wide text-cyan-200">
                  {formatTicketId(ticketId)}
                </p>
              </div>

              {booking?.checked_in && (
                <div className="mt-5 rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-4">
                  <p className="font-bold text-emerald-300">
                    This booking has already been checked in.
                  </p>
                  {booking.checked_in_at && (
                    <p className="mt-1 text-sm text-emerald-100/80">
                      Checked in at: {formatDate(booking.checked_in_at)}
                    </p>
                  )}
                </div>
              )}

              {checkInMessage && (
                <div
                  role="status"
                  className={`mt-5 rounded-xl border p-4 text-sm ${
                    checkInError
                      ? "border-red-300/30 bg-red-400/10 text-red-200"
                      : "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
                  }`}
                >
                  {checkInMessage}
                </div>
              )}

              {isAssignedOrganizer && booking && (
                <div className="mt-6 print:hidden">
                  <p className="mb-3 text-sm text-slate-400">
                    Organizer controls
                  </p>
                  <button
                    type="button"
                    onClick={handleCheckIn}
                    disabled={checkingIn || booking.checked_in}
                    className="w-full rounded-xl bg-emerald-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkingIn
                      ? "Checking in..."
                      : booking.checked_in
                        ? "Already checked in"
                        : "✓ Check in this booking"}
                  </button>
                  <p className="mt-2 text-xs text-slate-400">
                    This checks in the entire booking quantity, not individual
                    tickets.
                  </p>
                </div>
              )}

              {!isAssignedOrganizer && (
                <p className="mt-5 text-sm text-slate-400">
                  Keep this ticket for event entry. Only the assigned event
                  organizer can check in this booking.
                </p>
              )}

              <button
                type="button"
                onClick={() => window.print()}
                className="mt-6 w-full rounded-xl bg-cyan-400 px-4 py-3 font-bold text-slate-950 hover:bg-cyan-300 print:hidden"
              >
                🖨️ Print ticket
              </button>
            </div>
          </article>
        ) : (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-300">
            No ticket details are available.
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          CampusPass · Keep campus events connected.
        </p>
      </div>

      <style jsx global>{`
        @media print {
          body {
            background: white !important;
          }

          body * {
            visibility: hidden !important;
          }

          .campuspass-ticket,
          .campuspass-ticket * {
            visibility: visible !important;
          }

          .campuspass-ticket {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            color: black !important;
            background: white !important;
            box-shadow: none !important;
            border-color: black !important;
          }
        }
      `}</style>
    </main>
  );
}
