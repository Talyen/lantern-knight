import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

type Project = NonNullable<ReturnType<ReturnType<API['updateSnapshot']>['getProject']>>;
export function inspectImports(
  project: Project,
  source: ts.SourceFile,
  visit: (edge: { name?: string; resolved?: string; line: number; typeOnly?: boolean }) => void,
) {
  const inspect = (node: ts.Node) => {
    let specifier: ts.Node | undefined;
    const typeOnly =
      ts.isImportTypeNode(node) ||
      (ts.isImportDeclaration(node) &&
        node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) ||
      (ts.isExportDeclaration(node) && node.isTypeOnly);
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      specifier = node.moduleSpecifier;
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      specifier = node.moduleReference.expression;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      specifier = node.argument.literal;
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      specifier = node.arguments[0];
    if (specifier) {
      const line = source.text.slice(0, node.getStart(source)).split('\n').length;
      if (!ts.isStringLiteral(specifier) && !ts.isNoSubstitutionTemplateLiteral(specifier))
        visit({ line });
      else {
        const declaration = project.checker
          .getSymbolAtLocation(specifier)
          ?.declarations.find((node) => node.kind === ts.SyntaxKind.SourceFile)
          ?.resolve(project);
        visit({
          name: specifier.text,
          resolved: declaration && ts.isSourceFile(declaration) ? declaration.fileName : undefined,
          line,
          typeOnly,
        });
      }
    }
    node.forEachChild(inspect);
  };
  inspect(source);
}
