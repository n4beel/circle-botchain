import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import CreateCircleForm from "@/components/circle/CreateCircleForm";
import { NAV } from "@/lib/nav";

export default function NewCirclePage() {
  return (
    <PageShell
      nav={NAV}
      title="Start a Savings Circle"
      description="Assemble a circle of 3 to 12 trusted friends. Set an equal contribution and fixed payout turns."
    >
      <BotChainGate noWalletNote="Viewing circles works without a wallet. Connect your wallet to create a savings circle.">
        <CreateCircleForm />
      </BotChainGate>
    </PageShell>
  );
}
