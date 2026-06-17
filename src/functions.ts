
import { Database } from "sqlite";


//

function readfileText(path: string): string {
	return Deno.readTextFileSync(path);
}


function readfileBlob(path: string): Uint8Array {
	return Deno.readFileSync(path);
}


function toUnix(value: string | number, unit: string = "s"): number {
	const scale: Record<string, number> = { 
		s: 1, 
		ms: 1e3,
		milli: 1e3, 
		µs: 1e6,
		micro: 1e6 
	};
	
	if (!(unit in scale)) {
		throw new Error(`unit must be 's', 'milli' / 'ms' or 'micro' / 'µs'`);
	}
	else if (typeof value === "number") {
		return Math.floor(value * scale[unit]);
	}
	else {
		const ms = new Date(value).getTime();
		return Math.floor(ms / 1000 * scale[unit]);
	}
}


/** Register built-in and user-defined SQL functions on an open database. */
export async function registerFunctions(db: Database, files: string[]): Promise<void> {
	db.function("readfile_text", readfileText);
	db.function("readfile_blob", readfileBlob);
	db.function("to_unix", toUnix);

	for (const file of files) {
		const mod = await import(file);
		for (const [name, fn] of Object.entries(mod)) {
			if (typeof fn === "function" && name !== "default") {
				db.function(name, fn as (...args: unknown[]) => unknown);
			}
		}
	}
}
