import PageShell from "@/components/layout/PageShell";
import CircleList from "@/components/circle/CircleList";
import { NAV } from "@/lib/nav";

export default function HomePage() {
  return (
    <PageShell nav={NAV}>
      <CircleList />
    </PageShell>
  );
}
