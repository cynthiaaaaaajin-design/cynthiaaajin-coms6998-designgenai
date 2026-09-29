/* eslint-disable @next/next/no-img-element -- Private signed avatar URLs bypass the shared image optimizer. */
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AvatarCropModal } from "@/components/avatar-crop-modal";
import { createClient } from "@/lib/supabase/client";

type Profile = {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};
const imageTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function ProfileForm({
  profile,
  userId,
  email,
  avatarSrc,
  avatarError,
}: {
  profile: Profile;
  userId: string;
  email: string;
  avatarSrc: string | null;
  avatarError: boolean;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(profile.first_name ?? "");
  const [lastName, setLastName] = useState(profile.last_name ?? "");
  const [incomplete, setIncomplete] = useState(
    !profile.first_name?.trim() || !profile.last_name?.trim(),
  );
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(
    () => () => {
      if (cropSource) URL.revokeObjectURL(cropSource);
    },
    [cropSource],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function savePhoto(file: File) {
    const supabase = createClient();
    const localPreview = URL.createObjectURL(file);
    let path: string | null = null;
    setBusy(true);
    setError("");
    setMessage("");
    // Show the confirmed crop immediately; revert it if persistence fails.
    setPreview(localPreview);
    setImageFailed(false);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || user.id !== userId)
        throw new Error("Your session has expired. Please log in again.");
      const nextPath = `${user.id}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(nextPath, file, { contentType: "image/jpeg", upsert: false });
      if (uploadError)
        throw new Error("Photo upload failed. Please try again.");
      path = nextPath;
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id)
        .select("id")
        .single();
      if (updateError)
        throw new Error(
          "Your photo could not be saved to your profile. Please try again.",
        );
      setCropSource(null);
      setMessage("Your profile photo is saved.");
      router.refresh();
    } catch (err) {
      if (path)
        await supabase.storage
          .from("avatars")
          .remove([path])
          .catch(() => undefined);
      // The previous object URL may have been released; fall back to the server avatar.
      setPreview(null);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!firstName.trim() || !lastName.trim()) {
      setError(
        "Please enter both your first and last name to complete your profile.",
      );
      return;
    }
    setBusy(true);
    const supabase = createClient();
    try {
      // Revalidate the identity before either write; RLS is the final authorization boundary.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || user.id !== userId)
        throw new Error("Your session has expired. Please log in again.");
      const { data, error } = await supabase
        .from("profiles")
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        })
        .eq("id", user.id)
        .select("id")
        .single();
      if (error || !data)
        throw new Error(
          "Your profile could not be saved. Check that your profile exists and you have update permission.",
        );
      setFirstName(firstName.trim());
      setLastName(lastName.trim());
      setIncomplete(false);
      setImageFailed(false);
      setMessage(
        "Your profile is saved. You’re ready for your next adventure.",
      );
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={save}>
        <div className="border-b border-slate-100 pb-6">
          <h2 className="text-xl font-semibold">Personal details</h2>
          <p className="mt-2 text-sm text-slate-500">
            Your next adventure starts with you.
          </p>
        </div>
        {incomplete && (
          <div className="notice my-6">
            <strong>Let’s complete your profile.</strong>
            <p className="mt-1">
              Add your first and last name so your friends know it’s you.
            </p>
          </div>
        )}
        <fieldset disabled={busy} className="mt-7">
          <legend className="sr-only">Profile details</legend>
          <div className="flex flex-wrap items-center gap-5">
            <div className="profile-avatar">
              {(preview || avatarSrc) && !imageFailed ? (
                /* Storage URLs can be private signed URLs; do not route through a public image cache. */ <img
                  src={preview || avatarSrc || undefined}
                  alt="Your profile photo"
                  className="h-full w-full object-cover"
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <span>
                  {(firstName[0] ?? "T").toUpperCase()}
                  {(lastName[0] ?? "").toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="avatar" className="block text-sm font-semibold">
                Profile photo
              </label>
              <input
                id="avatar"
                name="avatar"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="mt-3 block w-full text-xs text-slate-500 file:mr-3 file:rounded-full file:border file:border-slate-200 file:bg-white file:px-4 file:py-2 file:font-semibold file:text-slate-700"
                aria-describedby="photo-help"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  e.target.value = "";
                  setMessage("");
                  setError("");
                  if (!selected) return;
                  if (
                    !imageTypes[selected.type] ||
                    selected.size === 0 ||
                    selected.size > 5 * 1024 * 1024
                  ) {
                    setError("Choose a JPG, PNG, or WebP image up to 5 MB.");
                    return;
                  }
                  setCropSource(URL.createObjectURL(selected));
                }}
              />
              <p id="photo-help" className="mt-2 text-xs text-slate-500">
                JPG, PNG or WebP. Up to 5 MB. Crop and confirm before uploading.
              </p>
              {(avatarError || imageFailed) && (
                <p className="mt-2 text-xs text-amber-800">
                  Your saved photo couldn’t be displayed. You can try uploading
                  another.
                </p>
              )}
            </div>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="first-name">
                First name <span className="text-teal-700">*</span>
              </label>
              <input
                id="first-name"
                autoComplete="given-name"
                required
                maxLength={100}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Your first name"
              />
            </div>
            <div>
              <label htmlFor="last-name">
                Last name <span className="text-teal-700">*</span>
              </label>
              <input
                id="last-name"
                autoComplete="family-name"
                required
                maxLength={100}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Your last name"
              />
            </div>
          </div>
          <div className="mt-6">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              readOnly
              className="bg-slate-50 text-slate-500"
            />
            <p className="mt-2 text-xs text-slate-500">
              Connected through your Google account.
            </p>
          </div>
        </fieldset>
        <div aria-live="polite">
          {error && (
            <p role="alert" className="mt-6 text-sm text-red-700">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="mt-6 text-sm text-teal-700">
              {message}
            </p>
          )}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-6">
          <Link href="/trips" className="text-sm font-medium text-slate-500">
            Back to my trips
          </Link>
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </form>
      {cropSource && (
        <AvatarCropModal
          source={cropSource}
          onCancel={() => setCropSource(null)}
          onConfirm={savePhoto}
        />
      )}
    </>
  );
}
