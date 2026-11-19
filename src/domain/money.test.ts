import { describe, expect, it } from "vitest";
import {
  addMoney,
  compareMoney,
  formatMoney,
  money,
  multiplyMoney,
  subMoney,
  sumMoney,
  zero,
} from "@/domain/money";

describe("money", () => {
  it("stores integer minor units and rejects floats", () => {
    expect(money(1234).amount).toBe(1234);
    expect(() => money(12.5)).toThrow(/integer/i);
  });

  it("adds and subtracts without floating point drift", () => {
    // 0.1 + 0.2 style drift is impossible with integers.
    const a = money(10);
    const b = money(20);
    expect(addMoney(a, b).amount).toBe(30);
    expect(subMoney(b, a).amount).toBe(10);
    expect(sumMoney([a, b, money(500)]).amount).toBe(530);
  });

  it("multiplies by an integer quantity only", () => {
    expect(multiplyMoney(money(1500), 3).amount).toBe(4500);
    expect(() => multiplyMoney(money(1500), 2.5)).toThrow(/integer/i);
  });

  it("refuses to mix currencies", () => {
    const kzt = money(100, "KZT");
    // Only KZT exists today, so equality is the honest check available.
    expect(compareMoney(kzt, money(100, "KZT"))).toBe(0);
    expect(compareMoney(kzt, money(200, "KZT"))).toBe(-1);
  });

  it("treats zero and negative distinctly", () => {
    expect(zero().amount).toBe(0);
    expect(money(-5).amount).toBe(-5);
  });

  it("formats as a rounded KZT amount", () => {
    expect(formatMoney(money(1_500_000))).toContain("1");
  });
});
