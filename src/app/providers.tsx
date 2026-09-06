"use client";

import { AuthProvider } from "@/lib/authContext";
import { CampusProvider } from "@/lib/campusContext";
import { ToastProvider } from "@/components/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <CampusProvider>{children}</CampusProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
