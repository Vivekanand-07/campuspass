"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

type OrganizerProfileData = {
  full_name: string;
  organization_name: string;
  email: string;
  phone: string;
  payout_status: string;
};

const initialProfile: OrganizerProfileData = {
  full_name: "",
  organization_name: "",
  email: "",
  phone: "",
  payout_status: "not_configured",
};

export default function OrganizerProfile() {
  const [profile, setProfile] =
    useState<OrganizerProfileData>(initialProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadProfile() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError || !session?.access_token) {
          setError("Please sign in again to manage your profile.");
          return;
        }

        const response = await fetch("/api/organizer/profile", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Could not load profile.");
        }

        setProfile({
          full_name: result.profile.full_name ?? "",
          organization_name: result.profile.organization_name ?? "",
          email: result.profile.email ?? "",
          phone: result.profile.phone ?? "",
          payout_status:
            result.profile.payout_status ?? "not_configured",
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not load organizer profile."
        );
      } finally {
        setLoading(false);
      }
    }

    void loadProfile();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSaving(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const response = await fetch("/api/organizer/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          full_name: profile.full_name,
          organization_name: profile.organization_name,
          phone: profile.phone,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not save profile.");
      }

      setMessage("Organizer profile saved successfully.");
      setProfile((current) => ({
        ...current,
        email: result.profile.email ?? current.email,
        payout_status:
          result.profile.payout_status ?? current.payout_status,
      }));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save organizer profile."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="mb-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-white">
        Loading organizer profile...
      </section>
    );
  }

  return (
    <section className="mb-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-white sm:p-8">
      <h2 className="text-2xl font-bold">Organizer Profile</h2>

      <p className="mt-2 text-sm leading-6 text-slate-400">
        Save your details once and reuse them for future events.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label className="mb-2 block text-sm font-semibold">
            Contact person name
          </label>
          <input
            required
            minLength={2}
            maxLength={100}
            value={profile.full_name}
            onChange={(event) =>
              setProfile({
                ...profile,
                full_name: event.target.value,
              })
            }
            className="w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400"
            placeholder="Your full name"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold">
            Organization name
          </label>
          <input
            required
            minLength={2}
            maxLength={150}
            value={profile.organization_name}
            onChange={(event) =>
              setProfile({
                ...profile,
                organization_name: event.target.value,
              })
            }
            className="w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400"
            placeholder="College club or organization"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold">
            Account email
          </label>
          <input
            readOnly
            value={profile.email}
            className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-3 text-slate-400"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold">
            Contact phone
          </label>
          <input
            required
            type="tel"
            minLength={8}
            maxLength={20}
            value={profile.phone}
            onChange={(event) =>
              setProfile({
                ...profile,
                phone: event.target.value,
              })
            }
            className="w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400"
            placeholder="+91 9876543210"
          />
        </div>

        <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4">
          <p className="text-sm font-semibold text-amber-200">
            Payout setup
          </p>
          <p className="mt-1 text-sm text-amber-100/80">
            {profile.payout_status === "configured"
              ? "Payout reference configured."
              : "Payout setup is pending. Actual transfers require an activated Cashfree payout or split-settlement integration."}
          </p>
        </div>

        {message && (
          <p role="status" className="text-sm text-emerald-300">
            {message}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Organizer Profile"}
        </button>
      </form>
    </section>
  );
}