
// USAGE

export const Help = `smake – SQLite database build tool

Usage:
  smake [command [subcommand]] [options]

Commands:
  (none)           Execute the local smake.json in cwd
  example          Create example smake.json and example.sql in cwd
  init             Create a new smake.json through an interactive wizard
  only metatables  Create an SQL source file in cwd containing the metatable code.

Options:
  -h, --help, ?  Show this help
  -v, --version  Show version`;


// DATABASE EXAMPLE

export const ExampleBuild = `{
	"orm": {
		"directory": "./orm/example.ts",
		"libraryPath": "litets",
		"includingViews": true,
		"tableNaming": "PascalCase",
		"columnNaming": "camelCase"
	},
	"databases": {
		"example.db": {
			"strict": true,
			"metadata": ".metadata/example.json",
			"schemaName": "Example",
			"functions": [],
			"scripts": [
				"example.sql"
			]
		}
	}
}`;


export const ExampleSql = `create table HardwareInventory (
	Id integer primary key,
	DeviceType text,
	Status text
);

insert into HardwareInventory (Id, DeviceType, Status) values
	(1, 'Server', 'active'),
	(2, 'Switch', 'active'),
	(3, 'Router', 'testing');

update HardwareInventory set Status = 'maintenance' where Id in (1, 2);

delete from HardwareInventory where Id = 3;`;
