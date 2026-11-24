import { useMemo, useState, type ReactNode } from "react";
import { useApp } from "@/app/store";
import {
  EmptyState,
  FreshnessBadge,
  MoneyText,
  Notice,
  Section,
} from "@/components/primitives";
import { availabilityLabel, describePackaging, relativeAge } from "@/components/format";
import { evaluateFreshness } from "@/domain/freshness";
import { unitPrice } from "@/domain/packaging";
import { formatMoney } from "@/domain/money";
import { toSafeError } from "@/domain/errors";
import type { SupplierOffer } from "@/domain/entities";

interface CatalogRowProps {
  offer: SupplierOffer;
  supplierName: string;
  nowIso: string;
  onAdd: (offerId: string, quantity: number) => void;
}

function CatalogRow({ offer, supplierName, nowIso, onAdd }: CatalogRowProps): ReactNode {
  const { messages, config } = useApp();
  const [quantity, setQuantity] = useState<number>(offer.packaging.moq);
  const [error, setError] = useState<string | null>(null);

  const priceFreshness = evaluateFreshness(
    offer.pricePerSellUnit,
    nowIso,
    config.freshness,
  );
  const availFreshness = evaluateFreshness(offer.availability, nowIso, config.freshness);
  const up = offer.pricePerSellUnit.value
    ? unitPrice(offer.pricePerSellUnit.value.amount, offer.packaging.sellUnit)
    : null;

  function handleAdd(): void {
    try {
      onAdd(offer.id, quantity);
      setError(null);
    } catch (e) {
      setError(toSafeError(e).message);
    }
  }

  return (
    <article className="catalog-row" aria-label={offer.title}>
      <div className="catalog-row-main">
        <h3 className="offer-title">{offer.title}</h3>
        <p className="offer-seller">
          <strong>{messages.common.supplier}:</strong> {supplierName} · SKU:{" "}
          {offer.supplierSku}
        </p>
        <dl className="offer-grid">
          <div>
            <dt>{messages.common.perSellUnit}</dt>
            <dd>
              <MoneyText value={offer.pricePerSellUnit.value} />
            </dd>
          </div>
          <div>
            <dt>Продаваемая единица</dt>
            <dd>{describePackaging(offer)}</dd>
          </div>
          <div>
            <dt>{messages.common.unitPrice}</dt>
            <dd>
              {up && up.comparable ? (
                <>
                  {formatMoney({ amount: up.perBaseUnitMinor, currency: "KZT" })} /{" "}
                  {up.baseUnit}
                  {!up.exactlyDivisible ? " (округлено)" : ""}
                </>
              ) : (
                <span className="muted">{messages.common.incomparable}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{messages.common.moq}</dt>
            <dd>{offer.packaging.moq}</dd>
          </div>
          <div>
            <dt>{messages.common.orderStep}</dt>
            <dd>{offer.packaging.orderStep}</dd>
          </div>
          <div>
            <dt>{messages.common.availability}</dt>
            <dd>{availabilityLabel(offer.availability)}</dd>
          </div>
        </dl>
        <div className="badge-row">
          <FreshnessBadge
            freshness={priceFreshness}
            observedAt={offer.pricePerSellUnit.observedAt}
            labelUpdated={`${messages.common.price} ${messages.common.updated}`}
            labelStale={messages.common.stale}
            labelUnknown={`${messages.common.price}: ${messages.common.notStated}`}
          />
          <FreshnessBadge
            freshness={availFreshness}
            observedAt={offer.availability.observedAt}
            labelUpdated={`${messages.common.availability} ${messages.common.updated}`}
            labelStale={`${messages.common.availability} ${messages.common.stale}`}
            labelUnknown={`${messages.common.availability}: ${messages.common.notStated}`}
          />
        </div>
        <p className="muted small">
          Возраст снимка: {relativeAge(offer.pricePerSellUnit.observedAt, nowIso)}
        </p>
      </div>

      <div className="catalog-row-actions">
        <label className="field">
          <span>{messages.common.quantity}</span>
          <input
            type="number"
            min={offer.packaging.moq}
            step={offer.packaging.orderStep}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            inputMode="numeric"
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={handleAdd}>
          {messages.common.addToBasket}
        </button>
        {error ? (
          <p className="error small" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function BuyerCatalog(): ReactNode {
  const { state, repo, session, config, messages } = useApp();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const [supplierId, setSupplierId] = useState<string>("__all__");
  const [sortByUnitPrice, setSortByUnitPrice] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const suppliersById = useMemo(
    () => new Map(state.suppliers.map((s) => [s.id as string, s])),
    [state.suppliers],
  );

  const categories = useMemo(
    () => [...new Set(state.products.map((p) => p.category))].sort(),
    [state.products],
  );

  const productsById = useMemo(
    () => new Map(state.products.map((p) => [p.id as string, p])),
    [state.products],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repo
      .visibleCatalog()
      .filter((o) => {
        if (supplierId !== "__all__" && o.supplierId !== supplierId) return false;
        const product = productsById.get(o.productId);
        if (category !== "__all__" && product?.category !== category) return false;
        if (q.length === 0) return true;
        return (
          o.title.toLowerCase().includes(q) || o.supplierSku.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (!sortByUnitPrice) return a.title.localeCompare(b.title, "ru");
        const ua =
          a.pricePerSellUnit.value &&
          unitPrice(a.pricePerSellUnit.value.amount, a.packaging.sellUnit);
        const ub =
          b.pricePerSellUnit.value &&
          unitPrice(b.pricePerSellUnit.value.amount, b.packaging.sellUnit);
        if (!ua || !ua.comparable) return 1;
        if (!ub || !ub.comparable) return -1;
        return ua.perBaseUnitMinor - ub.perBaseUnitMinor;
      });
  }, [repo, query, category, supplierId, sortByUnitPrice, productsById]);

  function handleAdd(offerId: string, quantity: number): void {
    repo.addToBasket(session, offerId, quantity);
    setMessage("Позиция добавлена в корзину (демо).");
  }

  return (
    <div className="stack">
      <Section heading={messages.catalog.heading} headingId="catalog-heading">
        <Notice tone="info">
          Каталог — это не обещание наличия. Цена и наличие показаны отдельно с временными
          метками; устаревшее или неизвестное значение помечено.
        </Notice>

        <div className="filters" role="search">
          <label className="field">
            <span>{messages.catalog.search}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="например: мука"
            />
          </label>
          <label className="field">
            <span>{messages.catalog.category}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="__all__">{messages.catalog.allCategories}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{messages.catalog.supplierFilter}</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="__all__">{messages.catalog.allSuppliers}</option>
              {state.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-checkbox">
            <input
              type="checkbox"
              checked={sortByUnitPrice}
              onChange={(e) => setSortByUnitPrice(e.target.checked)}
            />
            <span>{messages.catalog.sortByUnitPrice}</span>
          </label>
        </div>

        {message ? (
          <p className="info small" role="status" aria-live="polite">
            {message}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState message="Ничего не найдено — измените фильтры (демо-каталог)." />
        ) : (
          <ul className="catalog-list">
            {rows.map((offer) => (
              <li key={offer.id}>
                <CatalogRow
                  offer={offer}
                  supplierName={
                    suppliersById.get(offer.supplierId as string)?.displayName ?? "—"
                  }
                  nowIso={config.demoNow}
                  onAdd={handleAdd}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
