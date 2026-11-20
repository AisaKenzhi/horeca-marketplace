import { type ReactNode } from "react";
import { useApp } from "@/app/store";
import { EmptyState, MoneyText, Notice, Section } from "@/components/primitives";
import { describePackaging } from "@/components/format";

export function BuyerLists(): ReactNode {
  const { state, membership, messages } = useApp();
  // Scope lists by the acting membership's organisation — never by "the first
  // location". A buyer org sees only its own lists.
  const lists = state.buyerLists.filter((l) => l.orgId === membership.orgId);

  if (lists.length === 0) {
    return (
      <Section heading={messages.nav.lists}>
        <EmptyState message="Списков закупок нет (демо)." />
      </Section>
    );
  }

  return (
    <div className="stack">
      <Notice tone="info">
        Списки закупок — это черновые наборы для планирования, а не заказы. Ничего не
        отправляется.
      </Notice>
      {lists.map((list) => (
        <Section key={list.id} heading={list.name} headingId={`list-${list.id}`}>
          {list.offerIds.length === 0 ? (
            <EmptyState message="Список пуст (демо)." />
          ) : (
            <ul className="list-simple">
              {list.offerIds.map((offerId) => {
                const offer = state.offers.find((o) => o.id === offerId);
                const supplier = offer
                  ? state.suppliers.find((s) => s.id === offer.supplierId)
                  : null;
                return (
                  <li key={offerId}>
                    <div>
                      <strong>{offer?.title ?? offerId}</strong>
                      <div className="muted small">
                        {supplier?.displayName ?? "—"} ·{" "}
                        {offer ? describePackaging(offer) : "—"}
                      </div>
                    </div>
                    <MoneyText value={offer?.pricePerSellUnit.value ?? null} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ))}
    </div>
  );
}
