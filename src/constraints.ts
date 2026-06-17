
import { Domain, CustomTypes } from "./preparing.ts";


//

/** Specifies the custom type (value) of a column (key). */
export type ColumnTypes = Record<string, string>;


/** Generates SQL CHECK constraints based on analyzed column types and domain definitions. */
export function generateConstraints(
	table: string,
	columnTypes: ColumnTypes,
	customTypes: CustomTypes
): string[] {
	const sqlConstraints: string[] = [];

	for (const [columnName, typeName] of Object.entries(columnTypes)) {
		const domain = customTypes[typeName];

		if (domain) {
			const expr = buildCheckExpression(columnName, domain);
			
			if (expr) {
				const label = `${table}.${columnName} — valid ${typeName}`;
				sqlConstraints.push(`constraint "${label}" check (${expr})`);
			}
		}
	}

	return sqlConstraints;
}


/** Translates the type domain into a valid SQL CHECK expression. */
function buildCheckExpression(column: string, domain: Domain): string | null {
	const col = `"${column}"`;
	const fmt = (v: any) => typeof v === "string" ? `'${v}'` : v;
	const inList = (vals: any[]) => `${col} in (${vals.map(fmt).join(", ")})`;
	const toList = (v: any) => Array.isArray(v) ? v : Object.values(v);

	switch (domain.affinity) {
		case "NUMERIC":
		case "INTEGER":
		case "REAL": {
			if (domain.values !== undefined) return inList(toList(domain.values));

			const parts: string[] = [];

			if (domain.min !== undefined && domain.max !== undefined)
				parts.push(`${col} between ${domain.min} and ${domain.max}`);
			if (domain.step !== undefined)
				parts.push(`${col} % ${domain.step} = 0`);

			return parts.length > 0 ? parts.join(" and ") : null;
		}
		case "TEXT": {
			const fmtMap: Record<string, string> = {
				date: "%Y-%m-%d",
				time: "%H:%M:%S",
				datetime: "%Y-%m-%d %H:%M:%S",
			};

			const Priority = ["values", "like", "glob", "length", "minLength", "maxLength", "format"] as const;

			const mode = Priority.find(key => domain[key] !== undefined);

			switch (mode) {
				case "values":
					return inList(toList(domain.values));
				case "like":
					return `${col} like '${domain.like}'`;
				case "glob":
					return `${col} glob '${domain.glob}'`;
				case "length":
					return `length(${col}) = ${domain.length}`;
				case "minLength": 
					return `length(${col}) >= ${domain.minLength}`
						+ (domain.maxLength !== undefined ? ` and length(${col}) <= ${domain.maxLength}` : "");
				case "maxLength":		
					return `length(${col}) <= ${domain.maxLength}`;
				case "format":
					return `${col} = strftime('${fmtMap[domain.format!]}', ${col})`
						+ (domain.since !== undefined ? ` and ${col} >= '${domain.since}'` : "")
						+ (domain.until !== undefined ? ` and ${col} <= '${domain.until}'` : "");
				default:
					return null;
			}
		}
		default: return null;
	}
}
