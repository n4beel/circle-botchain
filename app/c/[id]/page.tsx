import PageShell from "@/components/layout/PageShell";
import CircleDetailView from "@/components/circle/CircleDetailView";
import { NAV } from "@/lib/nav";

interface CirclePageProps {
  params: Promise<{ id: string }>;
}

export default async function CirclePage({ params }: CirclePageProps) {
  const { id } = await params;
  let circleId = 1n;
  try {
    circleId = BigInt(id);
  } catch {
    circleId = 1n;
  }

  return (
    <PageShell nav={NAV}>
      <CircleDetailView id={circleId} />
    </PageShell>
  );
}
