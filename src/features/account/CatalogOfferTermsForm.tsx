import { useState, type FormEvent, type ReactNode } from "react";
import type { CatalogAvailability } from "@/data/supabase/database.types";
import { workspaceErrorMessage, type CatalogOfferTerms } from "@/data/supabase/workspace";
import { validateCatalogOfferTerms } from "@/data/supabase/validation";

function Notice({ children }: { children: ReactNode }): ReactNode {
  return <div className="notice notice-danger">{children}</div>;
}

export function CatalogOfferTermsForm({
  offerId,
  priceAmount,
  currency,
  availability,
  busy,
  onUpdate,
}: {
  offerId: string;
  priceAmount: number | null;
  currency: string | null;
  availability: CatalogAvailability;
  busy: boolean;
  onUpdate: (terms: CatalogOfferTerms) => Promise<void>;
}): ReactNode {
  const [priceText, setPriceText] = useState(priceAmount?.toString() ?? "");
  const [currencyText, setCurrencyText] = useState(currency ?? "");
  const [nextAvailability, setNextAvailability] = useState(availability);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const amount = priceText.trim() ? Number(priceText) : null;
    const terms: CatalogOfferTerms = {
      priceAmount: amount,
      currency: amount === null ? null : currencyText.trim().toUpperCase(),
      availability: nextAvailability,
    };
    const validationError = validateCatalogOfferTerms(terms);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      await onUpdate(terms);
    } catch (caught) {
      setError(workspaceErrorMessage(caught));
    }
  }

  return (
    <details className="account-offer-editor">
      <summary>Изменить цену и наличие</summary>
      <form
        className="account-form account-form-grid"
        onSubmit={(event) => void submit(event)}
      >
        <label className="field" htmlFor={`offer-edit-price-${offerId}`}>
          Цена за продаваемую единицу
          <input
            id={`offer-edit-price-${offerId}`}
            type="number"
            min="0.0001"
            step="0.0001"
            value={priceText}
            onChange={(event) => setPriceText(event.target.value)}
          />
        </label>
        <label className="field" htmlFor={`offer-edit-currency-${offerId}`}>
          Код валюты
          <input
            id={`offer-edit-currency-${offerId}`}
            autoCapitalize="characters"
            maxLength={3}
            placeholder="EUR"
            value={currencyText}
            onChange={(event) => setCurrencyText(event.target.value.toUpperCase())}
          />
        </label>
        <label className="field" htmlFor={`offer-edit-availability-${offerId}`}>
          Доступность
          <select
            id={`offer-edit-availability-${offerId}`}
            value={nextAvailability}
            onChange={(event) =>
              setNextAvailability(event.target.value as CatalogAvailability)
            }
          >
            <option value="unknown">Неизвестно</option>
            <option value="in_stock">В наличии</option>
            <option value="low_stock">Мало</option>
            <option value="out_of_stock">Нет в наличии</option>
            <option value="on_request">Под заказ</option>
          </select>
        </label>
        {error ? (
          <div className="account-form-full">
            <Notice>{error}</Notice>
          </div>
        ) : null}
        <button
          className="btn btn-primary account-form-full"
          type="submit"
          disabled={busy}
        >
          Сохранить изменения
        </button>
      </form>
    </details>
  );
}
