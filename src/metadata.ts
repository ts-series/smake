
import { Database } from "sqlite";
import { dirname, fromFileUrl } from "std/path";

import { bold, ErrorDisplay, grey, indent, printSqlError, WarningDisplay } from "./formatting.ts";
import { Affinity, CustomTypes, Domain } from "./preparing.ts";
import { AppliedTypes, RelationStatements } from "./parsing.ts";
import { ColumnTypes } from "./constraints.ts";


//

export interface Column {
	affinity: Affinity;
	type: string | null;
	generated: boolean;
	nullable: boolean;
	default: string | null;
	isJson: boolean;
}


interface ForeignKey {
	columns: string[];
	referencedTable: string;
	referencedColumns: string[];
	onUpdate: string;
	onDelete: string;
}


export interface Relation {
	columns: Record<string, Column>;
		// Key: The related column name.
	uniqueConstraints: string[][];
		// List of column name lists: First element represents the primary key.
	foreignKeys: ForeignKey[];
}


export interface Metadata {
	databaseName: string;
	schemaName: string;
	tables: Record<string, Relation>;
	views: Record<string, Relation>;
	usedTypes: Record<string, Domain>;
}


//

export function isMetadata(data: Metadata | CustomTypes): data is Metadata {
	return "tables" in data && "views" in data;
}


type RelationType = "table" | "view";


/** Minimal SQLite metadata extractor. */
export function extractMetadata(
	db: Database,
	dbName: string,
	schemaName: string,
	relationStatements: RelationStatements,
	customTypes: CustomTypes, 
	appliedTypes: AppliedTypes
): Metadata {
	const metadata: Metadata = { databaseName: dbName, schemaName, tables: {}, views: {}, usedTypes: {} };

	const usedTypes = new Set(Object.values(appliedTypes).flatMap(colType => Object.values(colType)));

	for (const usedType of usedTypes) {
		if (customTypes[usedType]) {
			metadata.usedTypes[usedType] = customTypes[usedType];
				// Only adopt the definitions of the types actually used.
		}
	}

	const dbObjects = db.prepare(`select name, type from sqlite_master where 
		type in ('table', 'view') and name not like 'sqlite_%'`
	).all() as { name: string, type: RelationType }[];

	for (const { name, type } of dbObjects) {
		const tableAnnotations = appliedTypes[name] ?? {};
		const obj = introspectDbObject(db, name, type, relationStatements, tableAnnotations);
		
		if (obj) metadata[type === "table" ? "tables" : "views"][name] = obj;
	}

	return metadata;
}


/** Extract table metadata from database and save to file. */
export function exportMetadata(metadata: Metadata, destination: string): Metadata {
	Deno.mkdirSync(dirname(destination), { recursive: true });
	Deno.writeTextFileSync(destination, JSON.stringify(metadata, null, "\t"));

	console.log(`Export metadata to ${bold(destination)}`);
	return metadata;
}


// INTROSPECTIVE SUBFUNCTIONS

/** Collects columns, keys and constraints for a specific database object. */
function introspectDbObject(
	db: Database, 
	name: string, 
	type: RelationType, 
	relationStatements: RelationStatements,
	columnTypes: ColumnTypes
): Relation | null {
	try {
		const colInfos = db.prepare(`pragma table_xinfo("${name}")`).all() as any[];

		const columns: Record<string, Column> = {};
		const pkCols: [number, string][] = [];
	
		for (const col of colInfos) {
			let affinity = col.type.toUpperCase() as Affinity;
			let customTypeName = columnTypes[col.name] ?? null;
	
			const nullable = !col.notnull;
			const generated = col.hidden >= 2;
			const defaultValue = generated ? null : typeof col.dflt_value === "string"
				? col.dflt_value
				: nullable
					? "null"
					: null;
	
			columns[col.name] = {
				affinity,
				type: customTypeName,
				nullable,
				generated,
				default: defaultValue,
				isJson: /json/i.test(col.name) || (customTypeName !== null && /json/i.test(customTypeName))
			};
			
			if (col.pk > 0) pkCols.push([col.pk, col.name]);
		}
	
		return {
			columns,
			uniqueConstraints: fetchUniqueConstraints(db, name, pkCols),
			foreignKeys: type === "table" ? fetchForeignKeys(db, name) : []
		};
	}
	catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		//console.log(`introspectDbObject::relationStatements = ${JSON.stringify(relationStatements)}`);
		const stmt = relationStatements[name];
		const pragma = grey(`pragma table_xinfo("${name}")`);
		printSqlError(stmt, msg, [`Could not read metadata from ${pragma}`]);
		return null;
	}
}


/** Retrieves primary and unique key column sets. */
function fetchUniqueConstraints(db: Database, name: string, pkCols: [number, string][]): string[][] {
	const constraints: string[][] = [];
	if (pkCols.length) {
		constraints.push(pkCols.sort(([a], [b]) => a - b).map(([, n]) => n));
	}
	const indexes = db.prepare(`pragma index_list("${name}")`).all() as any[];
	for (const idx of indexes) {
		if (idx.unique && idx.origin !== "pk") {
			const cols = db.prepare(`pragma index_info("${idx.name}")`).all() as any[];
			constraints.push(cols.map(c => c.name));
		}
	}
	return constraints;
}


/** Groups foreign key parts by their ID. */
function fetchForeignKeys(db: Database, name: string): ForeignKey[] {
	const rows = db.prepare(`pragma foreign_key_list("${name}")`).all() as any[];
	const groups = new Map<number, ForeignKey>();
	for (const r of rows) {
		if (!groups.has(r.id)) {
			groups.set(r.id, { 
				columns: [], referencedTable: r.table, referencedColumns: [], 
				onUpdate: r.on_update, onDelete: r.on_delete 
			});
		}
		const g = groups.get(r.id)!;
		g.columns.push(r.from);
		g.referencedColumns.push(r.to);
	}
	return [...groups.values()];
}
