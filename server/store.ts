import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  currentDashboardAppearance,
  normaliseDashboardAppearance,
  withDashboardAppearance,
} from "./dashboardAppearance.js";

export class JsonStore {
  constructor(private readonly root: string) {}

  private resolveWithin(root: string, relativePath: string, label: string) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, relativePath);
    const relative = path.relative(resolvedRoot, resolved);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Invalid ${label} path.`);
    }
    return resolved;
  }

  private resolve(relativePath: string) {
    return this.resolveWithin(this.root, relativePath, "data");
  }

  private parse<T>(relativePath: string, content: string): T {
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new Error(
        `Invalid JSON in private data file "${relativePath}". The file was not modified.`,
      );
    }
  }

  private async prepareValue<T>(relativePath: string, value: T): Promise<T> {
    if (
      relativePath !== "settings.json" ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return value;
    }
    const record = value as Record<string, unknown>;
    let appearance = currentDashboardAppearance() ?? record.appearance;
    if (appearance === undefined) {
      try {
        const existing = this.parse<Record<string, unknown>>(
          relativePath,
          await readFile(this.resolve(relativePath), "utf8"),
        );
        appearance = existing.appearance;
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
    }
    return {
      ...record,
      appearance: normaliseDashboardAppearance(appearance),
    } as T;
  }

  async ensure<T>(relativePath: string, initialValue: T) {
    const target = this.resolve(relativePath);
    try {
      this.parse(relativePath, await readFile(target, "utf8"));
      return false;
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }

    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, `${JSON.stringify(initialValue, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        this.parse(relativePath, await readFile(target, "utf8"));
        return false;
      }
      throw error;
    }
  }

  async read<T>(relativePath: string): Promise<T> {
    const value = this.parse<T>(
      relativePath,
      await readFile(this.resolve(relativePath), "utf8"),
    );
    if (
      relativePath === "settings.json" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      return withDashboardAppearance(
        value as Record<string, unknown>,
      ) as T;
    }
    return value;
  }

  async readOptional<T>(relativePath: string): Promise<T | null> {
    try {
      return await this.read<T>(relativePath);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async write<T>(relativePath: string, value: T) {
    const target = this.resolve(relativePath);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const prepared = await this.prepareValue(relativePath, value);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(prepared, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async writeBatch(entries: Array<{ relativePath: string; value: unknown }>) {
    const staged = await Promise.all(
      entries.map(async ({ relativePath, value }) => {
        const target = this.resolve(relativePath);
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        const prepared = await this.prepareValue(relativePath, value);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(temporary, `${JSON.stringify(prepared, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
        return {
          relativePath,
          target,
          temporary,
          original: await readFile(target, "utf8"),
        };
      }),
    );
    const committed: typeof staged = [];

    try {
      for (const entry of staged) {
        await rename(entry.temporary, entry.target);
        committed.push(entry);
      }
    } catch (error) {
      for (const entry of committed.reverse()) {
        const rollback = `${entry.target}.${process.pid}.${randomUUID()}.rollback`;
        await writeFile(rollback, entry.original, {
          encoding: "utf8",
          flag: "wx",
        });
        await rename(rollback, entry.target).catch(async () => {
          await rm(rollback, { force: true }).catch(() => undefined);
        });
      }
      throw error;
    } finally {
      await Promise.all(
        staged.map((entry) =>
          rm(entry.temporary, { force: true }).catch(() => undefined),
        ),
      );
    }
  }
}
