"use client";

// Front door. Sends people wherever they belong.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { Splash } from "@/components/Splash";

export default function Home() {
  const { ready, user, profile, profileReady, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!configured || !ready) return;
    if (!user) return void router.replace("/login");
    // Wait for the profile listener to answer before choosing between
    // the board and the onboarding form - guessing sends people who
    // already have a profile to the wrong one.
    if (!profileReady) return;
    if (!profile) router.replace("/onboarding");
    else router.replace("/board");
  }, [ready, user, profile, profileReady, configured, router]);

  if (!configured) return <Splash kind="unconfigured" />;
  return <Splash kind="loading" />;
}
