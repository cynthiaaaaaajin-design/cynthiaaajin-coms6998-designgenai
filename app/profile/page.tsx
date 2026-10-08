import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/header";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("email,first_name,last_name,avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[profile] Lookup failed", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
  } else if (!profile) {
    console.warn(
      "[profile] No row returned for profiles.id = authenticated user.id",
    );
  }
  let avatarSrc: string | null = null;
  let avatarError = false;
  if (profile?.avatar_url) {
    if (/^https?:\/\//i.test(profile.avatar_url))
      avatarSrc = profile.avatar_url;
    else {
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(profile.avatar_url, 3600);
      avatarSrc = data?.signedUrl ?? null;
      avatarError = !!error;
    }
  }
  return (
    <>
      <Header signedIn active="profile" />
      <main className="page-shell mode-profile py-12">
        <p className="eyebrow">YOUR TRAVEL PASSPORT</p>
        <h1 className="page-title">{[profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Make yourself at home."}</h1>
        <p className="mt-4 text-slate-500">
          Traveler profile · A familiar face for every adventure.
        </p>
        <div className="profile-grid">
          <aside>
            <div className="settings-nav">
              Personal details <span>↗</span>
            </div>
            <p className="mt-6 text-sm leading-6 text-slate-500">
              Big adventures start with small introductions. Add your name and a
              favorite photo.
            </p>
            <div className="mt-8 rounded-2xl bg-teal-50 p-6">
              <span className="text-3xl" aria-hidden="true">
                ✧
              </span>
              <h2 className="mt-3 font-semibold">You bring the personality.</h2>
              <p className="mt-2 text-sm leading-6 text-teal-800">
                We’ll make room for the memories.
              </p>
            </div>
          </aside>
          <section className="settings-card">
            {error || !profile ? (
              <div role="alert" className="notice">
                <h2 className="font-semibold">
                  Your profile couldn’t be loaded.
                </h2>
                <p className="mt-2">
                  Try refreshing. If this continues, check that the existing
                  profile trigger created your row and that your account has
                  permission to read it.
                </p>
              </div>
            ) : (
              <ProfileForm
                profile={profile}
                avatarSrc={avatarSrc}
                avatarError={avatarError}
                userId={user.id}
                email={profile.email ?? user.email ?? ""}
              />
            )}
          </section>
        </div>
      </main>
    </>
  );
}
