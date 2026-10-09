
import { parseArgs } from "std/cli/parse-args"

import { ExampleBuild, ExampleSql, Help } from "./templates.ts";
import { createBuilds, regenerateOrm } from "./executing.ts";
import { finalizeOrm, OrmSchema, readConfig, resolvePath } from "./preparing.ts";


//

const Version = "2.1";


const args = parseArgs(Deno.args, {
	boolean: ["help", "version"],
	string: ["lib", "indent"],
	alias: { h: "help", v: "version" },
});


/** Entry point: dispatches CLI subcommands or runs the default build. */
async function program(): Promise<void> {
	const args = parseArgs(Deno.args, {
		boolean: ["help", "version"],
		alias:   { h: "help", v: "version" },
	});

	const cmd = args.help ? "help" : args.version ? "version" : args._[0];

	switch (cmd) {
		case "?":
		case "h":
		case "help": {
			console.log(Help);
			break;
		}
		case "v":
		case "version": {
			console.log(Version);
			break;
		}
		case "example": {
			Deno.writeTextFileSync("smake.json", ExampleBuild);
			Deno.writeTextFileSync("example.sql", ExampleSql);
			console.log("Created smake.json and example.sql");
			break;
		}
		case "orm": {
			if (args._.length === 1) {
				regenerateOrm(readConfig());
			}
			else if (args._.length === 3) {
				let indent: number | string | undefined;

				if (args.indent === undefined) {
					indent = undefined;
				}
				else if (/^\d+$/.test(String(args.indent))) {
					indent = Number(args.indent);
				}
				else {
					indent = String(args.indent);
				}

				const orm = OrmSchema.parse({
					directory: String(args._[2]),
					libraryImport: args.lib === undefined ? undefined : String(args.lib),
					indent
				});

				finalizeOrm(orm);
				
				regenerateOrm({
					orm,
					databases: new Map([[resolvePath(String(args._[1])), { scripts: [], functions: [], backup: true }]])
				});
			}
			else {
				console.error(`\x1b[91m[ERROR]\x1b[0m Usage: smake orm [<db path> <orm dir> [--lib <import>] [--indent <n|string>]]`);
				Deno.exit(1);
			}
			break;
		}
		case "release": {
			const names = args._.slice(1).map(String);
			createBuilds(readConfig(), true, names.length > 0 ? names : undefined);
			break;
		}
		case "build":
		case undefined: {
			const names = args._.slice(1).map(String);
			createBuilds(readConfig(), false, names.length > 0 ? names : undefined);
			break;
		}
		default: {
			console.error(`\x1b[91m[ERROR]\x1b[0m Unknown command: ${cmd}`);
			Deno.exit(1);
		}
	}
}

program();
