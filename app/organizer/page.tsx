"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

type CampusEvent = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  venue: string | null;
  starts_at: string;
  status: string;
};

export default function OrganizerPage() {
  const router = useRouter();

  const [userId, setUserId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [checkingAccess, setCheckingAccess] = useState(true);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Workshop");
  const [venue, setVenue] = useState("");
  const [startsAt, setStartsAt] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [publishingEventId, setPublishingEventId] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState("");
  const [publishErrorMessage, setPublishErrorMessage] = useState("");

  // Use the same saved theme preference as the CampusPass homepage.
  useEffect(() => {
    const applySavedTheme = () => {
      const savedTheme = window.localStorage.getItem("campuspass-theme");
      document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "dark";
    };

    applySavedTheme();
    window.addEventListener("storage", applySavedTheme);
    return () => window.removeEventListener("storage", applySavedTheme);
  }, []);

  const loadMyEvents = useCallback(async (accountId: string) => {
    const { data, error } = await supabase
      .from("events")
      .select("id, title, description, category, venue, starts_at, status")
      .eq("organizer_id", accountId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Could not load submitted events:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return;
    }

    setEvents((data ?? []) as CampusEvent[]);
  }, []);

  useEffect(() => {
    let active = true;

    async function checkAccess() {
      try {
        // Verify the currently authenticated user with Supabase.
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (!active) return;

        if (error || !user) {
          router.replace("/login?role=organizer");
          return;
        }

        setUserId(user.id);
        setUserEmail(user.email ?? "");

        // Any signed-in account can open this dashboard.
        await loadMyEvents(user.id);

        if (active) {
          setCheckingAccess(false);
        }
      } catch (error: unknown) {
        console.error("Dashboard access check failed:", error);

        if (active) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Could not check your account. Please try again."
          );
          setCheckingAccess(false);
        }
      }
    }

    void checkAccess();

    return () => {
      active = false;
    };
  }, [router, loadMyEvents]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");

    if (submitting) return;

    const trimmedTitle = title.trim();
    const trimmedVenue = venue.trim();

    if (!trimmedTitle || !trimmedVenue) {
      setErrorMessage("Please enter an event title and venue.");
      return;
    }

    if (!startsAt) {
      setErrorMessage("Please choose an event date and time.");
      return;
    }

    const eventDate = new Date(startsAt);

    if (Number.isNaN(eventDate.getTime())) {
      setErrorMessage("Please choose a valid event date and time.");
      return;
    }

    if (eventDate <= new Date()) {
      setErrorMessage("Choose a date and time in the future.");
      return;
    }

    setSubmitting(true);

    try {
      // Always use the authenticated user's actual ID, not a form value.
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw new Error(`Could not verify your login: ${userError.message}`);
      }

      if (!user) {
        setUserId("");
        setErrorMessage("Your session has expired. Please sign in again.");
        router.replace("/login?role=organizer");
        return;
      }

      setUserId(user.id);

      // Do not use .select() here. Pending events may not be visible
      // through the existing published-events SELECT policy.
      const { error } = await supabase.from("events").insert({
        title: trimmedTitle,
        description: description.trim() || null,
        category,
        venue: trimmedVenue,
        starts_at: eventDate.toISOString(),
        organizer_id: user.id,
        status: "pending",
      });

      if (error) {
        console.error("Event submission failed:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          authenticatedUserId: user.id,
        });

        const errorDetails = [
          error.message,
          error.code ? `Code: ${error.code}` : null,
          error.details ? `Details: ${error.details}` : null,
          error.hint ? `Hint: ${error.hint}` : null,
        ]
          .filter(Boolean)
          .join(" | ");

        setErrorMessage(
          `Event submission failed: ${
            errorDetails || "Unknown database error."
          }`
        );
        return;
      }

      setMessage(
        "Event submitted successfully! Its status is Pending review."
      );

      setTitle("");
      setDescription("");
      setCategory("Workshop");
      setVenue("");
      setStartsAt("");

      // Refresh the list after the successful insert.
      await loadMyEvents(user.id);
    } catch (error: unknown) {
      console.error("Unexpected event submission error:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish(eventToPublish: CampusEvent) {
    if (!userId || publishingEventId) return;

    setPublishMessage("");
    setPublishErrorMessage("");
    setPublishingEventId(eventToPublish.id);

    try {
      // Re-check the authenticated user before publishing.
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      // The database policy must also restrict updates to the event owner.
      const { data, error } = await supabase
        .from("events")
        .update({ status: "published" })
        .eq("id", eventToPublish.id)
        .eq("organizer_id", user.id)
        .eq("status", "pending")
        .select("id, title, description, category, venue, starts_at, status")
        .maybeSingle();

      if (error) {
        console.error("Event publishing failed:", error);
        throw new Error(
          `Could not publish this event: ${error.message}. If this is a permissions error, apply the organizer update policy in Supabase first.`,
        );
      }

      if (!data) {
        throw new Error(
          "This event was not published. It may no longer be pending, or your account may not have permission to publish it.",
        );
      }

      setEvents((current) =>
        current.map((item) => (item.id === data.id ? (data as CampusEvent) : item)),
      );
      setPublishMessage(`🎉 “${data.title}” is now published and eligible to appear on the homepage.`);
    } catch (error: unknown) {
      console.error("Unexpected event publishing error:", error);
      setPublishErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not publish this event. Please try again.",
      );
    } finally {
      setPublishingEventId(null);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    setErrorMessage("");

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        console.error("Sign-out failed:", error);
        setErrorMessage(`Sign-out failed: ${error.message}`);
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not sign out. Please try again."
      );
    } finally {
      setSigningOut(false);
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

  if (checkingAccess) {
    return (
      <main className="organizer-shell flex min-h-screen items-center justify-center bg-slate-950 px-5 text-white">
        <p className="text-slate-300">Checking your account...</p>
      </main>
    );
  }

  return (
    <main className="organizer-shell min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <Link href="/" className="text-2xl font-black tracking-tight">
            Campus<span className="text-cyan-400">Pass</span>
          </Link>

          <nav className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/10"
            >
              Browse events
            </Link>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-100 disabled:opacity-60"
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-400">
          CampusPass Organizer
        </p>

        <h1 className="mt-2 text-3xl font-black sm:text-5xl">
          Organizer Dashboard
        </h1>

        <p className="mt-3 text-slate-400">
          Submit campus events and keep track of your submissions.
        </p>

        {userEmail && (
          <p className="mt-2 text-sm text-slate-500">{userEmail}</p>
        )}

        <div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 sm:p-8">
            <h2 className="text-2xl font-bold">Create an event</h2>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Complete the details below. New events are submitted as pending
              for review and are not immediately published.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div>
                <label
                  htmlFor="event-title"
                  className="mb-2 block text-sm font-semibold"
                >
                  Event title *
                </label>

                <input
                  id="event-title"
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Campus Music Night"
                  className="w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label
                  htmlFor="event-description"
                  className="mb-2 block text-sm font-semibold"
                >
                  Description
                </label>

                <textarea
                  id="event-description"
                  rows={4}
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell students what the event is about..."
                  className="w-full resize-y rounded-xl border border-white/15 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label
                  htmlFor="event-category"
                  className="mb-2 block text-sm font-semibold"
                >
                  Category *
                </label>

                <select
                  id="event-category"
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400"
                >
                  <option>Workshop</option>
                  <option>Music</option>
                  <option>Technology</option>
                  <option>Sports</option>
                  <option>Cultural</option>
                  <option>Seminar</option>
                  <option>Other</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="event-venue"
                  className="mb-2 block text-sm font-semibold"
                >
                  Venue *
                </label>

                <input
                  id="event-venue"
                  required
                  maxLength={200}
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="e.g. Main Campus Ground"
                  className="w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label
                  htmlFor="event-date"
                  className="mb-2 block text-sm font-semibold"
                >
                  Date and time *
                </label>

                <input
                  id="event-date"
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400"
                />
              </div>

              {message && (
                <p
                  role="status"
                  className="break-words rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200"
                >
                  {message}
                </p>
              )}

              {errorMessage && (
                <p
                  role="alert"
                  className="break-words rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm leading-6 text-red-200"
                >
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Submitting..." : "Submit event for review"}
              </button>
            </form>
          </section>

          <section>
            {publishMessage && (
              <p
                role="status"
                className="mb-4 break-words rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200"
              >
                {publishMessage}
              </p>
            )}

            {publishErrorMessage && (
              <p
                role="alert"
                className="mb-4 break-words rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm leading-6 text-red-200"
              >
                {publishErrorMessage}
              </p>
            )}

            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">Your submissions</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Events created by your account.
                </p>
              </div>

              <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-sm font-semibold text-cyan-300">
                {events.length}
              </span>
            </div>

            {events.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
                <p className="text-lg font-semibold">
                  No submissions to show
                </p>

                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Submit your first event using the form. If previously
                  submitted events are missing, database read permissions may
                  need to be checked.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {events.map((event) => (
                  <article
                    key={event.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="text-lg font-bold">{event.title}</h3>

                      <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold capitalize text-amber-300">
                        {event.status}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-slate-400">
                      {event.description || "No description provided."}
                    </p>

                    <div className="mt-4 space-y-2 text-sm text-slate-300">
                      <p>📂 {event.category || "Campus event"}</p>
                      <p>📍 {event.venue || "Venue to be announced"}</p>
                      <p>📅 {formatDate(event.starts_at)}</p>
                    </div>

                    {event.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => void handlePublish(event)}
                        disabled={publishingEventId !== null}
                        className="mt-5 w-full rounded-xl bg-emerald-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {publishingEventId === event.id
                          ? "Publishing..."
                          : "Publish event"}
                      </button>
                    )}

                    {event.status === "published" && (
                      <p className="mt-4 text-sm font-semibold text-emerald-300">
                        ✓ Published — eligible to appear on the homepage
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
      <style jsx global>{`
        html[data-theme="light"] .organizer-shell {
          background: #f7f6fc !important;
          color: #201d2b !important;
        }
        html[data-theme="light"] .organizer-shell header {
          border-color: #e7e2f2 !important;
          background: rgba(255, 255, 255, 0.88);
        }
        html[data-theme="light"] .organizer-shell .text-slate-300,
        html[data-theme="light"] .organizer-shell .text-slate-400,
        html[data-theme="light"] .organizer-shell .text-slate-500 {
          color: #625d70 !important;
        }
        html[data-theme="light"] .organizer-shell .border-white\/10,
        html[data-theme="light"] .organizer-shell .border-white\/15 {
          border-color: #e2dced !important;
        }
        html[data-theme="light"] .organizer-shell .bg-white\/\[0\.04\],
        html[data-theme="light"] .organizer-shell .bg-white\/5,
        html[data-theme="light"] .organizer-shell .bg-white\/10 {
          background-color: #ffffff !important;
        }
        html[data-theme="light"] .organizer-shell input,
        html[data-theme="light"] .organizer-shell textarea,
        html[data-theme="light"] .organizer-shell select {
          background-color: #ffffff !important;
          color: #201d2b !important;
          border-color: #d8d1e7 !important;
        }
        html[data-theme="light"] .organizer-shell input::placeholder,
        html[data-theme="light"] .organizer-shell textarea::placeholder {
          color: #827b90 !important;
        }
        html[data-theme="light"] .organizer-shell .hover\:bg-white\/10:hover {
          background-color: #f0ecfa !important;
        }
        html[data-theme="light"] .organizer-shell .text-cyan-400 {
          color: #7660c9 !important;
        }
        html[data-theme="light"] .organizer-shell .text-emerald-300 {
          color: #16784d !important;
        }
        html[data-theme="light"] .organizer-shell .text-amber-300 {
          color: #946200 !important;
        }
      `}</style>
    </main>
  );
}