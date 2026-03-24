import { buildLocalOwnerHeaders } from "./local-auth";
import type { Session } from "./types";

const SESSION_STORAGE_KEY = "braindrive.local.session";

const LOCAL_SESSION: Session = {
  mode: "local",
  user: {
    id: "owner",
    name: "Local Owner",
    initials: "LO",
    email: "owner@local.braindrive",
    role: "owner"
  }
};

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export async function login(): Promise<void> {
  if (hasStorage()) {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, "active");
  }
}

export async function logout(): Promise<void> {
  if (hasStorage()) {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export async function getSession(): Promise<Session> {
  if (hasStorage() && !window.sessionStorage.getItem(SESSION_STORAGE_KEY)) {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, "active");
  }

  try {
    const response = await fetch("/api/session", {
      headers: buildLocalOwnerHeaders(),
    });
    if (!response.ok) {
      return LOCAL_SESSION;
    }

    return (await response.json()) as Session;
  } catch {
    return LOCAL_SESSION;
  }
}

export type { Session };
