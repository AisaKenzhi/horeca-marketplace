import { describe, expect, it } from "vitest";
import {
  CSV_TEMPLATE,
  parseCatalogCsv,
  parseMappedCatalogCsv,
  PERSISTENT_IMPORT_LIMITS,
  resolveImportRows,
  sanitizeCell,
  IMPORT_LIMITS,
} from "@/domain/catalogImport";

describe("csv catalog import", () => {
  it("parses a valid template row as added", () => {
    const result = parseCatalogCsv(CSV_TEMPLATE);
    expect(result.summary.added).toBe(1);
    expect(result.summary.errors).toBe(0);
    expect(result.rows[0]!.sku).toBe("DEMO-SKU-1");
  });

  it("reports the row number and field for a bad price", () => {
    const csv = [
      "sku,title,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,price_per_sell_unit,moq,order_step",
      "X1,Товар,мешок,1,5,kg,not-a-number,1,1",
    ].join("\n");
    const result = parseCatalogCsv(csv);
    expect(result.summary.errors).toBe(1);
    const row = result.rows[0]!;
    expect(row.rowNumber).toBe(2);
    expect(row.errors.join(" ")).toContain("price_per_sell_unit");
  });

  it("rejects a fractional price instead of rounding silently", () => {
    const csv = [
      "sku,title,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,price_per_sell_unit,moq,order_step",
      "X1,Товар,мешок,1,5,kg,3200.50,1,1",
    ].join("\n");
    const result = parseCatalogCsv(csv);
    expect(result.summary.errors).toBe(1);
    expect(result.rows[0]!.errors.join(" ")).toMatch(/целым/i);
  });

  it("rejects an unknown base unit", () => {
    const csv = [
      "sku,title,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,price_per_sell_unit,moq,order_step",
      "X1,Товар,мешок,1,5,pound,3200,1,1",
    ].join("\n");
    const result = parseCatalogCsv(csv);
    expect(result.rows[0]!.errors.join(" ")).toContain("pack_base_unit");
  });

  it("flags a missing required column against the header", () => {
    const csv = ["sku,title", "X1,Товар"].join("\n");
    const result = parseCatalogCsv(csv);
    expect(result.summary.errors).toBe(1);
    expect(result.rows[0]!.rowNumber).toBe(1);
    expect(result.rows[0]!.errors.join(" ")).toMatch(/Отсутствуют/);
  });

  it("treats an existing SKU as an update, not an error", () => {
    const result = parseCatalogCsv(CSV_TEMPLATE, { existingSkus: ["DEMO-SKU-1"] });
    expect(result.summary.updated).toBe(1);
    expect(result.summary.added).toBe(0);
  });

  it("marks a duplicate SKU within the file as an update", () => {
    const row = "DUP,Товар,мешок,1,5,kg,3200,1,1";
    const csv = [
      "sku,title,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,price_per_sell_unit,moq,order_step",
      row,
      row,
    ].join("\n");
    const result = parseCatalogCsv(csv);
    expect(result.summary.added).toBe(1);
    expect(result.summary.updated).toBe(1);
  });

  it("neutralises formula-like cells so they cannot execute later", () => {
    expect(sanitizeCell("=1+1")).toBe("'=1+1");
    expect(sanitizeCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(sanitizeCell("normal")).toBe("normal");
  });

  it("honours the row limit", () => {
    const header =
      "sku,title,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,price_per_sell_unit,moq,order_step";
    const rows = Array.from(
      { length: IMPORT_LIMITS.maxRows + 50 },
      (_, i) => `S${i},T,мешок,1,5,kg,100,1,1`,
    );
    const result = parseCatalogCsv([header, ...rows].join("\n"));
    expect(result.rows.length).toBe(IMPORT_LIMITS.maxRows);
    expect(result.summary.skipped).toBe(50);
  });

  it("handles quoted fields with commas", () => {
    const csv = [
      "sku,title,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,price_per_sell_unit,moq,order_step",
      'Q1,"Товар, большой",мешок,1,5,kg,3200,1,1',
    ].join("\n");
    const result = parseCatalogCsv(csv);
    expect(result.summary.added).toBe(1);
    expect(result.rows[0]!.values.title).toBe("Товар, большой");
  });
});

describe("resolveImportRows: unchanged rows are not queued for writing", () => {
  const CSV =
    "sku,title,category,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,price_per_sell_unit,moq,order_step,availability\n" +
    "SAME-1,Товар,Бакалея,мешок 5 кг,1,5,kg,3200,2,2,in_stock\n" +
    "NEW-1,Новый,Бакалея,мешок 1 кг,1,1,kg,1500,1,1,in_stock";

  const existing = [
    {
      sku: "SAME-1",
      title: "Товар",
      pricePerSellUnit: 3200,
      moq: 2,
      orderStep: 2,
    },
  ];

  it("excludes unchanged rows from `resolved` but keeps them in the preview", () => {
    const parsed = parseCatalogCsv(CSV, { existingSkus: existing.map((e) => e.sku) });
    const resolved = resolveImportRows(parsed, existing);
    expect(resolved.summary.unchanged).toBe(1);
    expect(resolved.summary.added).toBe(1);
    // Only the genuinely new row is queued for a write.
    expect(resolved.resolved.map((r) => r.sku)).toEqual(["NEW-1"]);
    // The preview still lists both rows for the user.
    expect(resolved.rows.map((r) => r.status)).toEqual(["unchanged", "added"]);
  });

  it("still queues a genuinely changed row", () => {
    const parsed = parseCatalogCsv(CSV, { existingSkus: existing.map((e) => e.sku) });
    const resolved = resolveImportRows(parsed, [
      { ...existing[0]!, pricePerSellUnit: 9999 },
    ]);
    expect(resolved.summary.updated).toBe(1);
    expect(resolved.resolved.map((r) => r.sku)).toEqual(["SAME-1", "NEW-1"]);
  });
});

describe("persistent mapped supplier catalog import", () => {
  const headers = [
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
  ];
  const mapping = Object.fromEntries(
    headers.map((header, index) => [header, index]),
  ) as Record<string, number>;
  const valid = [
    "SKU-1",
    "Plain",
    "Dry",
    "bag",
    "1",
    "0.125",
    "kg",
    "12.3456",
    "KZT",
    "2",
    "1",
    "",
  ];
  const csv = (rows: readonly (readonly string[])[]): string =>
    [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

  it("returns raw formula-like text without sanitising or interpreting it", () => {
    const result = parseMappedCatalogCsv(
      csv([[...valid.slice(0, 1), "=1+1", ...valid.slice(2)]]),
      mapping,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.values.title).toBe("=1+1");
    expect(result.rows[0]?.client_errors).toEqual([]);
    expect(result.rows[0]?.row_number).toBe(2);
  });

  it("supports BOM, CRLF, escaped quotes, commas, and newlines inside quotes", () => {
    const row = [...valid];
    row[1] = "\"Large, ''special'' item\"";
    const text = `\uFEFF${headers.join(",")}\r\n${valid[0]},"Line one\r\nLine ""two"", comma",${valid.slice(2).join(",")}\r\n`;
    const result = parseMappedCatalogCsv(text, mapping);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.values.title).toBe('Line one\nLine "two", comma');
  });

  it("blocks duplicate mappings and missing required mappings", () => {
    const duplicate = { ...mapping, title: 0 };
    expect(parseMappedCatalogCsv(csv([valid]), duplicate).errors.join(" ")).toMatch(
      /Duplicate mapping/,
    );
    const missing = { ...mapping };
    delete missing.currency;
    expect(parseMappedCatalogCsv(csv([valid]), missing).errors.join(" ")).toMatch(
      /currency/,
    );
  });

  it("validates explicit currencies, decimals, units, bounds, text lengths, and enum values", () => {
    const row = [...valid];
    row[4] = "2147483648";
    row[5] = "1.0001";
    row[6] = "lb";
    row[7] = "1.12345";
    row[8] = "kzt";
    row[9] = "0";
    row[11] = "available";
    const result = parseMappedCatalogCsv(csv([row]), mapping);
    expect(result.rows[0]?.client_errors).toHaveLength(7);
    expect(result.rows[0]?.values.currency).toBe("kzt");
  });

  it("accepts bounded leading-zero integers but flags whitespace-padded SKUs", () => {
    const row = [...valid];
    row[4] = "0001";
    row[9] = "0002";
    row[10] = "0001";
    expect(parseMappedCatalogCsv(csv([row]), mapping).rows[0]?.client_errors).toEqual([]);

    row[0] = " SKU-1 ";
    expect(parseMappedCatalogCsv(csv([row]), mapping).rows[0]?.client_errors).toContain(
      "sku: must not have surrounding whitespace",
    );
  });

  it("rejects UTF-8 byte overflow and stops parsing after the maximum row count", () => {
    const multibyteText = "界".repeat(PERSISTENT_IMPORT_LIMITS.maxBytes / 2);
    expect(parseMappedCatalogCsv(multibyteText, mapping).errors.join(" ")).toMatch(
      /bytes/,
    );

    const tooManyRows = [
      headers.join(","),
      ...Array.from({ length: PERSISTENT_IMPORT_LIMITS.maxRows + 1 }, () =>
        valid.join(","),
      ),
    ].join("\n");
    expect(parseMappedCatalogCsv(tooManyRows, mapping).errors.join(" ")).toMatch(
      /data rows/,
    );
  });

  it("uses blank availability as unknown and blocks excess size, rows, columns, cells, and malformed quotes", () => {
    expect(parseMappedCatalogCsv(csv([valid]), mapping).rows[0]?.client_errors).toEqual(
      [],
    );
    expect(parseMappedCatalogCsv(csv([valid, valid]), mapping).rows).toHaveLength(2);
    expect(
      parseMappedCatalogCsv(
        `${headers.join(",")}\n${valid.join(",")}"oops`,
        mapping,
      ).errors.join(" "),
    ).toMatch(/Malformed/);
    expect(
      parseMappedCatalogCsv(
        "x".repeat(PERSISTENT_IMPORT_LIMITS.maxBytes + 1),
        mapping,
      ).errors.join(" "),
    ).toMatch(/bytes/);
    const longCell = [...valid];
    longCell[1] = "x".repeat(PERSISTENT_IMPORT_LIMITS.maxCellChars + 1);
    expect(parseMappedCatalogCsv(csv([longCell]), mapping).errors.join(" ")).toMatch(
      /characters/,
    );
  });
});
