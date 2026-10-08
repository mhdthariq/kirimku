import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const sourceRoot = resolve("src");
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function imports(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const modules: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      modules.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) modules.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return modules;
}

describe("architecture dependency boundaries", () => {
  for (const layer of ["domain", "application"] as const) {
    for (const path of files(resolve(sourceRoot, layer))) {
      it(`${relative(sourceRoot, path)} only depends inward`, () => {
        const allowed = layer === "domain" ? ["domain", "shared"] : ["application", "domain", "shared"];
        for (const specifier of imports(path)) {
          const target = specifier.startsWith("@/") ? resolve(sourceRoot, specifier.slice(2)) : specifier.startsWith(".") ? resolve(path, "..", specifier) : null;
          expect(target, `External dependency ${specifier} is forbidden in ${layer}`).not.toBeNull();
          const targetLayer = relative(sourceRoot, target!).split("/")[0];
          expect(allowed, `${relative(sourceRoot, path)} imports ${specifier}`).toContain(targetLayer);
        }
      });
    }
  }
  it("infrastructure does not depend on composition or UI", () => {
    for (const path of files(resolve(sourceRoot, "infrastructure"))) {
      for (const specifier of imports(path)) {
        expect(specifier, relative(sourceRoot, path)).not.toMatch(/^@\/(composition|components|hooks|app|presentation)\//);
      }
    }
  });
});
