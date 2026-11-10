import {
  Activity,
  BrainCircuit,
  FlaskConical,
  Info,
  Radar,
  TriangleAlert,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const navigationItems: NavigationItem[] = [
  { label: "Overview", href: "/", icon: Radar },
  { label: "Observatory", href: "/observatory", icon: Activity },
  { label: "Chaos lab", href: "/chaos-lab", icon: FlaskConical },
  { label: "Incidents", href: "/incidents", icon: TriangleAlert },
  { label: "Architecture", href: "/architecture", icon: Workflow },
  { label: "Intelligence", href: "/intelligence", icon: BrainCircuit },
  { label: "About", href: "/about", icon: Info },
];
