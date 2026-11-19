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
