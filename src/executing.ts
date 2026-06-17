
import { basename, dirname, extname } from "std/path"
import { ensureDirSync } from "std/fs"
import { Database } from "sqlite"

import { Builds, resolvePath, CustomTypes, CustomTypesSchema, Config } from "./preparing.ts";
import { AppliedTypes, parseSql, RelationKinds, RelationStatements, Statement, StatementKind } from "./parsing.ts";
import { ErrorDisplay, getPathDisplay, grey, printSqlError, red, WarningDisplay } from "./formatting.ts";
import { exportMetadata, extractMetadata } from "./metadata.ts";
import { exportClasses, exportTypes, toPascalCase, TypesMap } from "./orm.ts";
import { registerFunctions } from "./functions.ts";


// DATABASE OPERATIONS

/** Processes all builds: creates databases and executes SQL scripts statement by statement. */
export async function createBuilds(config: Config): Promise<void> {
	let customTypes: CustomTypes = {};
	let typesMap: TypesMap = {}

	if (config.types) {
		const path = resolvePath(config.types);	

		try {
			customTypes = CustomTypesSchema.parse(JSON.parse(Deno.readTextFileSync(path)));
			console.log(`Load ${Object.keys(customTypes).length} types`);
			if (config.orm) typesMap = exportTypes(customTypes, config.orm);
		}
		catch (e) {
			if (e instanceof Deno.errors.NotFound) {
				console.error(ErrorDisplay(`Types definition file not found: ${path}`));
			}
			else if (e instanceof Deno.errors.PermissionDenied) {
				console.error(ErrorDisplay(`Permission denied: ${path}`));
			}
			else if (e instanceof SyntaxError) {
				console.error(ErrorDisplay(`Malformed JSON in types file: ${path}`));
			}
			throw e;
		}
	}

	for (const [dbPath, build] of config.databases) {
		const dbName = basename(dbPath, extname(dbPath));
		const schemaName = build.schemaName || toPascalCase(dbName);
		const dbPathDisplay = getPathDisplay(dbPath);

		console.log();
		ensureDirSync(dirname(dbPath));

		// 1 Prepare database and establish a connection:
		if (build.source) {
			const basePath = resolvePath(build.source);
			if (basePath === dbPath) {
				console.warn(WarningDisplay(`base and destination are the same path, skipping: ${dbPathDisplay}`));
				continue;
			}
			Deno.copyFileSync(basePath, dbPath);
			console.log(`Copy ${getPathDisplay(basePath)} to ${dbPathDisplay}`);
		}
		else {
			try {
				Deno.removeSync(dbPath);
				console.log(red(`Remove existing database ${dbPathDisplay}`));
			}
			catch { /* not found */ }
		}

		const db = new Database(dbPath);
		if (build.strict) db.exec("PRAGMA foreign_keys = ON;");
		if (build.functions) await registerFunctions(db, build.functions.map(resolvePath));

		// 2 Create additional metatables as needed and import column annotations:
		const relationStatements: RelationStatements = {};
		const appliedTypes: AppliedTypes = {};
		
		// 3 Execute each script instruction by instruction:
		for (const scriptStr of build.scripts) {
			await runScript(db, scriptStr, dbPathDisplay, relationStatements, customTypes, appliedTypes);
		}

		// 4 Export metadata and ORM when required:
		console.log(`Validate views on database ${dbPathDisplay}`);

		const metadata = extractMetadata(
			db, dbName, schemaName, relationStatements, customTypes, appliedTypes);
		//console.log(`metadata = ${JSON.stringify(metadata)}`);

		if (build.metadata) exportMetadata(metadata, resolvePath(build.metadata));
		if (config.orm) exportClasses(metadata, config.orm, typesMap);

		db.close();
	}
}


/** Executes an SQL script statement by statement, injecting constraints and logging feedback. */
async function runScript(
	db: Database,
	scriptStr: string,
	dbPathDisplay: string,
	relationStatements: RelationStatements,
	customTypes: CustomTypes = {},
	appliedTypes: AppliedTypes = {}
): Promise<undefined> {
	const scriptPath = resolvePath(scriptStr);
	const scriptPathDisplay = getPathDisplay(scriptPath);

	let sql: string;

	try {
		sql = Deno.readTextFileSync(scriptPath);
	}
	catch {
		console.warn(WarningDisplay(`Script not found: ${scriptPathDisplay}`));
		return;
	}

	console.log(`Execute ${scriptPathDisplay} on ${dbPathDisplay}`);

	for (let stmt of parseSql(scriptPathDisplay, sql, customTypes, appliedTypes) ) {
		try {
			db.exec(stmt.code);
			stmt.succeeded = true;
			if (stmt.feedback) console.log(`    ${stmt.feedback}`);	
		}
		catch (e) {
			printSqlError(stmt, e);
			stmt.succeeded = false;
		}
		finally {
			if (RelationKinds.has(stmt.kind) && stmt.id) relationStatements[stmt.id] = stmt;
				// Saves table and view creation details for future error handling.
		}
	}
}


// READING JSON INSTEAD OF SQL

interface TargetTable {
	name: string;
	key: string[];
	data: string[];
}


/** Imports data from a JSON file into the database, supporting keyed objects and metadata headers. */
function insertFromJson(db: Database, jsonPath: string, targetTable: TargetTable | string | null = null) {
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
