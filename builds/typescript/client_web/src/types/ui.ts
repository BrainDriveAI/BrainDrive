export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export interface Project {
  id: string;
  name: string;
  icon: string;
  conversationId: string | null;
}

export interface ProjectFile {
  name: string;
  path: string;
}

export type UserProfile = {
  name: string;
  initials: string;
  email: string;
};
