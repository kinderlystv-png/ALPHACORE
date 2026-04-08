import { AppShell } from "@/components/app-shell";
import { HomeDashboardClient } from "@/components/home-dashboard-client";

export default function Home() {
  return (
    <AppShell>
      <HomeDashboardClient />
    </AppShell>
  );
}
