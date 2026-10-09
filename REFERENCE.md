# SMake — Reference

SMake builds SQLite databases from SQL scripts, optionally injecting check constraints from a shared type system and generating a TypeScript ORM. It is configured entirely through a single `smake.json` file.

## Table of Contents

1. [CLI Commands](#1-cli-commands)
2. [Build Configuration](#2-build-configuration)
3. [User-Defined SQL Functions](#3-user-defined-sql-functions)
4. [Typing](#4-typing)


## 1 CLI Commands

| Command                           | Description |
| --------------------------------- | ----------- |
| `smake`                           | Shorthand for `smake build`. |
| `smake build [name...]`           | Builds all databases, or only the ones listed by name. |
| `smake release [name...]`         | Applies the configured builds directly to the live `production` databases instead of the local development copies. |
| `smake orm`                       | Regenerates ORM classes for all databases listed in `smake.json`, without running any scripts. |
| `smake orm <db> <dir> [options]`  | Regenerates ORM classes for a single database directly from the command line, ignoring any `smake.json`. See [2.5](#25-orm-fields). |
| `smake example`                   | Writes a sample `smake.json` and `example.sql` to the current directory. |
| `smake help`                      | Prints usage information. |
| `smake version`                   | Prints the installed SMake version. |

For `build` and `release`, a `name` refers to a database's file name without extension, taken from its key in `databases`. Multiple names can be passed at once to limit the command to a subset of databases.

### 1.1 Build vs. Release

`smake build` always works on the path given as the key in `databases`, a disposable local file that can be deleted and recreated freely. `smake release` instead writes to the database's `production` path, the live database actually used by the application.

This split is intended for a specific workflow: scripts are developed and tested against a local build first, and once the result looks correct, the exact same scripts are run against the production database with `smake release`. Both commands read the same `scripts`, `pragmas`, `functions`, and `ormTypes` settings, so the only thing that changes between them is the target file.

`smake release` skips any database without a `production` path configured, with a warning. ORM and metadata exports are skipped during release, since those are development artifacts the production environment does not need.

For databases reachable only on a remote server, the remote path should be mounted locally first (e.g. via SSHFS), with `production` pointing at the mounted path; SMake itself only ever works with local file paths.


## 2 Build Configuration

Global settings apply to all databases unless overridden; per-database settings are nested under `databases`.

```json
{
    "types": "./custom-types.json",
    "directory": "./db/",
    "pragmas": {
        "foreign_keys": true
    },
    "orm": {
        "directory": "./orm/",
        "libraryImport": "litets",
        "validatorImport": "zod",
        "includingViews": true,
        "tableNaming": "PascalCase",
        "columnNaming": "camelCase"
    },
    "databases": {
        "example1.db": {
            "metadata": ".metadata/example1.json",
            "schemaName": "Example1",
            "scripts": [
                "example1a.sql",
                "example1b.sql"
            ]
        },
        "example2.db": {
            "source": "base.db",
            "production": "/srv/app/example2.db",
            "scripts": [
                "example2.sql"
            ]
        }
    }
}
```

### 2.1 Global Fields

| Field       | Type    | Description |
| ----------- | ------- | ----------- |
| `databases` | object  | Mapping of database keys to their specific build configurations. |
| `types`     | string  | Path to a JSON file containing type information shared across all databases. |
| `directory` | string  | If set, database keys are resolved relative to this directory instead of being standalone paths. |
| `pragmas`   | object  | Global default PRAGMA settings, overridable per database. See [2.3](#23-pragma-fields) below. |
| `orm`       | object  | Settings for automatic ORM generation, applied to all databases. |

### 2.2 Per-Database Fields

| Field             | Type     | Description |
| ----------------- | -------- | ----------- |
| `scripts`         | string[] | SQL script files executed sequentially on the database. The only required field. |
| `pragmas`         | object   | PRAGMA settings for this database, merged over the global defaults. See [2.3](#23-pragma-fields) below. |
| `source`          | string   | Path to an existing database to be copied and extended instead of creating a new one. |
| `production`      | string   | Path to the live database modified directly by `smake release`. |
| `backup`          | boolean  | Whether to back up `production` before release. Defaults to `true`. |
| `backupDirectory` | string   | Target directory for the backup copy; defaults to the directory of `production`. |
| `metadata`        | string   | If set, exports database metadata to this path (e.g. for third-party tooling). |
| `schemaName`      | string   | Optional schema name for cross-database joins. |
| `functions`       | string[] | TypeScript modules exporting custom SQL functions available during the build. |
| `ormTypes`        | object   | Manual custom-type assignments for the ORM only, see [2.6](#26-orm-only-types) below. |

### 2.3 Pragma Fields

Global `pragmas` and per-database `pragmas` are merged, with per-database values taking precedence over global ones on a per-key basis.

| Field            | Type    | Default | Description |
| ---------------- | ------- | ------- | ----------- |
| `foreign_keys`   | boolean | `true`  | Enables SQLite foreign key constraints. |
| `journal_mode`   | string  | —       | One of `delete`, `truncate`, `persist`, `memory`, `wal`, `off`. Set once during creation; persisted in the file header. |
| `application_id` | number  | —       | Magic number identifying the file format. Set once during creation. |
| `user_version`   | number  | —       | Application-defined schema version counter. Set once during creation. |
| `page_size`      | number  | —       | Page size in bytes. Must be set before the first table is created. |
| `encoding`       | string  | —       | One of `UTF-8`, `UTF-16`, `UTF-16le`, `UTF-16be`. Must be set before the first table is created. |
| `auto_vacuum`    | string  | —       | One of `none`, `full`, `incremental`. Must be set before the first table is created. |

### 2.4 Backups

Before `smake release` modifies a `production` database, it copies the existing file to a sibling file with the current Unix timestamp appended to its name (e.g. `app.1750334221.db`), unless `backup` is set to `false`. This protects the live database against a failed or unexpected script run, since there is no disposable copy involved as there is with a normal build.

### 2.5 ORM Fields

If `orm` is set, SMake generates a TypeScript module with class definitions for all tables (and optionally views). With custom types, a separate `definitions.ts` module is generated alongside the database modules and imported automatically. If `validatorImport` is set, Zod validation schemas are generated for all types and columns.

| Field                | Type           | Default              | Description |
| -------------------- | -------------- | --------------------- | ----------- |
| `directory`          | string         | —                     | Target directory for all generated TypeScript modules. |
| `libraryImport`      | string         | `"litets"`            | Import path or alias for the ORM base library. |
| `validatorImport`    | string         | —                     | Import path or alias for Zod (e.g. `"zod"`). If omitted, no validation schemas are generated. |
| `definitionsPath`    | string         | `"./definitions.ts"`  | Target path where the definitions module is written by SMake. |
| `definitionsImport`  | string         | —                     | Import specifier under which the definitions module is referenced in generated code. Defaults to a relative import derived from `definitionsPath` if omitted. |
| `indent`             | number\|string | `1` (tab)             | `1` for tabs, 2–8 produces that many spaces, or pass a string directly. |
| `tableNaming`        | string         | `"PascalCase"`        | Naming convention for generated class names. One of `PascalCase`, `camelCase`, `snake_case`. |
| `columnNaming`       | string         | `"camelCase"`         | Naming convention for generated property names. |
| `typeNaming`         | string\|null   | `null`                | Naming convention for generated type and enum names. `null` leaves names unchanged. |
| `strippedSuffixes`   | string[]       | —                     | Column name suffixes to remove in generated property names. |
| `includingViews`     | boolean        | `true`                | If `true`, also generates classes for SQL views. |
| `useSafeIntegers`    | boolean        | `false`               | If `true`, columns with `INTEGER` affinity are typed as `bigint` in the ORM. See [Safe Integers](#safe-integers). |

#### Regenerating the ORM

`smake orm` reads metadata directly from an existing database without running any scripts. Since SQLite itself loses the link between a column and its custom type once the type is replaced by its affinity, SMake caches that link in a JSON file next to each database, named after it (e.g. `app.db` → `app.json`), written automatically on every build. `smake orm` reads this cache back in, merges in any `ormTypes` overrides, and regenerates the ORM classes from it.

This is useful whenever the generated TypeScript files were lost or need to be rebuilt without touching the database itself.

Without further arguments, `smake orm` requires a `smake.json` in the current directory and processes all databases listed there. It does not accept database names.

#### Direct Mode

If a database path and a target directory follow `smake orm`, SMake ignores any local `smake.json` and generates the ORM for that single database:

```sh
smake orm <db path> <orm dir> [--lib <import>] [--indent <n|string>]
```

| Argument / Option    | Description |
| -------------------- | ----------- |
| `<db path>`          | Path to the existing SQLite database. |
| `<orm dir>`          | Target directory for the generated TypeScript module, equivalent to `orm.directory`. |
| `--lib <import>`     | Import path or alias for the ORM base library, equivalent to `libraryImport`. |
| `--indent <n\|string>` | Indentation, equivalent to `indent`: a number from 1 to 8 or a literal string. |

All other ORM fields take their defaults from [2.5](#25-orm-fields). The schema name is derived from the file name of the database in PascalCase.

Since no `types` file is read in direct mode, no `definitions.ts` module and no Zod schemas are generated. Custom types are therefore not available as enums or domain types in the output. Columns are typed by their plain SQLite affinity. The cache file next to the database (e.g. `app.json`) is still read, but its type assignments only take effect in the generated classes if a `types` file defines them, so for domain types the `smake.json` mode is required.

```sh
smake orm ./portfolio.db ./orm/
smake orm ./portfolio.db ./orm/ --lib litets --indent 4
```

#### Safe Integers

SQLite stores integers with up to 64 bits, whereas a JavaScript `number` is exact only up to 2^53-1. With `useSafeIntegers` enabled, the generated ORM expects `bigint` for columns with `INTEGER` affinity, and the generated Zod schemas use `z.bigint()` accordingly. Columns with `REAL` or `NUMERIC` affinity are not affected.

The database driver has to be configured to return `bigint` as well, since otherwise the generated types do not match the runtime values: use `safeIntegers` for better-sqlite3 and `int64: true` for `@db/sqlite`. Both settings apply to all integers of a statement or connection.

Columns with a custom type are not affected either, because generated enums and type definitions stay `number`. Ensuring that their values fit into a `number` is the responsibility of the user.

### 2.6 ORM-Only Types

`ormTypes` assigns a custom type to a column purely for ORM generation, without requiring the column to actually be annotated with that type in SQL. This is useful in two situations: the original SQL source is no longer available and only the cache JSON or a bare database remains, or a column should be validated at the application level (via the generated Zod schema) while the database itself enforces no more than its plain SQLite affinity.

```json
"ormTypes": {
    "Item": {
        "status": "Status"
    }
}
```

The structure mirrors the database itself: table name, then column name, then custom type name. If a column already has a custom type from its SQL annotation, the value here takes precedence.


## 3 User-Defined SQL Functions

Scripts can call custom SQL functions by listing `.ts` source files under `functions`. Each module exports one or more functions whose name becomes the SQL function name directly:

```ts
export function slugify(value: string): string {
    return value.toLowerCase().replace(/\s+/g, "-");
}
```

The function is then available in SQL as `slugify(...)`.

The following built-in functions are always registered:

| Function                | Description |
| ----------------------- | ----------- |
| `readfile_text(path)`   | Reads a file and returns its contents as text. |
| `readfile_blob(path)`   | Reads a file and returns its contents as a blob. |
| `to_unix(value, unit?)` | Converts an ISO date string or numeric timestamp to Unix time in the given unit: `s` (default), `ms` / `milli`, `µs` / `micro`. |


## 4 Typing

When `types` is set, SMake reads the specified JSON file, an object mapping type names to domain descriptors. Each descriptor requires an `affinity` field (`TEXT`, `INTEGER`, `REAL`, `NUMERIC`, or `BLOB`) and accepts additional validation properties depending on the affinity. An optional `doc` field can be used to annotate any type with a description.

```json
{
    "Status": {
        "affinity": "TEXT",
        "values": ["Active", "Pending", "Archived"]
    },
    "Risk": {
        "affinity": "TEXT",
        "values": { "Low": "L", "Medium": "M", "High": "H", "Extreme": "E" }
    },
    "Score": {
        "affinity": "INTEGER",
        "min": 0,
        "max": 1000,
        "step": 5
    },
    "Color": {
        "affinity": "TEXT",
        "glob": "[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]",
        "regexp": "^[0-9A-F]{6}$"
    },
    "Thumbnail": {
        "affinity": "BLOB",
        "maxLength": 65536
    }
}
```

Unlike SQLite's own rules, SMake treats type names as case-sensitive.

Custom types are used directly as column type names in SQL:

```sql
create table Item (
    id Integer not null primary key,
    name Text not null,
    status Status not null,
    risk Risk not null,
    score Score not null,
    color Color not null,
    thumbnail Thumbnail
) strict;
```

During the build process, SMake replaces each custom type with its declared affinity and injects the corresponding check constraint into the table definition:

```sql
risk Text not null check (risk in ('L', 'M', 'H', 'E')),
```

### 4.1 Integer, Real, and Numeric

| Property | Combinable with | Notes |
| -------- | ---------------- | ----- |
| `values` | —                | Exclusive with all other properties. |
| `min`    | `max`, `step`    | Lower bound. |
| `max`    | `min`, `step`    | Upper bound. |
| `step`   | `min`, `max`     | Modulo constraint. |

Custom types with integer affinity are always typed as `number` in the ORM, regardless of `useSafeIntegers`.

### 4.2 Text

| Property    | Combinable with                       | Notes |
| ----------- | -------------------------------------- | ----- |
| `values`    | —                                      | Exclusive with all other properties. |
| `like`      | `regexp`                               | Exclusive with `glob`. |
| `glob`      | `regexp`                               | Exclusive with `like`. |
| `regexp`    | `like`, `glob`                         | ORM/TS only. |
| `length`    | `regexp`, `like`, `glob`               | Exact length; exclusive with `minLength`/`maxLength`. |
| `minLength` | `maxLength`, `regexp`, `like`, `glob`  | Exclusive with `length`. |
| `maxLength` | `minLength`, `regexp`, `like`, `glob`  | Exclusive with `length`. |
| `format`    | `since`, `until`                       | Exclusive with pattern/length properties. Accepted values: `date`, `time`, `datetime`. |
| `since`     | `format`, `until`                      | Requires `format`. |
| `until`     | `format`, `since`                      | Requires `format`. |

By default, SQLite does not provide native support for regular expression matching. The pattern specified under `regexp` is therefore intended for the ORM only.

### 4.3 Blob

| Property    | Combinable with | Notes |
| ----------- | ---------------- | ----- |
| `length`    | —                | Exact size in bytes. |
| `minLength` | `maxLength`      | Minimum size in bytes. |
| `maxLength` | `minLength`      | Maximum size in bytes. |
| `pattern`   | —                | Hex pattern or regex for byte sequences; ORM/TS only. |

### 4.4 Enums

Providing an object for `values` triggers the generation of a corresponding check constraint and, insofar as an ORM is produced, a TypeScript enum:

```ts
export enum Risk {
    Low = "L",
    Medium = "M",
    High = "H",
    Extreme = "E",
}
```

SMake uses the keys as enum members and the values as stored literals. Providing an array instead generates a union type for numeric affinities or a string enum for text affinities.