# SMake

Inspired by psql, SMake is a command-line utility that assembles SQLite databases from various SQL sources, injects domain-derived check constraints, and automatically derives a TypeScript ORM layer from the final schema. Unlike alternatives built on complex migration workflows, custom configuration languages, or rigid folder hierarchies, SMake orchestrates everything through a single, straightforward JSON file.

## Outline of Functionalities

SMake manages configurations for any number of SQLite databases through a central [JSON file](https://github.com/ts-series/smake/blob/main/REFERENCE.md#2-build-configuration), executing listed SQL scripts in sequence according to specified parameters, such as enforcing foreign key constraints or modifying existing databases. Should an issue arise, SMake displays the error message alongside the precise line range of the problematic statement:

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

Optionally, SMake extracts metadata from built databases and generates TypeScript ORM classes from them, including type definitions and Zod validation schemas derived from the same source, targeting [Lite.ts](https://github.com/ts-series/lite), a lightweight, connector-agnostic ORM for SQLite.

### Automated Constraint Injection

SMake streamlines schema maintenance by automatically injecting check constraints into all tables during the build process, mapping column names to domain definitions that specify required validations, such as enums, ranges, or regex patterns. This enforces domain-specific rules consistently across the database, eliminating repeated constraint logic per table:

```sql
create table Entity (
	risk Risk
);
```

SMake resolves custom types to their real affinities for valid final SQL, while the Risk definition itself lives in a separate domain JSON file. For details on domain definitions, see [Typing](https://github.com/ts-series/smake/blob/main/REFERENCE.md#4-typing) in the reference documentation.

Additionally, the generated ORM utilizes these same definitions to synchronize type definitions and Zod schemas in TypeScript with the database constraints, providing a unified source of truth for both the persistence and application layers.

## Installation

There are three ways to install SMake.

### With JSR

If you have [Deno](https://deno.com) installed:

```sh
deno install -A -g jsr:@ts-series/smake
```

This installs the `smake` binary globally on your `PATH`.

### Precompiled binary

Download the binary for your platform from the [latest release](https://github.com/ts-series/smake/releases/latest), then make it executable and place it on your `PATH`.

#### Linux

```sh
curl -L -o smake https://github.com/ts-series/smake/releases/latest/download/smake-linux-x64
chmod +x smake
mv smake ~/.local/bin/
```

#### macOS

```sh
curl -L -o smake https://github.com/ts-series/smake/releases/latest/download/smake-macos-x64
chmod +x smake
mv smake ~/.local/bin/
```

On Apple Silicon, use `smake-macos-arm64` instead.

#### Windows

Download `smake-windows-x64.exe` from the [latest release](https://github.com/ts-series/smake/releases/latest), rename it to `smake.exe`, and place it in any directory listed in your `PATH` environment variable.

### From source

Clone or download the repository, then compile a self-contained executable with:

```sh
deno compile --allow-read --allow-write --allow-env --allow-ffi --output dist/smake src/cli.ts
```

or just:

```sh
deno task compile
```

The resulting binary bundles all dependencies and can be placed anywhere on your `PATH`; for example under `~/.local/bin` with:

```sh
deno task install
```

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

Full documentation is available in [REFERENCE.md](https://github.com/ts-series/smake/blob/main/REFERENCE.md).

## License

This software is released into the public domain under [The Unlicense](http://unlicense.org/).