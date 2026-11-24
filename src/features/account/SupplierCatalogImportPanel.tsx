import { useState, type ChangeEvent, type ReactNode } from "react";
import type { MembershipRole, VerificationStatus } from "@/data/supabase/database.types";
import {
  applySupplierCatalogImport,
  canManageSupplierCatalog,
  previewSupplierCatalogImport,
  WorkspaceError,
  workspaceErrorMessage,
  type SupplierCatalogImportPreview,
  type SupplierCatalogImportRowStatus,
  type SupplierCatalogImportSummary,
  type WorkspaceClient,
} from "@/data/supabase/workspace";
import {
  parseMappedCatalogCsv,
  PERSISTENT_IMPORT_COLUMNS,
  PERSISTENT_IMPORT_LIMITS,
  type PersistentImportColumn,
  type PersistentImportMapping,
  type PersistentImportResult,
} from "@/domain/catalogImport";

const COLUMN_LABELS: Record<PersistentImportColumn, string> = {
  sku: "SKU поставщика",
  title: "Название товара",
  category: "Категория",
  sell_unit_label: "Продаваемая единица",
  units_per_sell_unit: "Единиц в продаже",
  pack_amount: "Размер упаковки",
  pack_base_unit: "Базовая единица упаковки",
  price_amount: "Цена за продаваемую единицу",
  currency: "Код валюты",
  moq: "Минимум заказа (MOQ)",
  order_step: "Шаг заказа",
  availability: "Доступность",
};

const REQUIRED_COLUMNS = new Set<PersistentImportColumn>([
  "sku",
  "title",
  "category",
  "sell_unit_label",
  "units_per_sell_unit",
  "pack_amount",
  "pack_base_unit",
  "price_amount",
  "currency",
  "moq",
  "order_step",
]);

const ROW_STATUS_LABELS: Record<SupplierCatalogImportRowStatus, string> = {
  added: "Создать",
  updated: "Обновить",
  unchanged: "Без изменений",
  error: "Ошибка",
};

const ERROR_LABELS: Record<string, string> = {
  malformed_row: "Строка имеет неверный формат.",
  malformed_client_errors: "Не удалось проверить формат строки.",
  malformed_client_error: "Некорректная ошибка проверки строки.",
  invalid_row_number: "Неверный номер строки.",
  malformed_values: "Значения строки имеют неверный формат.",
  missing_or_extra_fields: "Не совпадает набор полей импорта.",
  field_must_be_text: "Все значения CSV должны быть текстом.",
  invalid_sku: "Укажите SKU длиной от 1 до 80 символов без пробелов по краям.",
  invalid_title: "Укажите название длиной от 1 до 180 символов.",
  invalid_category: "Укажите категорию длиной от 1 до 80 символов.",
  invalid_sell_unit: "Укажите продаваемую единицу.",
  invalid_integer: "Количество, MOQ и шаг должны быть положительными целыми числами.",
  invalid_pack_amount:
    "Размер упаковки должен быть положительным числом с точностью до 3 знаков.",
  invalid_pack_unit: "Базовая единица должна быть kg, l или piece.",
  invalid_availability: "Неизвестное значение доступности.",
  invalid_price: "Укажите положительную цену с точностью до 4 знаков.",
  invalid_currency: "Укажите явный трёхбуквенный код валюты в верхнем регистре.",
  duplicate_sku: "SKU повторяется в этом файле.",
  approval_required_for_existing_offer:
    "Изменять существующие предложения можно после одобрения профиля поставщика.",
};

function rowErrorLabel(error: string): string {
  if (ERROR_LABELS[error]) return ERROR_LABELS[error];
  const [field, detail] = error.split(":", 2);
  if (detail) {
    const label = COLUMN_LABELS[field as PersistentImportColumn] ?? field;
    if (detail.trim() === "required") return `${label}: обязательное поле.`;
    if (detail.includes("positive"))
      return `${label}: требуется положительное значение допустимого формата.`;
    if (detail.includes("characters"))
      return `${label}: значение превышает допустимую длину.`;
    if (detail.includes("uppercase code"))
      return `${label}: укажите код валюты из трёх заглавных букв.`;
  }
  return error;
}

function summaryLabel(summary: SupplierCatalogImportSummary): string {
  return `${summary.added} добавлено · ${summary.updated} обновлено · ${summary.unchanged} без изменений · ${summary.errors} ошибок`;
}

function inferMapping(headers: readonly string[]): PersistentImportMapping {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  const mapping: Partial<Record<PersistentImportColumn, number>> = {};
  for (const column of PERSISTENT_IMPORT_COLUMNS) {
    const index = normalized.indexOf(column);
    if (index >= 0) mapping[column] = index;
  }
  return mapping;
}

export function SupplierCatalogImportPanel({
  client,
  organizationId,
  role,
  verificationStatus,
  onApplied,
}: {
  client: WorkspaceClient;
  organizationId: string;
  role: MembershipRole;
  verificationStatus: VerificationStatus;
  onApplied: () => void;
}): ReactNode {
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [mapping, setMapping] = useState<PersistentImportMapping>({});
  const [parsed, setParsed] = useState<PersistentImportResult | null>(null);
  const [preview, setPreview] = useState<SupplierCatalogImportPreview | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  if (
    !canManageSupplierCatalog(role) ||
    (verificationStatus !== "pending" && verificationStatus !== "approved")
  ) {
    return null;
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    setPreview(null);
    setParsed(null);
    setCsvText("");
    setMapping({});
    setIdempotencyKey("");
    setActionError("");
    setNotice("");
    if (!file) return;
    setFileName(file.name);
    if (file.size > PERSISTENT_IMPORT_LIMITS.maxBytes) {
      setActionError(
        `Файл превышает ограничение ${PERSISTENT_IMPORT_LIMITS.maxBytes / 1_000} КБ.`,
      );
      return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      const headerProbe = parseMappedCatalogCsv(text, {});
      const nextMapping = inferMapping(headerProbe.headers);
      setCsvText(text);
      setMapping(nextMapping);
      setParsed(parseMappedCatalogCsv(text, nextMapping));
    } catch {
      setActionError("Не удалось прочитать CSV-файл.");
    } finally {
      setBusy(false);
    }
  }

  function changeMapping(column: PersistentImportColumn, value: string) {
    const nextMapping: Partial<Record<PersistentImportColumn, number>> = {
      ...mapping,
    };
    if (value === "") delete nextMapping[column];
    else nextMapping[column] = Number(value);
    setMapping(nextMapping);
    setParsed(parseMappedCatalogCsv(csvText, nextMapping));
    setPreview(null);
    setIdempotencyKey("");
    setActionError("");
    setNotice("");
  }

  async function requestPreview() {
    if (!parsed || parsed.errors.length > 0 || parsed.rows.length === 0) return;
    setBusy(true);
    setPreview(null);
    setActionError("");
    setNotice("");
    const key = idempotencyKey || globalThis.crypto.randomUUID();
    setIdempotencyKey(key);
    try {
      const result = await previewSupplierCatalogImport(
        client,
        organizationId,
        key,
        parsed.rows,
      );
      setPreview(result);
      if (result.status === "applied") {
        setNotice("Этот импорт уже был применён ранее.");
        onApplied();
      }
    } catch (error: unknown) {
      setActionError(workspaceErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function applyPreview() {
    if (!preview || preview.status !== "previewed" || preview.summary.errors > 0) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await applySupplierCatalogImport(client, organizationId, preview.import_id);
      setPreview((current) => (current ? { ...current, status: "applied" } : current));
      setNotice("Импорт применён. Каталог обновлён.");
      onApplied();
    } catch (error: unknown) {
      const message = workspaceErrorMessage(error);
      setActionError(message);
      if (error instanceof WorkspaceError && error.code === "stale_preview") {
        setPreview(null);
        setIdempotencyKey("");
      }
    } finally {
      setBusy(false);
    }
  }

  const locallyInvalidRows =
    parsed?.rows.filter((row) => row.client_errors.length > 0).length ?? 0;
  const canPreview =
    !busy && parsed !== null && parsed.errors.length === 0 && parsed.rows.length > 0;
  const canApply =
    !busy && preview?.status === "previewed" && preview.summary.errors === 0;

  return (
    <section
      className="card account-section supplier-import-panel"
      aria-labelledby="supplier-import-title"
    >
      <h2 className="card-title" id="supplier-import-title">
        Импорт каталога из CSV
      </h2>
      <p className="small muted">
        Файл до 500 КБ и 2&nbsp;000 строк. Цена, валюта, продаваемая единица и единица
        упаковки должны быть указаны явно; автоматической конвертации нет.
      </p>
      {verificationStatus === "pending" ? (
        <div className="notice notice-warn">
          Профиль ещё на проверке: можно добавить новые черновые SKU, но существующие
          предложения можно менять только после одобрения.
        </div>
      ) : null}
      <label
        className="field supplier-import-file"
        htmlFor={`supplier-import-file-${organizationId}`}
      >
        CSV-файл
        <input
          id={`supplier-import-file-${organizationId}`}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void selectFile(event)}
          disabled={busy}
        />
      </label>
      {fileName ? <p className="small muted">Выбран файл: {fileName}</p> : null}

      {parsed && parsed.headers.length > 0 ? (
        <fieldset className="supplier-import-mapping">
          <legend>Сопоставление колонок</legend>
          <div className="supplier-import-mapping-grid">
            {PERSISTENT_IMPORT_COLUMNS.map((column) => (
              <label
                className="field"
                key={column}
                htmlFor={`supplier-import-map-${organizationId}-${column}`}
              >
                {COLUMN_LABELS[column]}
                {REQUIRED_COLUMNS.has(column) ? " (обязательно)" : " (необязательно)"}
                <select
                  id={`supplier-import-map-${organizationId}-${column}`}
                  value={mapping[column] === undefined ? "" : String(mapping[column])}
                  onChange={(event) => changeMapping(column, event.target.value)}
                  disabled={busy}
                >
                  <option value="">Не выбрано</option>
                  {parsed.headers.map((header, index) => (
                    <option key={`${index}-${header}`} value={index}>
                      {index + 1}. {header || "(пустой заголовок)"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {parsed?.errors.map((error) => (
        <div className="notice notice-danger" key={error} role="alert">
          {error}
        </div>
      ))}
      {parsed && parsed.rows.length > 0 && parsed.errors.length === 0 ? (
        <p className="small muted" aria-live="polite">
          Строк данных: {parsed.rows.length}.
          {locallyInvalidRows > 0
            ? ` Предварительно обнаружены ошибки в строках: ${locallyInvalidRows}; серверный предпросмотр заблокирует применение.`
            : " Запустите предпросмотр, чтобы сверить позиции с текущим каталогом."}
        </p>
      ) : null}

      <div className="supplier-import-actions">
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void requestPreview()}
          disabled={!canPreview}
        >
          {busy && !preview ? "Проверяем…" : "Предпросмотр импорта"}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => void applyPreview()}
          disabled={!canApply}
        >
          {busy && preview?.status === "previewed"
            ? "Применяем…"
            : "Применить весь импорт"}
        </button>
      </div>
      {actionError ? (
        <div className="notice notice-danger" role="alert">
          {actionError}
        </div>
      ) : null}
      {notice ? (
        <div className="notice notice-info" role="status">
          {notice}
        </div>
      ) : null}

      {preview ? (
        <section
          className="supplier-import-preview"
          aria-labelledby="supplier-import-preview-title"
        >
          <h3 id="supplier-import-preview-title">Предпросмотр</h3>
          <p className="supplier-import-summary" aria-label="Сводка импорта">
            {summaryLabel(preview.summary)}
          </p>
          {preview.status === "blocked" ? (
            <div className="notice notice-danger" role="status">
              Есть блокирующие ошибки: пакет не будет применён частично.
            </div>
          ) : null}
          {preview.status === "applied" ? (
            <div className="notice notice-info" role="status">
              Этот пакет уже применён; повторное применение не создаёт дубликаты.
            </div>
          ) : null}
          <ul className="supplier-import-rows">
            {preview.rows.map((row) => (
              <li
                className={`supplier-import-row supplier-import-row-${row.status}`}
                key={`${row.row_number}-${row.sku ?? "unknown"}`}
              >
                <div className="supplier-import-row-heading">
                  <strong>Строка {row.row_number}</strong>
                  <span
                    className={`badge ${row.status === "error" ? "badge-unknown" : "badge-fresh"}`}
                  >
                    {ROW_STATUS_LABELS[row.status]}
                  </span>
                </div>
                <p className="small">
                  SKU: <strong>{row.sku ?? "не определён"}</strong>
                </p>
                {row.changes.length > 0 ? (
                  <ul className="supplier-import-details">
                    {row.changes.map((change, index) => (
                      <li key={`${index}-${change}`}>{change}</li>
                    ))}
                  </ul>
                ) : null}
                {row.errors.length > 0 ? (
                  <ul className="supplier-import-errors">
                    {row.errors.map((error, index) => (
                      <li key={`${index}-${error}`}>{rowErrorLabel(error)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
