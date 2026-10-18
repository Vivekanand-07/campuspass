
"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

type UserRole = "student" | "organizer";

export default function LoginPage() {
  const router = useRouter();

  const [selectedPortal, setSelectedPortal] = useState<UserRole | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let active = true;

    async function initializeLogin() {
      const params = new URLSearchParams(window.location.search);
      const roleParam = params.get("role");

      const requestedPortal: UserRole | null =
        roleParam === "student" || roleParam === "organizer"
          ? roleParam
          : null;

      setSelectedPortal(requestedPortal);

      try {
        const { data, error } = await supabase.auth.getSession();

        if (!active) return;

        if (error) {
          console.error("Session check failed:", error);
          setCheckingSession(false);
          return;
        }

        const user = data.session?.user;

        // No existing session: show the normal login page.
        if (!user) {
          setCheckingSession(false);
          return;
        }

        // An existing session: verify that the CampusPass profile exists.
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        if (!active) return;

        if (profileError || !profile) {
          setIsError(true);
          setMessage(
            profileError
              ? "We couldn't check your account profile. Please try again."
              : "Your CampusPass profile was not found. Please contact the administrator."
          );
          setCheckingSession(false);
          return;
        }

        const savedRole = profile.role;

        if (savedRole !== "student" && savedRole !== "organizer") {
          setIsError(true);
          setMessage(
            "Your account doesn't have a valid role. Please contact the administrator."
          );
          setCheckingSession(false);
          return;
        }

        // Respect the portal the user selected.
        const destination =
          requestedPortal === "organizer"
            ? "/organizer"
            : requestedPortal === "student"
              ? "/"
              : savedRole === "organizer"
                ? "/organizer"
                : "/";

        router.replace(destination);
        router.refresh();
      } catch (error: unknown) {
        console.error("Could not restore login session:", error);

        if (active) {
          setCheckingSession(false);
        }
      }
    }

    void initializeLogin();

    return () => {
      active = false;
    };
  }, [router]);

  async function redirectByRole(userId: string) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(
        "We couldn't check your account profile. Please try again."
      );
    }

    if (!profile) {
      throw new Error(
        "Your CampusPass profile was not found. Please contact the administrator."
      );
    }

    const role = profile.role as UserRole;

    if (role !== "student" && role !== "organizer") {
      throw new Error(
        "Your account doesn't have a valid role. Please contact the administrator."
      );
    }

    if (selectedPortal === "organizer") {
      router.replace("/organizer");
    } else if (selectedPortal === "student") {
      router.replace("/");
    } else if (role === "organizer") {
      router.replace("/organizer");
    } else {
      router.replace("/");
    }

    router.refresh();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setIsError(false);

    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        if (data.session && data.user) {
          await redirectByRole(data.user.id);
          return;
        }

        setMessage(
          "Account created! Check your email for a confirmation link, then sign in. Your CampusPass profile and role must be set up before you can access a portal."
        );
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        if (!data.user) {
          throw new Error("Login succeeded, but no user was returned.");
        }

        await redirectByRole(data.user.id);
        return;
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong.";

      setIsError(true);

      if (errorMessage.toLowerCase().includes("invalid login credentials")) {
        setMessage(
          "Email or password is incorrect. If you are new, choose Sign up first."
        );
      } else if (
        errorMessage.toLowerCase().includes("already registered")
      ) {
        setMessage(
          "This email already has an account. Choose Sign in instead."
        );
      } else {
        setMessage(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }

  const portalName =
    selectedPortal === "student"
      ? "Student Portal"
      : selectedPortal === "organizer"
        ? "Organizer Portal"
        : "CampusPass";

  if (checkingSession) {
    return (
      <main className="site-shell">
        <section
          style={{
            maxWidth: 440,
            margin: "80px auto",
            padding: 24,
          }}
        >
          <Link href="/" className="brand">
            <span className="brand-icon">c.</span>
            campus<span>pass</span>
          </Link>

          <p style={{ marginTop: 40, color: "#b7b6c4" }}>
            Checking your session...
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="site-shell">
      <section
        style={{
          maxWidth: 440,
          margin: "80px auto",
          padding: 24,
        }}
      >
        <Link href="/" className="brand">
          <span className="brand-icon">c.</span>
          campus<span>pass</span>
        </Link>

        <h1 style={{ marginTop: 40 }}>
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>

        <p style={{ margin: "12px 0 24px", color: "#b7b6c4" }}>
          {selectedPortal
            ? `Sign in to continue to the ${portalName}.`
            : isSignup
              ? "Join CampusPass and discover campus events."
              : "Sign in to continue to CampusPass."}
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              margin: "8px 0 20px",
              padding: 12,
            }}
          />

          <label htmlFor="password">Password</label>

          <div style={{ position: "relative", marginTop: 8 }}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="Enter your password"
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 48px 12px 12px",
              }}
            />

            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              title={showPassword ? "Hide password" : "Show password"}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 8,
                fontSize: 19,
                color: "#d9ff59",
              }}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>

          <button
            type="submit"
            className="primary-button"
            disabled={loading}
            style={{
              width: "100%",
              marginTop: 24,
              justifyContent: "center",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading
              ? "Please wait..."
              : isSignup
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <p style={{ marginTop: 22 }}>
          {isSignup
            ? "Already have an account?"
            : "New to CampusPass?"}{" "}
          <button
            type="button"
            onClick={() => {
              setIsSignup((current) => !current);
              setMessage("");
              setIsError(false);
              setShowPassword(false);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#d9ff59",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "inherit",
            }}
          >
            {isSignup ? "Sign in" : "Sign up"}
          </button>
        </p>

        {message && (
          <p
            role="status"
            aria-live="polite"
            style={{
              marginTop: 18,
              overflowWrap: "anywhere",
              color: isError ? "#ff9292" : "#d9ff59",
            }}
          >
            {message}
          </p>
        )}

        <p style={{ marginTop: 24 }}>
          <Link href="/">← Back to CampusPass</Link>
        </p>
      </section>
    </main>
  );
}
