import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(
    private readonly root: string,
    private readonly exampleRoot = root,
  ) {}

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

  private resolveExample(relativePath: string) {
    return this.resolveWithin(this.exampleRoot, relativePath, "example data");
  }

  async ensure(relativePath: string, examplePath: string) {
    const target = this.resolve(relativePath);
    try {
      await stat(target);
      return;
    } catch {
      await mkdir(path.dirname(target), { recursive: true });
      const example = await readFile(this.resolveExample(examplePath), "utf8");
      await writeFile(target, example, { encoding: "utf8", flag: "wx" }).catch(
        () => undefined,
      );
    }
  }

  async read<T>(relativePath: string): Promise<T> {
    return JSON.parse(await readFile(this.resolve(relativePath), "utf8")) as T;
  }

  async write<T>(relativePath: string, value: T) {
    const target = this.resolve(relativePath);
    const temporary = `${target}.${process.pid}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }
}
