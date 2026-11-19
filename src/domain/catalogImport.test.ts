import { describe, expect, it } from "vitest";
import {
  CSV_TEMPLATE,
  parseCatalogCsv,
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
