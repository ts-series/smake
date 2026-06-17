
import { parseArgs } from "std/cli/parse-args"

import { ExampleBuild, ExampleSql, Help } from "./templates.ts";
import { createBuilds } from "./executing.ts";
import { readConfig } from "./preparing.ts";


//

const Version = "1.1";


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
		case "help":
			console.log(Help);
			break;
		case "v":
		case "version":
			console.log(Version);
			break;
		case "example":
			Deno.writeTextFileSync("smake.json", ExampleBuild);
			Deno.writeTextFileSync("example.sql", ExampleSql);
			console.log("Created smake.json and example.sql");
			break;
		/*
		case "only":
			if (args._[1] === "metatables") {
				Deno.writeTextFileSync("metatables.sql", Metatables);
				console.log("Created metatables.sql");
			}
			break;
		*/
		case undefined:
			createBuilds(readConfig());
			break;
		default:
			console.error(`\x1b[91m[ERROR]\x1b[0m Unknown command: ${cmd}`);
			Deno.exit(1);
	}
}

program();
