
import type { Database } from "sqlite";

import { ErrorDisplay, getPathDisplay, grey } from "./formatting.ts";


// READING JSON INSTEAD OF SQL

interface TargetTable {
	name: string;
	key: string[];
	data: string[];
}


/** Imports data from a JSON file into the database, supporting keyed objects and metadata headers. */
export function insertFromJson(db: Database, jsonPath: string, targetTable: TargetTable | string | null = null) {
	let fileData: any;
	const pathDisplay = getPathDisplay(jsonPath);

	try {
		fileData = JSON.parse(Deno.readTextFileSync(jsonPath));
	}
	catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.log("───");
		console.error(ErrorDisplay(`Failed to parse ${pathDisplay}: ${msg}`));
		Deno.exit(1);
	}

	if (Array.isArray(fileData)) {
		if (!targetTable) {
			console.error(ErrorDisplay(
				`${pathDisplay} is JSON array, but no specified target table`));
		}
		else {
			const tableName = typeof targetTable === "string" ? targetTable : targetTable.name;
			console.log(
				`Import ${fileData.length} records into ${tableName}`);
			insertRows(db, tableName, fileData);
		}
	}
	else if (typeof fileData === "object" && fileData !== null) {
		const isTargetObj = targetTable && typeof targetTable === "object";
		
		if (isTargetObj || fileData.table) {
			const { table, ...records } = isTargetObj ? { table: targetTable, ...fileData } : fileData;
			const { name, key, data } = table;
		
			if (!name || !Array.isArray(key) || !Array.isArray(data)) {
				console.error(ErrorDisplay(
					`Invalid table metadata in ${pathDisplay} or argument; 'name', 'key' and 'data' required.`));
				return;
			}
		
			const columns = [...key, ...data];
			const rows: any[][] = [];
		
			for (const [k, val] of Object.entries(records)) {
				const keyParts = k.split(",");
				const attrParts = Array.isArray(val) ? val : [val];
				rows.push([...keyParts, ...attrParts]);
			}
		
			console.log(
				`Import ${rows.length} records into ${name}`);
			insertRows(db, name, rows, columns);
		}
		else {
			for (const [tableName, rows] of Object.entries(fileData)) {
				if (Array.isArray(rows)) {
					console.log(
						`Import ${rows.length} records into ${tableName}`);
					insertRows(db, tableName, rows);
				}
			}
		}
	}
}


/** Helper to insert mixed arrays, objects, or scalars into a table. */
function insertRows(db: Database, tableName: string, rows: any[], columns?: string[]) {
	if (rows.length === 0) return;

	const statementCache = new Map<string, any>();

	for (const row of rows) {
		let sql: string;
		let values: any[];

		if (columns && Array.isArray(row)) {
			// Case A1: Array + Explicit Column Names (Metadata Header Case)
			const colList = columns.join(", ");
			const placeholders = new Array(columns.length).fill("?").join(", ");
			sql = `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`;
			values = row;
		}
		else if (Array.isArray(row)) {
			// Case A2: Positional mapping
			const placeholders = new Array(row.length).fill("?").join(", ");
			sql = `INSERT INTO ${tableName} VALUES (${placeholders})`;
			values = row;
		}
		else if (typeof row === "object" && row !== null) {
			// Case B: Named keys
			const keys = Object.keys(row);
			const colList = keys.join(", ");
			const placeholders = new Array(keys.length).fill("?").join(", ");
			sql = `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`;
			values = keys.map(k => row[k]);
		}
		else {
			// Case C: Scalar
			sql = `INSERT INTO ${tableName} VALUES (?)`;
			values = [row];
		}

		try {
			if (!statementCache.has(sql)) {
				statementCache.set(sql, db.prepare(sql));
			}
			
			const stmt = statementCache.get(sql);
			const params = values.map(v => 
				(typeof v === "object" && v !== null) ? JSON.stringify(v) : v
			);

			stmt.run(...params);
		}
		catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			const snippet = JSON.stringify(row).substring(0, 100);
			console.log("───");
			console.error(ErrorDisplay(msg));
			console.log(grey(`${snippet}${snippet.length >= 100 ? "..." : ""}`));
			console.log();
		}
	}
}
