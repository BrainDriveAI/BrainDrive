import {
  Briefcase,
  DollarSign,
  Dumbbell,
  Folder,
  FolderPlus,
  Heart,
  Plus,
  Sparkles,
  Users,
  type LucideIcon
} from "lucide-react";

const PROJECT_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  plus: Plus,
  "dollar-sign": DollarSign,
  dumbbell: Dumbbell,
  heart: Heart,
  briefcase: Briefcase,
  users: Users,
  "folder-plus": FolderPlus
};

export function getProjectIcon(icon: string): LucideIcon {
  return PROJECT_ICONS[icon] ?? Folder;
}
