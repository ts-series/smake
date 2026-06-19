
import { ColumnTypes, generateConstraints } from "./constraints.ts";
import { indent, WarningDisplay, yellow } from "./formatting.ts";
import { AffinityValues, CustomTypes, isEmpty } from "./preparing.ts";


//

export const enum StatementKind {
	Unknown = 0,
	Comment,
	CreateTable, CreateView, CreateIndex, CreateTrigger,
	DropTable, DropView, DropIndex, DropTrigger,
	Insert, Replace, Update, Delete, AlterTable,
	Select, Pragma,
	Begin, Commit, Rollback,
	Explain, Attach, Detach, Vacuum, Reindex,
	Other
}

export const RelationKinds = new Set([StatementKind.CreateTable, StatementKind.CreateView]);


const Rules: { pattern: RegExp; kind: StatementKind }[] = [
	{ pattern: /^--\s+(?<id>.*)$/i, kind: StatementKind.Comment },
	{ pattern: /^create\s+(?:temp|temporary)?\s*table\s+(?:if\s+not\s+exists\s+)?(?<id>\w+)/i, kind: StatementKind.CreateTable },
	{ pattern: /^create\s+(?:temp|temporary)?\s*view\s+(?:if\s+not\s+exists\s+)?(?<id>\w+)/i, kind: StatementKind.CreateView },
	{ pattern: /^create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(?<id>\w+)/i, kind: StatementKind.CreateIndex },
	{ pattern: /^create\s+trigger\s+(?:if\s+not\s+exists\s+)?(?<id>\w+)/i, kind: StatementKind.CreateTrigger },
	{ pattern: /^drop\s+table\s+(?:if\s+exists\s+)?(?<id>\w+)/i, kind: StatementKind.DropTable },
	{ pattern: /^drop\s+view\s+(?:if\s+exists\s+)?(?<id>\w+)/i, kind: StatementKind.DropView },
	{ pattern: /^drop\s+index\s+(?:if\s+exists\s+)?(?<id>\w+)/i, kind: StatementKind.DropIndex },
	{ pattern: /^drop\s+trigger\s+(?:if\s+exists\s+)?(?<id>\w+)/i, kind: StatementKind.DropTrigger },
	{ pattern: /^insert\s+(?:or\s+\w+)?\s*into\s+(?<id>\w+)/i, kind: StatementKind.Insert },
	{ pattern: /^replace\s+into\s+(?<id>\w+)/i, kind: StatementKind.Replace },
	{ pattern: /^update\s+(?<id>\w+)/i, kind: StatementKind.Update },
	{ pattern: /^delete\s+from\s+(?<id>\w+)/i, kind: StatementKind.Delete },
	{ pattern: /^alter\s+table\s+(?<id>\w+)/i, kind: StatementKind.AlterTable },
	{ pattern: /^select\b/i, kind: StatementKind.Select },
	{ pattern: /^pragma\s+(?<id>\w+)/i, kind: StatementKind.Pragma },
	{ pattern: /^begin(?:\s+transaction)?/i, kind: StatementKind.Begin },
	{ pattern: /^commit/i, kind: StatementKind.Commit },
	{ pattern: /^rollback/i, kind: StatementKind.Rollback },
	{ pattern: /^explain\s+(?:query\s+plan\s+)?(?<id>\w+)/i, kind: StatementKind.Explain },
	{ pattern: /^attach\s+database\s+['"]?(?<id>[^'"]+)['"]?/i, kind: StatementKind.Attach },
	{ pattern: /^detach\s+database\s+(?<id>\w+)/i, kind: StatementKind.Detach },
	{ pattern: /^vacuum(?:\s+(?<id>\w+))?/i, kind: StatementKind.Vacuum },
	{ pattern: /^reindex(?:\s+(?<id>\w+))?/i, kind: StatementKind.Reindex },
];


//

interface Excerpt {
	kind: StatementKind;
	id: string | null;
	feedback: string | null;
}


/** Analyzes the beginning of an SQL string and extracts statement kind, id and text. */
function excerpt(sql: string): Excerpt {
	const trimmed = sql.trim();
	for (const { pattern, kind } of Rules) {
		const match = trimmed.match(pattern);
		if (match) {
			return { kind, id: match.groups?.id ?? null, feedback: match[0] };
		}
	}
	return { kind: StatementKind.Unknown, id: null, feedback: null };
}


//

export interface Statement {
	kind: StatementKind;
	id: string | null;
	scriptPath: string;
	lineFrom: number;
	lineTo: number;
	code: string;
	succeeded: boolean | null;
	feedback: string | null;
}

const enum Context { Blank, Statement, Substatement }

const enum Subcontext { BlockComment = -1, Code, SingleQuotedString, DoubleQuotedString }

/** Maps table- and view names to their statement details. */
export type RelationStatements = Record<string, Statement>;

/** Maps table names to their columns with custom types. */
export type AppliedTypes = Record<string, ColumnTypes>;


/** Handwritten minimal SQLite parser separating statements while capturing line numbers. Returns a tuple containing the list of statements and a map of custom type specifications. */
export function parseSql(
	scriptPath: string,
	sql: string,
	customTypes: CustomTypes,
	appliedTypes: AppliedTypes
): Statement[] {
		// This lightweight parser splits SQL by semicolons, treating BEGIN...END as sub-statements, exclusively tracking nested CASE...END to prevent premature termination.
	const statements: Statement[] = [];
	const len = sql.length;
	const isWhitespace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

	let startIdx = 0, index = 0, startLine = 0, line = 0;
	let context = Context.Blank;
	let subcontext = Subcontext.Code;
	let parenDepth = 0;
	let subDepth = 0;
	let caseDepth = 0;

	while (index < len) {
		const char = sql[index];

		if (char === "\n") {
			line++;
		}
		else if (subcontext === Subcontext.BlockComment) {
			if (char === "*" && index + 1 < len && sql[index + 1] === "/") {
				subcontext = Subcontext.Code;
				index++;
			}
		}
		else if (subcontext === Subcontext.SingleQuotedString) {
			if (char === "'") subcontext = Subcontext.Code;
		}
		else if (subcontext === Subcontext.DoubleQuotedString) {
			if (char === '"') subcontext = Subcontext.Code;
		}
		else {
			switch (char) {
				case "-":
					if (index + 1 < len && sql[index + 1] === "-") {
						const next = sql.indexOf("\n", index);
						if (next === -1) {
							index = len;
						}
						else {
							index = next;
							line++;
							if (context === Context.Blank) {
								startIdx = index;
								startLine = line;
							}
						}
					}
					break;
				case "/":
					if (index + 1 < len && sql[index + 1] === "*") {
						subcontext = Subcontext.BlockComment;
						index++;
					}
					break;
				case "'": subcontext = Subcontext.SingleQuotedString; break;
				case '"': subcontext = Subcontext.DoubleQuotedString; break;
				case "(":
					if (context !== Context.Blank) parenDepth++;
					break;
				case ")":
					if (context !== Context.Blank) parenDepth = Math.max(0, parenDepth - 1);
					break;
				case ";":
					if (parenDepth === 0) {
						let isEnd = false;
						
						if (context === Context.Substatement) {
							let checkIdx = index - 1;
							while (checkIdx >= startIdx && isWhitespace(sql[checkIdx])) {
								checkIdx--;
							}
							
							if (checkIdx - 2 >= startIdx &&
							    sql.slice(checkIdx - 2, checkIdx + 1).toLowerCase() === "end"
							) {
								if (caseDepth > 0) {
									caseDepth--;
										// Closes only one CASE.
								}
								else {
									subDepth = Math.max(0, subDepth - 1);
									if (subDepth === 0) {
										isEnd = true;
											// Closes the entire trigger block.
									}
								}
							}
						}
						
						if (context === Context.Statement || isEnd) {
							let lastCharIdx = index - 1;
							while (lastCharIdx >= startIdx && isWhitespace(sql[lastCharIdx])) lastCharIdx--;

							const code = sql.slice(startIdx, lastCharIdx + 1) + ";";

							let stmt: Statement = {
								...excerpt(code),
								scriptPath,
								lineFrom: startLine + 1,
								lineTo: line + 1,
								code,
								succeeded: null
							};

							let colTypes: ColumnTypes;
							
							if (stmt.kind === StatementKind.CreateTable && stmt.id && !isEmpty(customTypes)) {
								[stmt, colTypes] = injectConstraints(stmt, customTypes);
								if (!isEmpty(colTypes)) appliedTypes[stmt.id!] = colTypes;
							}

							statements.push(stmt);
					
							startIdx = index + 1;
							startLine = line;
							context = Context.Blank;
							caseDepth = 0;
								// Reset for the next statement
						}
					}
					break;
				default:
					if (context === Context.Blank && !isWhitespace(char)) {
						context = Context.Statement;
						startIdx = index;
						startLine = line;
					}
					
					// CASE and END Detection within Substatements:
					if (context === Context.Substatement) {
						if ((char === "C" || char === "c") && (index === 0 || isWhitespace(sql[index - 1])) && /^case\b/i.test(sql.slice(index))) {
							caseDepth++;
							index += 3;
						}
						else if ((char === "E" || char === "e") &&
							(index === 0 || isWhitespace(sql[index - 1])) && /^end\b/i.test(sql.slice(index))
						) {
							// Check whether a semicolon follows immediately after END (or after whitespace).
							let nextIdx = index + 3;
							while (nextIdx < len && isWhitespace(sql[nextIdx])) {
								nextIdx++;
							}
							// If NO semicolon follows, it is an inline END (e.g., in SELECT CASE ... END).
							if (nextIdx < len && sql[nextIdx] !== ";") {
								if (caseDepth > 0) {
									caseDepth--;
								}
								index += 2;
							}
						}
					}
					
					if ((char === "B" || char === "b") &&
						(index === 0 || isWhitespace(sql[index - 1])) && /^begin\s/i.test(sql.slice(index))
					) {
						context = Context.Substatement;
						subDepth++;
						index += 4;
					}
					break;
			}
		}

		index++;
	}

	return statements;
}


// COLUMN SPECIFICATION

/** Injects generated constraints into a CREATE TABLE statement. */
function injectConstraints(stmt: Statement, customTypes: CustomTypes): [Statement, ColumnTypes] {
	const [modStmt, colTypes] = resolveCustomTypes(stmt, customTypes);

	const constraints = generateConstraints(modStmt.id!, colTypes, customTypes);

	if (constraints.length !== 0) {
		const lastParenIdx = modStmt.code.lastIndexOf(")");
		
		if (lastParenIdx !== -1) {
			const head = modStmt.code.slice(0, lastParenIdx);
			const tail = modStmt.code.slice(lastParenIdx);
	
			const additionalCode = constraints.map(c => `\t${c}`).join(",\n");
			
			const typedColumns = Object.keys(colTypes);

			const additionalFeedback = typedColumns.length > 0
				? "\n" + typedColumns.map(colName => `${indent}+ constraint for column ${colName}`).join("\n")
				: "";
	
			return [{
				...modStmt,
				code: `${head.trimEnd()},\n${additionalCode}\n${tail}`,
				feedback: `${modStmt.feedback}${additionalFeedback}`
			}, colTypes];
		} 
		else {
			console.warn();
			console.warn(WarningDisplay(`No ')' found in table '${modStmt.id}'; skip constraint injection`));
		}
	}

	return [modStmt, colTypes];
}


/** Replaces custom types with their SQLite affinities in the SQL code while mapping column names to those types. */
function resolveCustomTypes(stmt: Statement, customTypes: CustomTypes): [Statement, ColumnTypes] {
	const colTypes: ColumnTypes = {};
	const customTypeNames = Object.keys(customTypes);
	const Keywords = ["CONSTRAINT", "KEY", "REFERENCES", "UNIQUE", "CHECK", "DEFAULT"];

	let sql = stmt.code
		.replace(/--.*$/gm, "") 
		.replace(/\/\*[\s\S]*?\*\//g, "");

	const firstParen = sql.indexOf("(");
	const lastParen = sql.lastIndexOf(")");

	if (firstParen !== -1 && lastParen !== -1) {
		const head = sql.slice(0, firstParen + 1);
		const body = sql.slice(firstParen + 1, lastParen);
		const tail = sql.slice(lastParen);

		const typePattern = /(?<=^|,)\s*(?<name>\w+)\s+(?<typeName>\w+)\b/g;

		const newBody = body.replace(typePattern, (match, colName, typeName) => {		
			if (Keywords.includes(colName.toUpperCase()) || AffinityValues.includes(typeName.toUpperCase())) {
				return match; 
			}
			else if (!customTypeNames.includes(typeName)) {
				const msg = yellow(`! unknown custom type »${typeName}« for column »${colName}«`);
				stmt.feedback = `${stmt.feedback}\n${indent}${msg}\n${indent}→ set BLOB as affinity`;
				return match.replace(typeName, "BLOB");
			}
			else {  
				colTypes[colName] = typeName;
				return match.replace(typeName, customTypes[typeName].affinity);
			}
		});

		sql = head + newBody + tail;
	}

	return [{ ...stmt, code: sql }, colTypes];
}