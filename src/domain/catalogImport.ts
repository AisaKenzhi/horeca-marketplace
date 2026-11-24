/**
 * Local CSV catalog import for the prototype.
 *
 * P0 scope:
 *   - A fixed template with required columns.
 *   - Parse + validate locally, with a row number and field on every error.
 *   - Detect duplicate supplier SKUs.
 *   - Produce an "added / updated / error" summary and a preview.
 *
 * Safety:
 *   - Fixed-size and row-count limits.
 *   - No formula/macro/HTML execution: values are treated as plain text.
 *   - No silent unit/price "fixing": suspicious values are rejected with a
 *     reason, never auto-corrected.
 */

import type { BaseUnit } from "./packaging";
import type { AvailabilityStatus } from "./freshness";

export const IMPORT_COLUMNS = [
  "sku",
  "title",
  "category",
  "sell_unit_label",
  "units_per_sell_unit",
  "pack_amount",
  "pack_base_unit",
  "price_per_sell_unit",
  "moq",
  "order_step",
  "availability",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const REQUIRED_COLUMNS: readonly ImportColumn[] = [
  "sku",
  "title",
  "sell_unit_label",
  "units_per_sell_unit",
  "pack_amount",
  "pack_base_unit",
  "price_per_sell_unit",
  "moq",
  "order_step",
];

export const IMPORT_LIMITS = {
  maxBytes: 512_000,
  maxRows: 2_000,
} as const;

export interface ParsedImportRow {
  readonly rowNumber: number;
  readonly values: Partial<Record<ImportColumn, string>>;
  readonly errors: readonly string[];
  readonly status: "added" | "updated" | "error";
  readonly sku: string | null;
}

export interface ParsedImport {
  readonly rows: readonly ParsedImportRow[];
  readonly summary: {
    readonly added: number;
    readonly updated: number;
    readonly errors: number;
    readonly skipped: number;
  };
}

const BASE_UNITS = new Set(["kg", "l", "piece"]);
const AVAILABILITY = new Set(["in_stock", "low_stock", "out_of_stock", "on_request"]);

/** Split a single CSV line, honouring simple double-quote escaping. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Neutralise potentially dangerous leading characters so a value can never be
 * interpreted as a spreadsheet formula when later exported. We keep the text
 * readable rather than stripping it silently.
 */
export function sanitizeCell(raw: string): string {
  const value = raw.trim();
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function parseIntStrict(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : null;
}

export function parseCatalogCsv(
  csvText: string,
  options: { existingSkus: readonly string[] } = { existingSkus: [] },
): ParsedImport {
  const raw = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const allLines = raw.split("\n").filter((l) => l.trim().length > 0);
  const rows: ParsedImportRow[] = [];

  if (allLines.length === 0) {
    return { rows: [], summary: { added: 0, updated: 0, errors: 0, skipped: 0 } };
  }

  const headerCells = splitCsvLine(allLines[0]!).map((h) => h.trim().toLowerCase());
  const headerIndex = new Map<string, number>();
  headerCells.forEach((h, i) => headerIndex.set(h, i));

  const missing = REQUIRED_COLUMNS.filter((c) => !headerIndex.has(c));
  if (missing.length > 0) {
    // A structural error: report it against row 1 (the header).
    return {
      rows: [
        {
          rowNumber: 1,
          values: {},
          errors: [`Отсутствуют обязательные колонки: ${missing.join(", ")}`],
          status: "error",
          sku: null,
        },
      ],
      summary: { added: 0, updated: 0, errors: 1, skipped: 0 },
    };
  }

  const dataLines = allLines.slice(1, IMPORT_LIMITS.maxRows + 1);
  const seenSkus = new Set<string>();
  const existing = new Set(options.existingSkus);

  dataLines.forEach((line, idx) => {
    const rowNumber = idx + 2; // 1-based, +1 for the header line
    const cells = splitCsvLine(line);
    const values: Partial<Record<ImportColumn, string>> = {};
    for (const col of IMPORT_COLUMNS) {
      const cellIndex = headerIndex.get(col);
      if (cellIndex === undefined) continue;
      values[col] = sanitizeCell(cells[cellIndex] ?? "");
    }

    const errors: string[] = [];
    const sku = values.sku ?? null;

    if (!sku) errors.push("sku: обязательное значение");

    const units = values.units_per_sell_unit
      ? parseIntStrict(values.units_per_sell_unit)
      : null;
    if (units === null || units <= 0) {
      errors.push("units_per_sell_unit: должно быть целым положительным числом");
    }

    const packAmount = values.pack_amount
      ? Number(values.pack_amount.replace(",", "."))
      : NaN;
    if (!Number.isFinite(packAmount) || packAmount <= 0) {
      errors.push("pack_amount: должно быть положительным числом");
    }

    const baseUnit = values.pack_base_unit ?? "";
    if (!BASE_UNITS.has(baseUnit)) {
      errors.push("pack_base_unit: ожидается kg, l или piece");
    }

    // Price must be a whole number of KZT; we never silently round a decimal.
    const price = values.price_per_sell_unit
      ? parseIntStrict(values.price_per_sell_unit)
      : null;
    if (price === null || price <= 0) {
      errors.push("price_per_sell_unit: должно быть целым положительным числом (тенге)");
    } else if (!/^\d+$/.test((values.price_per_sell_unit ?? "").trim())) {
      errors.push(
        "price_per_sell_unit: не принимаем дробную цену без явного подтверждения",
      );
    }

    const moq = values.moq ? parseIntStrict(values.moq) : null;
    if (moq === null || moq <= 0)
      errors.push("moq: должно быть целым положительным числом");

    const step = values.order_step ? parseIntStrict(values.order_step) : null;
    if (step === null || step <= 0)
      errors.push("order_step: должно быть целым положительным числом");

    const availability = values.availability ?? "";
    if (availability && !AVAILABILITY.has(availability)) {
      errors.push(
        "availability: ожидается in_stock, low_stock, out_of_stock или on_request",
      );
    }

    let status: ParsedImportRow["status"] = "added";
    if (errors.length > 0) {
      status = "error";
    } else if (sku && (existing.has(sku) || seenSkus.has(sku))) {
      // Duplicate within the file OR already existing => treated as an update.
      status = "updated";
    }
    if (sku) seenSkus.add(sku);

    rows.push({ rowNumber, values, errors, status, sku });
  });

  const summary = {
    added: rows.filter((r) => r.status === "added").length,
    updated: rows.filter((r) => r.status === "updated").length,
    errors: rows.filter((r) => r.status === "error").length,
    skipped: Math.max(0, allLines.length - 1 - dataLines.length),
  };

  return { rows, summary };
}

/** A ready-to-edit template with a single synthetic example row. */
export const CSV_TEMPLATE = [
  IMPORT_COLUMNS.join(","),
  "DEMO-SKU-1,Демо товар,Бакалея,мешок 5 кг,1,5,kg,3200,2,2,in_stock",
].join("\n");

/* ------------------------------------------------------------------ */
/* Resolution & diff preview                                           */
/* ------------------------------------------------------------------ */

/** A fully validated import row, ready to be written to the repository. */
export interface ResolvedImportOffer {
  readonly sku: string;
  readonly title: string;
  readonly category: string;
  readonly sellUnitLabel: string;
  readonly unitsPerSellUnit: number;
  readonly packAmount: number;
  readonly packBaseUnit: BaseUnit;
  readonly pricePerSellUnit: number;
  readonly moq: number;
  readonly orderStep: number;
  readonly availability: AvailabilityStatus | null;
}

/** The minimal shape of an existing offer the resolver needs for a diff. */
export interface ExistingOfferSnapshot {
  readonly sku: string;
  readonly title: string;
  readonly pricePerSellUnit: number | null;
  readonly moq: number;
  readonly orderStep: number;
}

export type EnrichedRowStatus = "added" | "updated" | "unchanged" | "error";

export interface EnrichedRow {
  readonly rowNumber: number;
  readonly sku: string | null;
  readonly status: EnrichedRowStatus;
  readonly errors: readonly string[];
  /** Human before/after for the preview; only present for non-error rows. */
  readonly changes: readonly string[];
  readonly resolved: ResolvedImportOffer | null;
}

export interface ResolvedImport {
  readonly rows: readonly EnrichedRow[];
  /**
   * Offers that actually need a WRITE (added or updated). `unchanged` rows are
   * deliberately excluded so a re-import of the same file changes nothing and
   * never bumps an offer version. The full per-row preview stays in `rows`.
   */
  readonly resolved: readonly ResolvedImportOffer[];
  readonly summary: {
    readonly added: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly errors: number;
    readonly skipped: number;
  };
}

const AVAILABILITY_SET = new Set<string>([
  "in_stock",
  "low_stock",
  "out_of_stock",
  "on_request",
]);

/**
 * Convert a parsed import into resolved offers plus a before/after diff against
 * the supplier's existing offers. A row is `unchanged` when nothing differs, so
 * re-importing the same file writes nothing and creates no duplicates.
 */
export function resolveImportRows(
  parsed: ParsedImport,
  existingOffers: readonly ExistingOfferSnapshot[],
): ResolvedImport {
  const existingBySku = new Map(existingOffers.map((o) => [o.sku, o]));
  const rows: EnrichedRow[] = [];
  const resolved: ResolvedImportOffer[] = [];

  for (const row of parsed.rows) {
    if (row.status === "error" || row.errors.length > 0) {
      rows.push({
        rowNumber: row.rowNumber,
        sku: row.sku,
        status: "error",
        errors: row.errors,
        changes: [],
        resolved: null,
      });
      continue;
    }
    const v = row.values;
    const price = Number(v.price_per_sell_unit);
    const units = Number(v.units_per_sell_unit);
    const packAmount = Number((v.pack_amount ?? "").replace(",", "."));
    const moq = Number(v.moq);
    const step = Number(v.order_step);
    const availabilityRaw = v.availability ?? "";
    const resolvedOffer: ResolvedImportOffer = {
      sku: row.sku ?? "",
      title: v.title ?? "",
      category: v.category ?? "",
      sellUnitLabel: v.sell_unit_label ?? "",
      unitsPerSellUnit: units,
      packAmount,
      packBaseUnit: (v.pack_base_unit ?? "piece") as BaseUnit,
      pricePerSellUnit: price,
      moq,
      orderStep: step,
      availability: AVAILABILITY_SET.has(availabilityRaw)
        ? (availabilityRaw as AvailabilityStatus)
        : null,
    };

    const existing = existingBySku.get(resolvedOffer.sku);
    const changes: string[] = [];
    if (!existing) {
      changes.push(`новая позиция: ${resolvedOffer.title}, цена ${price}`);
      rows.push({
        rowNumber: row.rowNumber,
        sku: resolvedOffer.sku,
        status: "added",
        errors: [],
        changes,
        resolved: resolvedOffer,
      });
    } else {
      if (existing.title !== resolvedOffer.title) {
        changes.push(`название: «${existing.title}» → «${resolvedOffer.title}»`);
      }
      if (existing.pricePerSellUnit !== resolvedOffer.pricePerSellUnit) {
        changes.push(
          `цена: ${existing.pricePerSellUnit ?? "не указана"} → ${resolvedOffer.pricePerSellUnit}`,
        );
      }
      if (existing.moq !== resolvedOffer.moq) {
        changes.push(`MOQ: ${existing.moq} → ${resolvedOffer.moq}`);
      }
      if (existing.orderStep !== resolvedOffer.orderStep) {
        changes.push(`шаг: ${existing.orderStep} → ${resolvedOffer.orderStep}`);
      }
      const status: EnrichedRowStatus = changes.length > 0 ? "updated" : "unchanged";
      rows.push({
        rowNumber: row.rowNumber,
        sku: resolvedOffer.sku,
        status,
        errors: [],
        changes,
        resolved: resolvedOffer,
      });
      // An `unchanged` row is only a preview entry: do NOT queue it for a write.
      if (status === "unchanged") continue;
    }
    resolved.push(resolvedOffer);
  }

  return {
    rows,
    resolved,
    summary: {
      added: rows.filter((r) => r.status === "added").length,
      updated: rows.filter((r) => r.status === "updated").length,
      unchanged: rows.filter((r) => r.status === "unchanged").length,
      errors: rows.filter((r) => r.status === "error").length,
      skipped: parsed.summary.skipped,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Persistent authenticated supplier import (raw mapped preview only)   */
/* ------------------------------------------------------------------ */

export const PERSISTENT_IMPORT_COLUMNS = [
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
  "availability",
] as const;

export type PersistentImportColumn = (typeof PERSISTENT_IMPORT_COLUMNS)[number];
export type PersistentImportMapping = Readonly<
  Partial<Record<PersistentImportColumn, number>>
>;

export const PERSISTENT_IMPORT_LIMITS = {
  maxBytes: 512_000,
  maxRows: 2_000,
  maxColumns: 32,
  maxCellChars: 4_096,
} as const;

export interface PersistentImportRow {
  readonly row_number: number;
  readonly values: Readonly<Record<PersistentImportColumn, string>>;
  readonly client_errors: readonly string[];
}

export interface PersistentImportResult {
  readonly headers: readonly string[];
  readonly mapping: PersistentImportMapping;
  readonly rows: readonly PersistentImportRow[];
  readonly errors: readonly string[];
  readonly skipped: number;
}

const PERSISTENT_REQUIRED: readonly PersistentImportColumn[] = [
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
];
const PERSISTENT_UNITS = new Set(["kg", "l", "piece"]);
const PERSISTENT_AVAILABILITY = new Set([
  "in_stock",
  "low_stock",
  "out_of_stock",
  "on_request",
  "unknown",
]);
const EMPTY_PERSISTENT_VALUES: Record<PersistentImportColumn, string> = {
  sku: "",
  title: "",
  category: "",
  sell_unit_label: "",
  units_per_sell_unit: "",
  pack_amount: "",
  pack_base_unit: "",
  price_amount: "",
  currency: "",
  moq: "",
  order_step: "",
  availability: "",
};

interface CsvRecord {
  readonly cells: readonly string[];
  readonly rowNumber: number;
}

function parseStrictCsv(input: string): { records: CsvRecord[]; error: string | null } {
  if (input.length > PERSISTENT_IMPORT_LIMITS.maxBytes)
    return {
      records: [],
      error: `CSV exceeds ${PERSISTENT_IMPORT_LIMITS.maxBytes} UTF-8 bytes`,
    };
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let rowNumber = 1;
  let recordNumber = 1;
  let recordHasContent = false;
  const pushCell = (): void => {
    cells.push(cell);
    cell = "";
    closedQuote = false;
  };
  const pushRecord = (): void => {
    pushCell();
    if (recordHasContent || cells.some((value) => value.length > 0))
      records.push({ cells, rowNumber: recordNumber });
    cells = [];
    recordNumber = rowNumber + 1;
    recordHasContent = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        if (ch === "\r" && text[i + 1] === "\n") {
          cell += "\n";
          i += 1;
          rowNumber += 1;
        } else {
          cell += ch;
          if (ch === "\n" || ch === "\r") rowNumber += 1;
        }
      }
      recordHasContent = true;
    } else if (ch === '"') {
      if (cell.length > 0 || closedQuote)
        return { records, error: `Malformed CSV: unexpected quote at line ${rowNumber}` };
      quoted = true;
      recordHasContent = true;
    } else if (ch === ",") {
      pushCell();
      recordHasContent = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushRecord();
      rowNumber += 1;
      if (records.length > PERSISTENT_IMPORT_LIMITS.maxRows + 1)
        return {
          records,
          error: `CSV exceeds ${PERSISTENT_IMPORT_LIMITS.maxRows} data rows`,
        };
    } else {
      if (closedQuote)
        return {
          records,
          error: `Malformed CSV: unexpected text after closing quote at line ${rowNumber}`,
        };
      cell += ch;
      recordHasContent = true;
    }
  }
  if (quoted)
    return {
      records,
      error: `Malformed CSV: unterminated quoted field at line ${recordNumber}`,
    };
  if (cell.length > 0 || cells.length > 0 || recordHasContent) pushRecord();
  if (records.length > PERSISTENT_IMPORT_LIMITS.maxRows + 1)
    return {
      records,
      error: `CSV exceeds ${PERSISTENT_IMPORT_LIMITS.maxRows} data rows`,
    };
  return { records, error: null };
}

function isPositiveInt32(raw: string): boolean {
  if (!/^[0-9]{1,10}$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

function isPositiveDecimal(
  raw: string,
  maxDecimals: number,
  maxIntegerDigits: number,
): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return false;
  if (raw.split(".")[0]!.length > maxIntegerDigits) return false;
  const fraction = raw.split(".")[1];
  if (fraction !== undefined && fraction.length > maxDecimals) return false;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0;
}

/** Parse a CSV using caller-selected zero-based header indices. Values remain plain strings. */
export function parseMappedCatalogCsv(
  csvText: string,
  mapping: PersistentImportMapping,
): PersistentImportResult {
  const errors: string[] = [];
  const mapped = { ...mapping };
  const tooLargeResult = (): PersistentImportResult => ({
    headers: [],
    mapping: mapped,
    rows: [],
    errors: [`CSV exceeds ${PERSISTENT_IMPORT_LIMITS.maxBytes} UTF-8 bytes`],
    skipped: 0,
  });
  if (csvText.length > PERSISTENT_IMPORT_LIMITS.maxBytes) return tooLargeResult();
  if (new TextEncoder().encode(csvText).byteLength > PERSISTENT_IMPORT_LIMITS.maxBytes) {
    return tooLargeResult();
  }
  const parsed = parseStrictCsv(csvText);
  const headers = parsed.records[0]?.cells ?? [];
  const empty = (
    rows: PersistentImportRow[] = [],
    skipped = 0,
  ): PersistentImportResult => ({ headers, mapping: mapped, rows, errors, skipped });
  if (parsed.error) errors.push(parsed.error);
  if (errors.length) return empty();
  if (headers.length > PERSISTENT_IMPORT_LIMITS.maxColumns)
    errors.push(`CSV exceeds ${PERSISTENT_IMPORT_LIMITS.maxColumns} columns`);
  if (parsed.records.length === 0) errors.push("CSV is empty");
  if (parsed.records.length > PERSISTENT_IMPORT_LIMITS.maxRows + 1)
    errors.push(`CSV exceeds ${PERSISTENT_IMPORT_LIMITS.maxRows} data rows`);
  for (const col of PERSISTENT_REQUIRED)
    if (mapping[col] === undefined) errors.push(`Missing required mapping: ${col}`);
  const usedIndices = Object.values(mapping).filter(
    (index): index is number => index !== undefined,
  );
  if (new Set(usedIndices).size !== usedIndices.length)
    errors.push("Duplicate mapping: each CSV column may be mapped only once");
  for (const [column, index] of Object.entries(mapping)) {
    if (index === undefined) continue;
    if (!Number.isInteger(index) || index < 0 || index >= headers.length)
      errors.push(`Invalid CSV header index for ${column}`);
  }
  if (errors.length) return empty();

  const records = parsed.records.slice(1);
  for (const record of parsed.records) {
    if (record.cells.length > PERSISTENT_IMPORT_LIMITS.maxColumns)
      errors.push(
        `Line ${record.rowNumber}: exceeds ${PERSISTENT_IMPORT_LIMITS.maxColumns} columns`,
      );
    if (
      record.cells.some((value) => value.length > PERSISTENT_IMPORT_LIMITS.maxCellChars)
    )
      errors.push(
        `Line ${record.rowNumber}: cell exceeds ${PERSISTENT_IMPORT_LIMITS.maxCellChars} characters`,
      );
    if (record.cells.length !== headers.length)
      errors.push(`Line ${record.rowNumber}: column count does not match header`);
  }
  if (errors.length) return empty();

  const rows: PersistentImportRow[] = records.map((record) => {
    const values = { ...EMPTY_PERSISTENT_VALUES };
    for (const column of PERSISTENT_IMPORT_COLUMNS) {
      const index = mapping[column];
      if (index !== undefined) values[column] = record.cells[index] ?? "";
    }
    const client_errors: string[] = [];
    for (const column of PERSISTENT_REQUIRED)
      if (values[column].trim() === "") client_errors.push(`${column}: required`);
    if (values.sku !== values.sku.trim())
      client_errors.push("sku: must not have surrounding whitespace");
    for (const [field, max] of [
      ["sku", 80],
      ["title", 180],
      ["category", 80],
      ["sell_unit_label", 120],
    ] as const) {
      if (values[field].length > max)
        client_errors.push(`${field}: exceeds ${max} characters`);
    }
    for (const field of ["units_per_sell_unit", "moq", "order_step"] as const) {
      if (values[field] !== "" && !isPositiveInt32(values[field]))
        client_errors.push(`${field}: must be a positive 32-bit integer`);
    }
    if (values.pack_amount !== "" && !isPositiveDecimal(values.pack_amount, 3, 9))
      client_errors.push(
        "pack_amount: must be a positive decimal with at most 3 decimal places",
      );
    if (values.price_amount !== "" && !isPositiveDecimal(values.price_amount, 4, 12))
      client_errors.push(
        "price_amount: must be a positive decimal with at most 4 decimal places",
      );
    if (values.currency !== "" && !/^[A-Z]{3}$/.test(values.currency))
      client_errors.push("currency: must be an explicit three-letter uppercase code");
    if (values.pack_base_unit !== "" && !PERSISTENT_UNITS.has(values.pack_base_unit))
      client_errors.push("pack_base_unit: expected kg, l or piece");
    if (values.availability !== "" && !PERSISTENT_AVAILABILITY.has(values.availability))
      client_errors.push(
        "availability: expected in_stock, low_stock, out_of_stock or on_request",
      );
    return { row_number: record.rowNumber, values, client_errors };
  });
  return { headers, mapping: mapped, rows, errors, skipped: 0 };
}
