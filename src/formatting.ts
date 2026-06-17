
import { relative } from "std/path"

import { Statement } from "./parsing.ts";


// OUTPUT FORMATTING

export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const grey = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[91m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[93m${s}\x1b[0m`;

export const WarningDisplay = (s: string) => `${yellow("WARNING")} ${s}`;
export const ErrorDisplay = (s: string) => `${red("ERROR")} ${s}`;

export const TopBar = `  ${red("╷")} `;
export const Bar = `  ${red("│")} `;
export const BottomBar = `  ${red("╵")} `;

export const indent = "        ";


export function getPathDisplay(path: string) {
	return bold(relative(Deno.cwd(), path));
}


export function stripSqlComments(sql: string): string {
	sql = sql.replace(/\/\*.*?\*\//gs, "");
	sql = sql.replace(/^\s*--.*$/gm, "");
	return sql.split("\n").map(l => l.trimEnd()).filter(l => l.trim()).join("\n");
}


/** Prints a formatted SQL error with file location and statement snippet. */
export function printSqlError(stmt: Statement, error: unknown, extra?: string[]): void {
	//console.log(`printSqlError::stmt = ${JSON.stringify(stmt)}`);
	const lines = stripSqlComments(stmt.code.trim()).split("\n");
	const err = ErrorDisplay(
		`in ${stmt.scriptPath}`) + bold(`:${stmt.lineFrom}:${stmt.lineTo}`);
	const errMsg = String(error).replace(/^Error:\s*/i, "");

	const body = [errMsg, grey(lines[0]), ...(extra ?? [])];

	console.error(
		`${TopBar}${err}\n` +
		body.slice(0, -1).map(line => `${Bar}${line}\n`).join("") +
		`${BottomBar}${body.at(-1)}`
	);
}