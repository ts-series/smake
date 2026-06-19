
import { basename, dirname, extname, join } from "std/path"
import { ensureDirSync } from "std/fs"
import { Database } from "sqlite"

import { Builds, resolvePath, CustomTypes, CustomTypesSchema, Config } from "./preparing.ts";
import { AppliedTypes, parseSql, RelationKinds, RelationStatements, Statement, StatementKind } from "./parsing.ts";
import { bold, ErrorDisplay, getPathDisplay, grey, printSqlError, red, WarningDisplay } from "./formatting.ts";
import { exportMetadata, extractMetadata } from "./metadata.ts";
import { exportClasses, exportTypes, toPascalCase, TypesMap } from "./orm.ts";
import { registerFunctions } from "./functions.ts";


// BUILD COMMAND

/** Processes all builds: creates databases and executes SQL scripts statement by statement. */
export async function createBuilds(
	config: Config,
	release: boolean = false,
	names?: string[]
): Promise<void> {
	let customTypes: CustomTypes = {};
	let typesMap: TypesMap = {}

	if (config.types) {
		const path = resolvePath(config.types);	

		try {
			customTypes = CustomTypesSchema.parse(JSON.parse(Deno.readTextFileSync(path)));
			console.log(`Load ${Object.keys(customTypes).length} types`);
			if (!release && config.orm) typesMap = exportTypes(customTypes, config.orm);
		}
		catch (e) {
			if (e instanceof Deno.errors.NotFound) {
				console.error(ErrorDisplay(`Types definition file not found: ${path}`));
			}
			else if (e instanceof Deno.errors.PermissionDenied) {
				console.error(ErrorDisplay(`Permission denied: ${path}`));
			}
			else if (e instanceof SyntaxError) {
				console.error(ErrorDisplay(`Malformed JSON in types file: ${path}\n${e.message}`));
			}
			throw e;
		}
	}

	for (const [dbPath, build] of config.databases) {
		if (names && !names.includes(basename(dbPath, extname(dbPath)))) continue;

		if (release && !build.production) {
			console.warn(WarningDisplay(`No 'production' path configured, skipping: ${getPathDisplay(dbPath)}`));
			continue;
		}

		const targetPath = release ? resolvePath(build.production!) : dbPath;
		const dbName = basename(targetPath, extname(targetPath));
		const schemaName = build.schemaName || toPascalCase(dbName);
		const dbPathDisplay = getPathDisplay(targetPath);

		console.log();
		ensureDirSync(dirname(targetPath));

		if (release && build.backup) {
			backupDatabase(targetPath, build.backupDirectory);
		}

		// 1 Prepare database and establish a connection:
		if (build.source) {
			if (release) {
				console.log(`Open existing production database ${dbPathDisplay}`);
			}
			else {
				const basePath = resolvePath(build.source);
				if (basePath === targetPath) {
					console.warn(WarningDisplay(`base and destination are the same path, skipping: ${dbPathDisplay}`));
					continue;
				}
				Deno.copyFileSync(basePath, targetPath);
				console.log(`Copy ${getPathDisplay(basePath)} to ${dbPathDisplay}`);
			}
		}
		else {
			try {
				Deno.removeSync(targetPath);
				console.log(red(`Remove existing database ${dbPathDisplay}`));
			}
			catch { /* not found */ }
		}

		const db = new Database(targetPath);
		const strict = build.strict ?? config.strict ?? true;

		if (strict) db.exec("PRAGMA foreign_keys = ON;");
		if (build.functions) await registerFunctions(db, build.functions.map(resolvePath));

		// 2 Create additional metatables as needed and import column annotations:
		const relationStatements: RelationStatements = {};
		const appliedTypes: AppliedTypes = {};
		
		// 3 Execute each script instruction by instruction:
		for (const scriptStr of build.scripts) {
			await runScript(db, scriptStr, dbPathDisplay, relationStatements, customTypes, appliedTypes);
		}

		// 4 Apply manual ORM-only type overrides on top of the parsed annotations:
		if (build.ormTypes) {
			for (const [table, cols] of Object.entries(build.ormTypes)) {
				appliedTypes[table] = { ...appliedTypes[table], ...cols };
			}
		}

		// 5 Export metadata and ORM when required:
		console.log(`Validate views on database ${dbPathDisplay}`);

		const metadata = extractMetadata(
			db, dbName, schemaName, relationStatements, customTypes, appliedTypes);
		//console.log(`metadata = ${JSON.stringify(metadata)}`);

		if (!release) {
			if (build.metadata) exportMetadata(metadata, resolvePath(build.metadata));
			if (config.orm) exportClasses(metadata, config.orm, typesMap);
		}
		
		db.close();

		// 6 Caches applied custom types as JSON next to the database:
		const cachePath = join(dirname(targetPath), `${basename(targetPath, extname(targetPath))}.json`);
		Deno.writeTextFileSync(cachePath, JSON.stringify(appliedTypes, null, "\t"));
		console.log(`Cache applied types to ${bold(cachePath)}`);
	}
}


/** Creates a timestamped backup copy of the production database before modification. */
function backupDatabase(targetPath: string, backupDirectory: string | undefined): void {
	try {
		const dir = backupDirectory ? resolvePath(backupDirectory) : dirname(targetPath);
		ensureDirSync(dir);

		const name = basename(targetPath, extname(targetPath));
		const backupPath = join(dir, `${name}.${Date.now()}${extname(targetPath)}`);

		Deno.copyFileSync(targetPath, backupPath);
		console.log(`Backup ${getPathDisplay(targetPath)} to ${getPathDisplay(backupPath)}`);
	}
	catch (e) {
		if (e instanceof Deno.errors.NotFound) {
			console.log(grey(`No existing production database to back up at ${getPathDisplay(targetPath)}`));
		}
		else throw e;
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


// ORM COMMAND

/** Regenerates ORM classes for all configured databases from existing files, without running scripts. */
export async function regenerateOrm(config: Config): Promise<void> {
	if (!config.orm) {
		console.error(ErrorDisplay("No 'orm' configuration found in smake.json"));
		Deno.exit(1);
	}

	let customTypes: CustomTypes = {};
	let typesMap: TypesMap = {}

	if (config.types) {
		const path = resolvePath(config.types);
		customTypes = CustomTypesSchema.parse(JSON.parse(Deno.readTextFileSync(path)));
		typesMap = exportTypes(customTypes, config.orm);
	}

	for (const [dbPath, build] of config.databases) {
		const dbName = basename(dbPath, extname(dbPath));
		const schemaName = build.schemaName || toPascalCase(dbName);
		const dbPathDisplay = getPathDisplay(dbPath);

		console.log();

		let db: Database;

		try {
			db = new Database(dbPath, { readonly: true });
		}
		catch {
			console.warn(WarningDisplay(`Database not found, skipping: ${dbPathDisplay}`));
			continue;
		}

		console.log(`Read metadata from ${dbPathDisplay}`);

		const appliedTypes = readAppliedTypes(dbPath);

		if (build.ormTypes) {
			for (const [table, cols] of Object.entries(build.ormTypes)) {
				appliedTypes[table] = { ...appliedTypes[table], ...cols };
			}
		}

		const metadata = extractMetadata(db, dbName, schemaName, {}, customTypes, appliedTypes);

		exportClasses(metadata, config.orm, typesMap);

		db.close();
	}
}


/** Reads a previously cached applied-types JSON file next to the database, if present. */
export function readAppliedTypes(dbPath: string): AppliedTypes {
	const cachePath = join(dirname(dbPath), `${basename(dbPath, extname(dbPath))}.json`);

	try {
		return JSON.parse(Deno.readTextFileSync(cachePath)) as AppliedTypes;
	}
	catch {
		return {};
	}
}