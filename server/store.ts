import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
    return this.parse(relativePath, await readFile(this.resolve(relativePath), "utf8"));
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
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
