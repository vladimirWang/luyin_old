import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const WECOM_AUTH_STORAGE_KEY = "wecom-recorder-wecom-auth";

export function hasWecomIdentity(user) {
  return Boolean(String(user?.userId || user?.openUserId || "").trim());
}

export const useWecomAuthStore = create(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user: hasWecomIdentity(user) ? user : null }),
      clearUser: () => set({ user: null }),
    }),
    {
      name: WECOM_AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ user }) => ({ user }),
    },
  ),
);
