
import { join, resolve } from "std/path"
import { z } from "zod";

import { ErrorDisplay } from "./formatting.ts";


// GENERALLY USEFUL FUNCTIONS

/** Returns true if the object has no enumerable own properties. */
export const isEmpty = (obj: object): boolean => { for (const _ in obj) return false; return true; };


export function contains(collection: Collection | undefined, value: string | number): boolean {
	if (!collection) {
		return false;
	}
	else {
		const normalizedCollection = Array.isArray(collection)
			? collection
			: Object.values(collection);

		return normalizedCollection.includes(value);
	}
}


// SPECIFICATION OF THE TYPES DEFINITION FILE

export const AffinityValues = ["NUMERIC", "INTEGER", "REAL", "TEXT", "BLOB"] as const;

export type Affinity = (typeof AffinityValues)[number];


const Primitive = z.union([z.string(), z.number()]);


const CollectionSchema = z.union([
	z.array(Primitive),
	z.record(z.string(), Primitive)
])

export type Collection = z.infer<typeof CollectionSchema>;


const BaseSchema = z.object({
	affinity: z.enum(AffinityValues),
	values: CollectionSchema.optional(),
	doc: z.string().optional()
});


const NumericSchema = BaseSchema.extend({
	affinity: z.enum(["INTEGER", "REAL", "NUMERIC"]),
	min: z.number().optional(),
	max: z.number().optional(),
	step: z.number().optional(),
});


const TextSchema = BaseSchema.extend({
	affinity: z.literal("TEXT"),
	like: z.string().optional(),
	glob: z.string().optional(),
	regexp: z.string().optional(),
	length: z.number().optional(),
	minLength: z.number().optional(),
	maxLength: z.number().optional(),
	format: z.string().optional(),
	since: z.string().optional(),
	until: z.string().optional(),
});


const BlobSchema = BaseSchema.extend({
	affinity: z.literal("BLOB"),
	length: z.number().describe("Exact size in bytes").optional(),
	minLength: z.number().describe("Minimum size in bytes").optional(),
	maxLength: z.number().describe("Maximum size in bytes").optional(),
	pattern: z.string().describe("Hex-pattern or regex for byte sequences").optional(),
});


const DomainSchema = z.union([NumericSchema, TextSchema, BlobSchema]);

export type Domain = z.infer<typeof DomainSchema>;


export const CustomTypesSchema = z.record(z.string(), DomainSchema);

export type CustomTypes = z.infer<typeof CustomTypesSchema>;


// READING AND PREPARING BUILD DATA

export const NamingConventionValues = ["PascalCase", "camelCase", "snake_case"] as const;

export type NamingConvention = (typeof NamingConventionValues)[number];

export const NamingConventionSchema = z.enum(NamingConventionValues);


/** All settings for automatic ORM generation. */
const OrmSchema = z.object({
	directory: z.string(),
		// Target directory where the generated TS module should be stored.
	libraryPath: z.string().optional(),
		// Path or name under which the ORM library Lite.ts is imported.
	zodPath: z.string().optional(),
		// Path to the validation library for imports, with currently only Zod being supported.
		// If the specification is missing, no validation schemas are generated.
	definitionsPath: z.string().default("./definitions.ts"),
		// Relative path from the ORM directory to the type definitions module.
	indent: z.union([z.number().min(1).max(8), z.string()]).default(1),
		// Indentation depth, where 1 is understood as a tab stop.
	tableNaming: NamingConventionSchema.default("PascalCase"),
	columnNaming: NamingConventionSchema.default("camelCase"),
	typeNaming: NamingConventionSchema.nullable().default(null),
		// Case of database identifiers at application level.
		// null: Name unchanged, as in the JSON file.
	strippedSuffixes : z.array(z.string()).optional().transform(s => s?.map(v => v.toLowerCase())),
		// Are there specific endings to column names that should be removed in the ORM?
	includingViews: z.boolean()
		// Should SQL views also be implemented as table classes?
});

export type Orm = z.infer<typeof OrmSchema>;


const BuildSchema = z.object({
	schemaName: z.string().optional(),
		// Name of the DB for cross-database joins.
	source: z.string().optional(),
		// Path to an existing database to be copied and modified.
	strict: z.boolean().optional(),
		// Should foreign key constraints be enabled? Falls back to the global setting, then to true.
	functions: z.array(z.string()).optional().default([]),
		// TypeScript modules containing custom functions to be available in SQLite during SMake creation.
	scripts: z.array(z.string()),
		// List of source files executed sequentially on this database.
	ormTypes: z.record(z.string(), z.record(z.string(), z.string())).optional(),
		// Custom types that only exist in the ORM without constraint injections and take precedence over specifications in the SQL code.
	production: z.string().optional(),
		// Path to the live database to be modified directly when releasing.
	backup: z.boolean().default(true),
		// Should a timestamped copy of the production database be created before release?
	backupDirectory: z.string().optional(),
		// Target directory for the backup copy; defaults to the directory of 'production'.
	metadata: z.string().optional()
		// If a path is specified, the metadata will be exported there (e.g., for third-party software).
});

export type Build = z.infer<typeof BuildSchema>;


const ConfigSchema = z.object({
	types: z.string().optional(),
		// Path to a JSON file where custom types are precisely specified, from which check constraints and TS types are generated.
	orm: OrmSchema.optional(),
		// Specifications for generating the ORM.
	strict: z.boolean().optional(),
		// Global default for whether foreign key constraints are enabled, overridable per database.
	directory: z.string().optional(),
		// If set, every database key resolves relative to this directory instead of being an absolute path itself.
	databases: z.record(z.string(), BuildSchema)
});


export type Builds = Map<string, Build>;

export type Config = Omit<z.infer<typeof ConfigSchema>, "databases"> & {
    databases: Builds;
};


//

/** Resolve a config path string to an absolute file path. */
export function resolvePath(key: string): string {
	if (key.startsWith("~")) {
		const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
		return key.replace("~", home);
	}
	return resolve(Deno.cwd(), key);
}


/** Read and validate smake.json, returning a map of absolute db paths to build configs. */
export function readConfig(): Config {
	let text: string;
	let raw: unknown;

	try {
		text = Deno.readTextFileSync("smake.json");
	}
	catch {
		console.error(ErrorDisplay("Build file 'smake.json' not found."));
		Deno.exit(1);
	}

	try {
		raw = JSON.parse(text);
	}
	catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(ErrorDisplay(`Build file 'smake.json' is not valid JSON: ${msg}`));
		Deno.exit(1);
	}

	const result = ConfigSchema.safeParse(raw);
	
	if (!result.success) {
		const groups = new Map<string, string[]>();
	
		for (const issue of result.error.issues) {
			const [db, ...rest] = issue.path;
			const dbKey = String(db);
			const fieldPath = rest.join(" → ");
			
			const sepIndex = issue.message.indexOf(": ");
			const cleanMsg = sepIndex !== -1 
				? issue.message.slice(sepIndex + 2) 
				: issue.message;
	
			const group = groups.get(dbKey) ?? [];
			group.push(`  → ${fieldPath}: ${cleanMsg}`);
			groups.set(dbKey, group);
		}
	
		for (const [dbFile, errors] of groups) {
			console.error(ErrorDisplay(`Invalid build for ${dbFile}\n${errors.join("\n")}`));
		}
	
		Deno.exit(1);
	}

	const databases: Builds = new Map();
	for (const [key, val] of Object.entries(result.data.databases)) {
		databases.set(resolvePath(result.data.directory ? join(result.data.directory, key) : key), val);
	}

	if (result.data.orm) result.data.orm.indent = resolveIndent(result.data.orm.indent);

	return { ...result.data, databases };
}


function resolveIndent(value: number | string): string {
	return typeof value === "string" ? value : value === 1 ? "\t" : " ".repeat(value);
}
