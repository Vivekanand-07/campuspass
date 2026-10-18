"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "./lib/supabase";

type CampusEvent = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  venue: string;
  starts_at: string;
  organizer_id: string | null;
  status: string;
  created_at: string;
  group_booking_enabled: boolean;
  max_tickets_per_booking: number;
};

const categoryColors: Record<string, string> = {
  Music: "music",
  Technology: "tech",
  Competition: "battle",
  Gaming: "gaming",
  Other: "tech",
};

const categoryEmojis: Record<string, string> = {
  Music: "🎸",
  Technology: "🚀",
  Competition: "🎤",
  Gaming: "🎮",
  Other: "✳",
};

function formatDate(dateString: string) {
  const date = new Date(dateString);

  return {
    date: date
      .toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        timeZone: "Asia/Kolkata",
      })
      .toUpperCase(),
    time: date.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }),
  };
}

function getInitials(email: string) {
  const name = email.split("@")[0];
  const parts = name.split(/[._-]+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

export default function Home() {
  const router = useRouter();

  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All events");

  const [selectedEvent, setSelectedEvent] =
    useState<CampusEvent | null>(null);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsContainerRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [signingOut, setSigningOut] = useState(false);

  const [registering, setRegistering] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState("");
  const [registrationError, setRegistrationError] = useState(false);
  const [registeredEventIds, setRegisteredEventIds] =
    useState<string[]>([]);
  const [ticketQuantity, setTicketQuantity] = useState(1);

  // Restore the saved appearance preference and apply it to the whole site.
  useEffect(() => {
    const savedTheme = window.localStorage.getItem("campuspass-theme");
    const initialTheme = savedTheme === "light" ? "light" : "dark";
    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("campuspass-theme", nextTheme);
  }

  // Close menus when the user clicks outside them or presses Escape.
  useEffect(() => {
    if (!settingsOpen && !profileOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (settingsContainerRef.current?.contains(target)) return;
      setSettingsOpen(false);
      setProfileOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setProfileOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOpen, profileOpen]);

  // Load signed-in user and listen for authentication changes.
  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        console.error("Could not load session:", error.message);
        return;
      }

      setUserEmail(data.session?.user.email ?? null);
      setUserId(data.session?.user.id ?? null);
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUserEmail(session?.user.email ?? null);
        setUserId(session?.user.id ?? null);
        setRegisteredEventIds([]);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Load published events.
  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      setLoading(true);
      setLoadError("");

      const { data, error } = await supabase
        .from("events")
        .select(
          "id, title, description, category, venue, starts_at, organizer_id, status, created_at, group_booking_enabled, max_tickets_per_booking"
        )
        .eq("status", "published")
        .order("starts_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Could not load events:", error);
        setLoadError(
          "We couldn't load events right now. Please refresh and try again."
        );
      } else {
        setEvents((data ?? []) as CampusEvent[]);
      }

      setLoading(false);
    }

    loadEvents();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load the signed-in student's existing registrations.
  useEffect(() => {
    let cancelled = false;

    async function loadRegistrations() {
      if (!userId) {
        setRegisteredEventIds([]);
        return;
      }

      const { data, error } = await supabase
        .from("registrations")
        .select("event_id")
        .eq("student_id", userId);

      if (cancelled) return;

      if (error) {
        console.error("Could not load registrations:", error);
        return;
      }

      setRegisteredEventIds(
        (data ?? []).map((registration) => registration.event_id)
      );
    }

    loadRegistrations();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Every published event uses the quantity-only booking flow.
  async function handleRegister() {
    if (!selectedEvent || registering) return;

    setRegistrationMessage("");
    setRegistrationError(false);

    if (!userId) {
      router.push("/login");
      return;
    }

    if (registeredEventIds.includes(selectedEvent.id)) {
      setRegistrationMessage("🎉 Congratulations! You’re already registered for this event.");
      return;
    }

    const quantity = ticketQuantity;

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) {
      setRegistrationError(true);
      setRegistrationMessage("Choose between 1 and 5 tickets.");
      return;
    }

    setRegistering(true);

    try {
      const { error } = await supabase.rpc("book_event_quantity", {
        p_event_id: selectedEvent.id,
        p_ticket_quantity: quantity,
      });

      if (error) {
        console.error("Booking database error:", error);

        if (error.code === "23505") {
          setRegisteredEventIds((previous) =>
            previous.includes(selectedEvent.id)
              ? previous
              : [...previous, selectedEvent.id]
          );
          setRegistrationMessage(
            "🎉 Congratulations! You’re already registered for this event."
          );
          return;
        }

        setRegistrationError(true);
        setRegistrationMessage(
          `Booking failed: ${error.message}${
            error.code ? ` (Code: ${error.code})` : ""
          }`
        );
        return;
      }

      setRegisteredEventIds((previous) =>
        previous.includes(selectedEvent.id)
          ? previous
          : [...previous, selectedEvent.id]
      );

      setRegistrationMessage(
        `🎉 Congratulations! You’re now registered for ${selectedEvent.title} with ${quantity} ticket${
          quantity === 1 ? "" : "s"
        }. Your booking is confirmed.`
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.";

      console.error("Unexpected booking error:", error);
      setRegistrationError(true);
      setRegistrationMessage(`Booking failed: ${message}`);
    } finally {
      setRegistering(false);
    }
  }

  function changeTicketQuantity(nextQuantity: number) {
    if (!selectedEvent) return;

    const maximum = 5;

    const safeQuantity = Math.max(
      1,
      Math.min(maximum, nextQuantity)
    );

    setTicketQuantity(safeQuantity);
    setRegistrationMessage("");
    setRegistrationError(false);
  }

  async function handleSignOut() {
    setSigningOut(true);

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Sign out failed:", error.message);
      setSigningOut(false);
      return;
    }

    setProfileOpen(false);
    setUserEmail(null);
    setUserId(null);
    setRegisteredEventIds([]);

    router.refresh();
    router.push("/");

    setSigningOut(false);
  }

  const categories = [
    "All events",
    ...Array.from(new Set(events.map((event) => event.category))),
  ];

  const filteredEvents = events.filter((event) => {
    const term = search.toLowerCase();

    const matchesSearch =
      event.title.toLowerCase().includes(term) ||
      (event.venue ?? "").toLowerCase().includes(term) ||
      (event.category ?? "").toLowerCase().includes(term);

    const matchesCategory =
      category === "All events" || event.category === category;

    return matchesSearch && matchesCategory;
  });

  return (
    <main className="site-shell">
      <nav className="navbar">
        <Link className="brand" href="/">
          <span className="brand-icon">c.</span>
          campus<span>pass</span>
        </Link>

        <div className="nav-links">
          <a href="#events">Explore events</a>
          <a href="#how-it-works">How it works</a>
          <Link href="/my-registrations">My Registrations</Link>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            position: "relative",
          }}
        >
          <div ref={settingsContainerRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="settings-trigger"
              onClick={() => {
                setSettingsOpen((open) => !open);
                setProfileOpen(false);
              }}
              aria-label="Open settings"
              aria-expanded={settingsOpen}
            >
              <span aria-hidden="true">⚙</span> <span className="settings-label">Settings</span>
            </button>
            {settingsOpen && (
              <div
                className="settings-menu"
                role="dialog"
                aria-label="CampusPass settings"
                style={{
                  position: "absolute",
                  top: "calc(100% + 12px)",
                  right: 0,
                  zIndex: 9999,
                  width: "min(320px, calc(100vw - 28px))",
                  boxSizing: "border-box",
                  padding: 18,
                  border: `1px solid ${theme === "dark" ? "rgba(169,155,255,.34)" : "rgba(70,55,130,.18)"}`,
                  borderRadius: 18,
                  background: theme === "dark" ? "rgba(20, 21, 37, .98)" : "rgba(255,255,255,.98)",
                  color: theme === "dark" ? "#f7f6ff" : "#19182a",
                  boxShadow: "0 24px 70px rgba(0,0,0,.42)",
                  backdropFilter: "blur(18px)",
                  WebkitBackdropFilter: "blur(18px)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 11, background: "rgba(169,155,255,.17)", color: "#a99bff", fontSize: 18 }} aria-hidden="true">⚙</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.02em" }}>Settings</div>
                    <div style={{ marginTop: 2, fontSize: 12, opacity: .68 }}>Make CampusPass yours</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 0", borderTop: `1px solid ${theme === "dark" ? "rgba(255,255,255,.10)" : "rgba(25,24,42,.10)"}`, borderBottom: `1px solid ${theme === "dark" ? "rgba(255,255,255,.10)" : "rgba(25,24,42,.10)"}` }}>
                  <div>
                    <strong style={{ display: "block", fontSize: 13, fontWeight: 750 }}>Appearance</strong>
                    <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.45, opacity: .68 }}>Choose light or dark mode.</p>
                  </div>
                  <button
                    type="button"
                    className="theme-toggle"
                    onClick={toggleTheme}
                    style={{ flexShrink: 0, padding: "9px 12px", border: "1px solid rgba(169,155,255,.38)", borderRadius: 11, background: "rgba(169,155,255,.15)", color: "inherit", font: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    {theme === "dark" ? "☀ Light" : "☾ Dark"}
                  </button>
                </div>
                <Link
                  className="settings-link"
                  href="/my-registrations"
                  onClick={() => setSettingsOpen(false)}
                  style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, padding: "11px 9px", borderRadius: 10, color: "inherit", textDecoration: "none", fontSize: 13, fontWeight: 650 }}
                >
                  <span aria-hidden="true">▤</span> My registrations <span style={{ marginLeft: "auto", opacity: .55 }}>↗</span>
                </Link>
                {userEmail ? (
                  <button
                    type="button"
                    className="settings-signout"
                    disabled={signingOut}
                    onClick={() => { setSettingsOpen(false); void handleSignOut(); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", marginTop: 4, padding: "11px 9px", border: "1px solid transparent", borderRadius: 10, background: "transparent", color: theme === "dark" ? "#ffb4bd" : "#b42336", textAlign: "left", font: "inherit", fontSize: 13, fontWeight: 650, cursor: signingOut ? "wait" : "pointer" }}
                  >
                    <span aria-hidden="true">↪</span> {signingOut ? "Signing out..." : "Sign out"}
                  </button>
                ) : (
                  <Link
                    className="settings-link"
                    href="/login"
                    onClick={() => setSettingsOpen(false)}
                    style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, padding: "11px 9px", borderRadius: 10, color: "inherit", textDecoration: "none", fontSize: 13, fontWeight: 650 }}
                  >
                    <span aria-hidden="true">↗</span> Sign in / Create account
                  </Link>
                )}
              </div>
            )}
          </div>
          {userEmail ? (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setProfileOpen((open) => !open)}
                aria-label="Open profile menu"
                aria-expanded={profileOpen}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  border: "2px solid #a99bff",
                  background: "linear-gradient(135deg, #a99bff, #c8bfff)",
                  color: "#10101b",
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 0 18px rgba(169,155,255,0.18)",
                }}
              >
                {getInitials(userEmail)}
              </button>

              {profileOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: 54,
                    right: 0,
                    width: 250,
                    padding: 16,
                    borderRadius: 16,
                    background: "#171725",
                    border: "1px solid #353548",
                    boxShadow: "0 12px 35px rgba(0,0,0,0.4)",
                    zIndex: 100,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      paddingBottom: 14,
                      borderBottom: "1px solid #353548",
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        flexShrink: 0,
                        borderRadius: "50%",
                        background: "#a99bff",
                        color: "#10101b",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                      }}
                    >
                      {getInitials(userEmail)}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <p
                        style={{
                          margin: 0,
                          color: "#a99bff",
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        My account
                      </p>

                      <p
                        style={{
                          margin: "5px 0 0",
                          color: "#c5c4d1",
                          fontSize: 12,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {userEmail}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    style={{
                      width: "100%",
                      marginTop: 14,
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1px solid #414154",
                      background: "transparent",
                      color: "#ffffff",
                      textAlign: "left",
                      fontSize: 14,
                      cursor: signingOut ? "wait" : "pointer",
                      opacity: signingOut ? 0.7 : 1,
                    }}
                  >
                    {signingOut ? "Signing out..." : "↪ Sign out"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="secondary-button"
                style={{ textDecoration: "none" }}
              >
                Sign in
              </Link>

              <Link
                href="/login"
                className="nav-button"
                style={{ textDecoration: "none" }}
              >
                Sign up ↗️
              </Link>
            </>
          )}
        </div>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <div className="eyebrow">
            <span className="live-dot" />
            YOUR CAMPUS. YOUR COMMUNITY.
          </div>

          <h1>
            College life,
            <br />
            <span>fully unlocked.</span>
          </h1>

          <p className="hero-description">
            Discover what&apos;s happening around your campus.
            Find your people, experience something new and
            never miss a moment.
          </p>

          <div className="hero-actions">
            <a className="primary-button" href="#events">
              Explore events <span>↗️</span>
            </a>

            <a className="secondary-button" href="#how-it-works">
              How it works
            </a>
          </div>

          {/* Student and Organizer portal entry points */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: 12,
              width: "100%",
              maxWidth: 540,
              marginTop: 24,
            }}
          >
            <Link
              href="/login?role=student"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 18,
                borderRadius: 16,
                border: "1px solid #a99bff",
                background: "rgba(169, 155, 255, 0.08)",
                color: "inherit",
                textDecoration: "none",
                transition: "transform 160ms ease, background 160ms ease",
              }}
            >
              <span style={{ fontSize: 25 }} aria-hidden="true">🎓</span>
              <strong style={{ fontSize: 16 }}>Student Portal ↗</strong>
              <span style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.8 }}>
                Discover events, register, and keep track of your plans.
              </span>
            </Link>

            <Link
              href="/login?role=organizer"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 18,
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.035)",
                color: "inherit",
                textDecoration: "none",
                transition: "transform 160ms ease, background 160ms ease",
              }}
            >
              <span style={{ fontSize: 25 }} aria-hidden="true">🗓️</span>
              <strong style={{ fontSize: 16 }}>Organizer Portal ↗</strong>
              <span style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.8 }}>
                Submit campus events and manage your event activity.
              </span>
            </Link>
          </div>

          <div className="hero-note">
            <span>✳</span> Made for campus memories.
          </div>
        </div>

        <div className="hero-art">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />

          <div className="floating-label label-top">
            <span>✦</span> Find your people
          </div>

          <div className="poster">
            <div className="poster-top">
              <span>CAMPUSPASS PRESENTS</span>
              <span>001 / CP</span>
            </div>

            <div className="poster-illustration">
              <div className="poster-sun" />
              <div className="poster-circle circle-one" />
              <div className="poster-circle circle-two" />
              <span className="poster-star star-one">✳</span>
              <span className="poster-star star-two">✦</span>
              <span className="poster-person">♫</span>
            </div>

            <div className="poster-bottom">
              <span>GOOD TIMES.</span>
              <strong>GREAT PEOPLE.</strong>
              <span>ALL ON CAMPUS.</span>
            </div>
          </div>

          <div className="floating-label label-bottom">
            <span>↗️</span> Your next favourite memory
          </div>

          <div className="art-caption">
            DISCOVER · CONNECT · EXPERIENCE
          </div>
        </div>
      </section>

      <section className="events-section" id="events">
        <div className="section-heading">
          <div>
            <div className="section-kicker">THE CAMPUS CALENDAR</div>
            <h2>Something&apos;s happening.</h2>
            <p>Find your next reason to get out there.</p>
          </div>

          <span className="event-count">
            {String(filteredEvents.length).padStart(2, "0")} EVENTS
          </span>
        </div>

        <div className="event-controls">
          <div className="search-box">
            <span>⌕</span>
            <input
              aria-label="Search events"
              placeholder="Search events or venues..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="search-shortcut">⌘ K</span>
          </div>

          <select
            aria-label="Filter events by category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="empty-state">
            <h3>Loading campus events...</h3>
            <p>Checking for published events.</p>
          </div>
        ) : loadError ? (
          <div className="empty-state">
            <h3>Events unavailable</h3>
            <p>{loadError}</p>
            <button
              className="secondary-button"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="empty-state">
            <span>⌕</span>
            <h3>
              {events.length === 0
                ? "No published events yet"
                : "No events found"}
            </h3>
            <p>
              {events.length === 0
                ? "Published events will appear here when an organiser adds them."
                : "Try another search or select a different category."}
            </p>
            <button
              className="secondary-button"
              onClick={() => {
                setSearch("");
                setCategory("All events");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="event-grid">
            {filteredEvents.map((event, index) => {
              const formatted = formatDate(event.starts_at);

              return (
                <article className="event-card" key={event.id}>
                  <div
                    className={`event-art ${
                      categoryColors[event.category] ?? "tech"
                    }`}
                  >
                    <span className="event-category">
                      {event.category}
                    </span>
                    <span className="event-emoji">
                      {categoryEmojis[event.category] ?? "✳"}
                    </span>
                    <span className="event-art-number">
                      CP / {String(index + 1).padStart(3, "0")}
                    </span>
                    <span className="event-date">
                      {formatted.date}
                    </span>
                  </div>

                  <div className="event-card-body">
                    <div className="event-meta">
                      <span>◷ {formatted.time}</span>
                      <span>↗️ CAMPUS EVENT</span>
                    </div>

                    <h3>{event.title}</h3>
                    <p className="event-venue">⌖ {event.venue}</p>
                    <p className="event-description">
                      {event.description ||
                        "Join us for a campus event."}
                    </p>

                    <div className="event-card-footer">
                      <div className="event-price">
                        <span>READY WHEN YOU ARE</span>
                        <strong>Discover event</strong>
                      </div>

                      <button
                        className="reserve-button"
                        onClick={() => {
                          setSelectedEvent(event);
                          setTicketQuantity(1);
                          setRegistrationMessage("");
                          setRegistrationError(false);
                        }}
                      >
                        View details ↗️
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="how-section" id="how-it-works">
        <div>
          <div className="section-kicker">SIMPLE BY DESIGN</div>
          <h2>Your next memory is three steps away.</h2>
        </div>

        <div className="steps-grid">
          <div className="step-card">
            <span>01</span>
            <h3>Discover</h3>
            <p>Find campus events that match your interests.</p>
          </div>

          <div className="step-card">
            <span>02</span>
            <h3>Register</h3>
            <p>Save your place at an event with a few clicks.</p>
          </div>

          <div className="step-card">
            <span>03</span>
            <h3>Show up</h3>
            <p>Meet your people and make the most of campus life.</p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <Link className="brand footer-brand" href="/">
          <span className="brand-icon">c.</span>
          campus<span>pass</span>
        </Link>

        <p>More campus. More connection. More memories.</p>
        <span>© 2026 CampusPass · A student project</span>
      </footer>

      {selectedEvent && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!registering) {
              setSelectedEvent(null);
              setRegistrationMessage("");
            }
          }}
        >
          <section
            className="booking-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              type="button"
              disabled={registering}
              onClick={() => {
                setSelectedEvent(null);
                setRegistrationMessage("");
              }}
              aria-label="Close dialog"
            >
              ×
            </button>

            <div
              className={`modal-art ${
                categoryColors[selectedEvent.category] ?? "tech"
              }`}
            >
              <span>
                {categoryEmojis[selectedEvent.category] ?? "✳"}
              </span>
            </div>

            <div className="section-kicker">
              YOUR NEXT CAMPUS EXPERIENCE
            </div>

            <h2 id="booking-title">{selectedEvent.title}</h2>

            <p className="modal-description">
              {selectedEvent.description ||
                "Join us for a campus event."}
            </p>

            <div className="modal-details">
              <div>
                <span>DATE</span>
                <strong>
                  {formatDate(selectedEvent.starts_at).date}
                </strong>
              </div>

              <div>
                <span>TIME</span>
                <strong>
                  {formatDate(selectedEvent.starts_at).time}
                </strong>
              </div>

              <div>
                <span>VENUE</span>
                <strong>{selectedEvent.venue}</strong>
              </div>

              <div>
                <span>STATUS</span>
                <strong>Published</strong>
              </div>
            </div>

            <p>
              Register to save your place at this campus event.
            </p>

            <div
                style={{
                  marginTop: 18,
                  padding: 16,
                  borderRadius: 16,
                  border: "1px solid rgba(169,155,255,.3)",
                  background: "rgba(169,155,255,.07)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <strong style={{ display: "block", fontSize: 15 }}>
                      Book tickets
                    </strong>
                    <span
                      style={{
                        display: "block",
                        marginTop: 4,
                        fontSize: 12,
                        opacity: 0.72,
                      }}
                    >
                      Choose how many tickets you need.
                    </span>
                  </div>

                  <label style={{ fontSize: 13, fontWeight: 700 }}>
                    Number of tickets
                    <select
                      aria-label="Number of tickets"
                      value={ticketQuantity}
                      disabled={
                        registering ||
                        registeredEventIds.includes(selectedEvent.id)
                      }
                      onChange={(event) =>
                        changeTicketQuantity(Number(event.target.value))
                      }
                      style={{
                        display: "block",
                        marginTop: 6,
                        minWidth: 110,
                        padding: "9px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(169,155,255,.4)",
                        background: theme === "dark" ? "#171725" : "#ffffff",
                        color: "inherit",
                      }}
                    >
                      {Array.from(
                        {
                          length: 5,
                        },
                        (_, index) => index + 1
                      ).map((quantity) => (
                        <option key={quantity} value={quantity}>
                          {quantity} {quantity === 1 ? "ticket" : "tickets"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <p
                  style={{
                    margin: "14px 0 0",
                    fontSize: 12,
                    lineHeight: 1.6,
                    opacity: 0.72,
                  }}
                >
                  Select the total number of tickets you need. No attendee names,
                  ages, or gender details are required.
                </p>
              </div>

            {registrationMessage && (
              <p
                role="status"
                aria-live="polite"
                style={{
                  color: registrationError ? "#ff9292" : "#a99bff",
                  overflowWrap: "anywhere",
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                {registrationMessage}
              </p>
            )}

            <button
              type="button"
              className="primary-button modal-reserve"
              onClick={handleRegister}
              disabled={
                registering ||
                (!registrationError &&
                  registeredEventIds.includes(selectedEvent.id))
              }
              style={{
                opacity: registering ? 0.7 : 1,
                cursor: registering ? "wait" : "pointer",
              }}
            >
              {registering
                ? "Registering..."
                : registeredEventIds.includes(selectedEvent.id)
                  ? "Registration complete ✓"
                  : userId
                    ? "Register for event"
                    : "Sign in to register"}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSelectedEvent(null);
                setRegistrationMessage("");
              }}
              disabled={registering}
              style={{
                width: "100%",
                marginTop: 12,
                justifyContent: "center",
              }}
            >
              Close details
            </button>
          </section>
        </div>
      )}
    </main>
  );
}