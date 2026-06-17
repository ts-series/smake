# SMake

Inspired by psql, SMake is a command-line utility that assembles SQLite databases from various SQL sources and automatically derives a TypeScript ORM layer from the final schema.

## Outline of Functionalities

SMake manages configurations for any number of SQLite databases through a central JSON file. The tool executes listed SQL scripts in sequence according to specified parameters, such as enforcing foreign key constraints or modifying existing databases. Should an issue arise, SMake provides clear feedback by displaying the error message alongside the precise line range of the problematic statement:

```
$ smake 
Load 37 types
Export ORM types module »definitions.ts« to …

Remove existing database ../../../../.local/share/…/portfolio.db
Execute portfolio.sql on ../../../../.local/share/…/portfolio.db
    create table Entity
        ! unknown custom type »Risk« for column »risk«
        → set BLOB as affinity
        + constraint for column country
        + constraint for column industry
        + constraint for column last_rated
  ╷ ERROR in portfolio.sql:63:99
  │ no such column: country
  ╵ create table StockExchange ( …
    create table MarketIndex
        + constraint for column asset_class
    create view AssetType
    create table Fiat
        + constraint for column color
    create trigger asset_from_fiat
```

SQL scripts can also call user-defined functions implemented in TypeScript, as well as a set of built-in functions for common tasks such as reading files or converting timestamps.

Optionally, SMake can extract metadata from built databases and generate TypeScript ORM classes from them, including type definitions and Zod validation schemas derived from the same source. The generated classes target [Lite.ts](https://github.com/thyringer/lite-ts), a lightweight, connector-agnostic ORM for SQLite.

### Automated Constraint Injection

SMake streamlines schema maintenance by automatically injecting check constraints into all tables during the build process. SMake maps column names to domain definitions to identify required validations, such as enums, ranges, or regex patterns. This automation ensures that domain-specific rules are strictly enforced across the entire database, eliminating the need to manually repeat constraint logic for every individual table definition.

Additionally, the generated ORM utilizes these same definitions to synchronize type definitions and Zod schemas in TypeScript with the database constraints, providing a unified source of truth for both the persistence and application layers.

## License

This software is released into the public domain under [The Unlicense](http://unlicense.org/).

## Installation

SMake requires [Deno](https://deno.com) to be installed. Clone or download the repository, then compile a self-contained executable with:

```sh
deno compile --allow-read --allow-write --allow-env --allow-ffi --output dist/smake modules/cli.ts
```

or just:

```sh
deno run compile
```

The resulting binary bundles all dependencies and can be placed anywhere on your `PATH`; for example under `~/.local/bin` with:

```sh
deno run install
```

### Linux

```sh
chmod +x smake
mv smake ~/.local/bin/
```

### Windows

Place `smake.exe` in any directory listed in your `PATH` environment variable.

## Usage

The usage is similar to `make`, in that the entire program input is taken from a local JSON file:

```json
{
    "databases": {
        "out/example.db": {
            "strict": true,
            "scripts": ["example.sql"]
        }
    }
}
```

By simply calling `smake` the database gets assembled according to the listed scripts.

### Example Project

To create a sample configuration file (`smake.json`) and an example SQL script (`example.sql`), run:

```sh
smake example
```

Full documentation is available in [REFERENCE.md](https://github.com/thyringer/smake/blob/main/REFERENCE.md).
