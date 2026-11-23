import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local Supabase configuration", () => {
  it("references only existing seed SQL paths", () => {
    const config = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
    const seedSection = config.match(/\[db\.seed\]([\s\S]*?)(?=\n\[|$)/)?.[1];
    expect(seedSection).toBeDefined();
    const pathsLine = seedSection?.match(/^sql_paths\s*=\s*\[(.*)\]\s*$/m)?.[1];
    expect(pathsLine).toBeDefined();
    const paths = [...(pathsLine ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(
        readFileSync(resolve(process.cwd(), "supabase", path!), "utf8"),
      ).toBeTruthy();
    }
  });
});
