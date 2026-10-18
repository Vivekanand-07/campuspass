"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

type Event = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  venue: string | null;
  starts_at: string;
  ticketId: string;
  ticketQuantity: number;
};

export default function MyRegistrationsPage() {
  const router = useRouter();

  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [ticketToPrint, setTicketToPrint] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("light");

  // Reuse the same saved theme preference as the homepage Settings menu.
  useEffect(() => {
    const savedTheme = window.localStorage.getItem("campuspass-theme");
    const initialTheme = savedTheme === "light" ? "light" : "dark";
    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
  }, []);

  useEffect(() => {
    let active = true;

    async function loadRegistrations() {
      setLoading(true);
      setErrorMessage("");

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (!active) return;

      if (sessionError || !sessionData.session) {
        router.replace("/login");
        return;
      }

      const user = sessionData.session.user;
      setUserEmail(user.email ?? "");

      // Read the registration record ID as the unique ticket identifier.
      const { data: registrations, error: registrationsError } =
        await supabase
          .from("registrations")
          .select("id, event_id, ticket_quantity")
          .eq("student_id", user.id);

      if (!active) return;

      if (registrationsError) {
        console.error("Could not load registrations:", registrationsError);
        setErrorMessage(
          "We couldn't load your registrations. Please try again."
        );
        setLoading(false);
        return;
      }

      // Keep every registration row. A student can book the same event
      // more than once, and each booking must have its own QR code.
      const allRegistrations = registrations ?? [];
      const eventIds = [...new Set(allRegistrations.map((item) => item.event_id))];

      if (allRegistrations.length === 0 || eventIds.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const { data: registeredEvents, error: eventsError } = await supabase
        .from("events")
        .select("id, title, description, category, venue, starts_at")
        .in("id", eventIds);

      if (!active) return;

      if (eventsError) {
        console.error("Could not load registered event details:", eventsError);
        setErrorMessage(
          "Your registrations were found, but we couldn't load the event details."
        );
      } else {
        const eventById = new Map(
          (registeredEvents ?? []).map((event) => [event.id, event])
        );

        // Map registrations, not events, so separate bookings stay separate.
        const eventTickets = allRegistrations
          .map((registration) => {
            const event = eventById.get(registration.event_id);
            if (!event) return null;

            return {
              ...(event as Omit<Event, "ticketId" | "ticketQuantity">),
              ticketId: registration.id,
              ticketQuantity: Math.max(
                1,
                Number(registration.ticket_quantity) || 1
              ),
            };
          })
          .filter((ticket): ticket is Event => ticket !== null)
          .sort(
            (a, b) =>
              new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
          );

        setEvents(eventTickets);
      }

      setLoading(false);
    }

    void loadRegistrations();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setErrorMessage("Couldn't sign out. Please try again.");
      return;
    }

    router.replace("/login");
  }

  function formatDate(date: string) {
    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return "Date to be announced";
    }

    return parsedDate.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatTicketId(id: string) {
    if (id === "Unavailable") return id;
    return `CP-${id.replace(/-/g, "").toUpperCase()}`;
  }

  function printTicket(ticketId: string) {
    // State first selects one ticket; the print effect runs after React renders it.
    setTicketToPrint(ticketId);
  }

  useEffect(() => {
    if (!ticketToPrint) return;

    const previousTitle = document.title;
    document.title = `CampusPass-${formatTicketId(ticketToPrint)}`;

    const restoreAfterPrint = () => {
      document.title = previousTitle;
      setTicketToPrint(null);
    };

    window.addEventListener("afterprint", restoreAfterPrint, { once: true });
    // Wait for the selected-ticket attribute to render before opening print.
    requestAnimationFrame(() => window.print());

    return () => {
      window.removeEventListener("afterprint", restoreAfterPrint);
      document.title = previousTitle;
    };
  }, [ticketToPrint]);

  return (
    <main data-theme={theme} className="campuspass-registrations min-h-screen w-full overflow-x-hidden bg-[#f7f6fb] text-slate-900">
      <header className="border-b border-slate-200 bg-white/90 print:hidden">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-5">
          <Link href="/" className="w-fit text-2xl font-black tracking-tight">
            Campus<span className="text-violet-600">Pass</span>
          </Link>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
            <Link
              href="/"
              className="min-h-11 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-center text-sm font-semibold transition hover:bg-slate-100 sm:flex-none sm:px-4"
            >
              Browse events
            </Link>

            <button
              onClick={handleSignOut}
              className="min-h-11 flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-violet-100 sm:flex-none sm:px-4"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-5 sm:py-12">
        <div className="mb-6 sm:mb-8 print:hidden">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-violet-600">
            Your CampusPass account
          </p>

          <h1 className="break-words text-3xl font-black tracking-tight sm:text-5xl">
            My Registrations
          </h1>

          <p className="mt-3 text-slate-600">
            Your event registrations and digital tickets, all in one place.
          </p>

          {userEmail && (
            <p className="mt-2 text-sm text-slate-500">{userEmail}</p>
          )}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-600">
            Loading your registrations...
          </div>
        ) : errorMessage ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 print:hidden"
          >
            <p>{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold hover:bg-red-50"
            >
              Try again
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center print:hidden">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-2xl">
              🎟️
            </div>

            <h2 className="text-xl font-bold">No registrations yet</h2>

            <p className="mx-auto mt-2 max-w-md text-slate-600">
              Explore campus events and register for the ones you like.
              Your registrations and tickets will appear here.
            </p>

            <Link
              href="/"
              className="mt-6 inline-flex rounded-xl bg-violet-500 px-5 py-3 font-bold text-slate-950 transition hover:bg-violet-600"
            >
              Explore events
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <h2 className="text-lg font-bold">Your event tickets</h2>
              <span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-semibold text-violet-700">
                {events.reduce((total, event) => total + event.ticketQuantity, 0)} {events.reduce((total, event) => total + event.ticketQuantity, 0) === 1 ? "ticket" : "tickets"}
              </span>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 print:block">
              {events.map((event) => (
                <article
                  key={event.ticketId}
                  data-ticket-id={event.ticketId}
                  data-print-selected={ticketToPrint === event.ticketId ? "true" : "false"}
                  className="campuspass-ticket flex min-w-0 flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-lg shadow-slate-200/70 print:mb-6 print:break-inside-avoid print:border-black print:bg-white print:text-black print:shadow-none"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-slate-200 bg-violet-100 px-4 py-4 sm:px-5 print:border-black/30 print:bg-white">
                    <span className="min-w-0 max-w-[65%] break-words text-xs font-black uppercase tracking-[0.14em] text-violet-700 sm:tracking-[0.18em] print:text-black">
                      CampusPass · Digital Ticket
                    </span>
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 print:border print:border-black print:bg-white print:text-black">
                      ✓ Registered
                    </span>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
                    <span className="mb-3 w-fit rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-slate-700 print:border print:border-black/20 print:bg-white print:text-black">
                      {event.category || "Campus event"}
                    </span>

                    <h3 className="break-words text-xl font-black leading-tight sm:text-2xl print:text-black">
                      {event.title}
                    </h3>

                    <p className="mt-3 break-words text-sm leading-6 text-slate-600 sm:line-clamp-3 print:text-black">
                      {event.description || "No event description provided."}
                    </p>

                    <div className="mt-5 space-y-3 break-words text-sm text-slate-700 print:text-black">
                      <p><span className="mr-2">📅</span>{formatDate(event.starts_at)}</p>
                      <p><span className="mr-2">📍</span>{event.venue || "Venue to be announced"}</p>
                    </div>

                    <div className="mt-5 min-w-0 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 sm:px-4 print:border-black print:bg-white">
                      <p className="break-words text-base font-black text-emerald-800 sm:text-lg print:text-black">🎟️ {event.ticketQuantity} {event.ticketQuantity === 1 ? "Ticket" : "Tickets"} Booked</p>
                      <p className="mt-1 text-xs text-emerald-700 print:text-black">This booking quantity is linked to your registration record.</p>
                    </div>

                    <div className="mt-4 min-w-0 rounded-xl border border-dashed border-violet-300 bg-violet-50 p-3 sm:p-4 print:border-black print:bg-white">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 print:text-black">
                        Unique booking / ticket ID
                      </p>
                      <p className="mt-2 break-all font-mono text-xs font-bold tracking-normal text-violet-700 sm:text-sm sm:tracking-wide print:text-black">
                        {formatTicketId(event.ticketId)}
                      </p>
                      <p className="mt-2 text-xs text-slate-500 print:text-black">
                        Keep this ID available for event check-in.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => printTicket(event.ticketId)}
                      className="mt-5 min-h-12 w-full rounded-xl bg-violet-500 px-4 py-3 text-center text-sm font-bold text-slate-950 transition hover:bg-violet-600 print:hidden"
                    >
                      🖨️ View / Print ticket
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
      <style jsx global>{`
        .campuspass-registrations[data-theme="dark"] {
          background: #10101b !important;
          color: #f7f6ff !important;
        }
        .campuspass-registrations[data-theme="dark"] header {
          background: rgba(20, 21, 37, .96) !important;
          border-color: rgba(255,255,255,.12) !important;
        }
        .campuspass-registrations[data-theme="dark"] header a,
        .campuspass-registrations[data-theme="dark"] header button {
          color: #f7f6ff !important;
          border-color: rgba(255,255,255,.18) !important;
        }
        .campuspass-registrations[data-theme="dark"] header button {
          background: #a99bff !important;
          color: #171525 !important;
        }
        .campuspass-registrations[data-theme="dark"] .text-slate-900,
        .campuspass-registrations[data-theme="dark"] .text-slate-700,
        .campuspass-registrations[data-theme="dark"] .text-slate-600 {
          color: #e7e5f2 !important;
        }
        .campuspass-registrations[data-theme="dark"] .text-slate-500 {
          color: #aaa7c0 !important;
        }
        .campuspass-registrations[data-theme="dark"] .bg-white {
          background: #191929 !important;
        }
        .campuspass-registrations[data-theme="dark"] .bg-violet-100,
        .campuspass-registrations[data-theme="dark"] .bg-violet-50 {
          background: rgba(169,155,255,.14) !important;
        }
        .campuspass-registrations[data-theme="dark"] .border-slate-200,
        .campuspass-registrations[data-theme="dark"] .border-violet-200,
        .campuspass-registrations[data-theme="dark"] .border-violet-300 {
          border-color: rgba(169,155,255,.28) !important;
        }
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket {
          background: #191929 !important;
          color: #f7f6ff !important;
          border-color: rgba(169,155,255,.32) !important;
          box-shadow: 0 18px 50px rgba(0,0,0,.22) !important;
        }
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket .bg-gradient-to-br {
          background: linear-gradient(135deg, #24223a, #191929) !important;
        }
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket .text-violet-700 {
          color: #bdb2ff !important;
        }
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket .text-violet-700.bg-violet-50 {
          color: #e0dbff !important;
        }
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket .text-slate-600,
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket .text-slate-500 {
          color: #b8b5ca !important;
        }
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket .text-slate-900,
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket .text-slate-700 {
          color: #f7f6ff !important;
        }
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket .bg-violet-100 {
          background: rgba(169,155,255,.16) !important;
        }
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket .border-dashed {
          border-color: rgba(169,155,255,.35) !important;
        }
        .campuspass-registrations[data-theme="dark"] .campuspass-ticket button {
          background: #a99bff !important;
          color: #171525 !important;
        }
        @media print {
          body { background: white !important; }
          body * { visibility: hidden !important; }
          .campuspass-ticket[data-print-selected="true"],
          .campuspass-ticket[data-print-selected="true"] * { visibility: visible !important; }
          .campuspass-ticket[data-print-selected="true"] {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            color: black !important;
            border-color: black !important;
            background: white !important;
            box-shadow: none !important;
          }
          .campuspass-ticket[data-print-selected="true"] * {
            color: black !important;
            background: white !important;
          }
          .campuspass-ticket[data-print-selected="false"] { display: none !important; }
          @page { margin: 12mm; }
        }
      `}</style>
    </main>
  );
}
