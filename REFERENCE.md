# SMake Reference

## Build Configuration

SMake reads a single `smake.json` file in the current working directory. Global settings apply to all databases; per-database settings are nested under `databases`.

```json
{
    "types": "./custom-types.json",
    "orm": {
        "directory": "./orm/",
        "libraryPath": "litets",
        "zodPath": "zod",
        "includingViews": true,
        "tableNaming": "PascalCase",
        "columnNaming": "camelCase"
    },
    "databases": {
        "example1.db": {
            "strict": true,
            "metadata": ".metadata/example1.json",
            "schemaName": "Example1",
            "scripts": [
                "example1a.sql",
                "example1b.sql"
            ]
        },
        "example2.db": {
            "source": "base.db",
            "strict": true,
            "metadata": ".metadata/example2.json",
            "scripts": [
                "example2.sql"
            ]
        }
    }
}
```

### Global Fields

| Field       | Type   | Description |
| ----------- | ------ | ----------- |
| `databases` | object | Mapping of database file paths to their specific build configurations. |
| `types`     | string | Path to a JSON file containing type information shared across all databases. |
| `orm`       | object | Settings for automatic ORM generation, applied to all databases. |

### Per-Database Fields

| Field        | Type     | Description |
| ------------ | -------- | ----------- |
| `scripts`    | string[] | SQL script files executed sequentially on the database. |
| `strict`     | boolean  | Enables SQLite foreign key constraints; defaults to `true`. |
| `source`     | string   | Path to an existing database to be copied and extended instead of creating a new one. |
| `metadata`   | string   | If set, exports database metadata to this path (e.g. for third-party tooling). |
| `schemaName` | string   | Optional schema name for cross-database joins. |
| `functions`  | string[] | TypeScript modules exporting custom SQL functions available during the build. |

All fields except `scripts` are optional.

### ORM Fields

If `orm` is set, SMake generates a TypeScript module with class definitions for all tables (and optionally views). With custom types, a separate `definitions.ts` module is generated alongside the database modules and imported automatically. If `zodPath` is set, Zod validation schemas are generated for all types and columns.

| Field              | Type          | Default              | Description |
| ------------------ | ------------- | -------------------- | ----------- |
| `directory`        | string        | —                    | Target directory for all generated TypeScript modules. |
| `libraryPath`      | string        | `"litets"`           | Import path for the ORM base library. |
| `zodPath`          | string        | —                    | Import path for Zod (e.g. `"zod"`). If omitted, no validation schemas are generated. |
| `definitionsPath`  | string        | `"./definitions.ts"` | Relative path from the ORM directory to the type definitions module. |
| `indent`           | number\|string | `1` (tab)           | `1` for tabs, 2–8 produces that many spaces, or pass a string directly. |
| `tableNaming`      | string        | `"PascalCase"`       | Naming convention for generated class names. One of `PascalCase`, `camelCase`, `snake_case`. |
| `columnNaming`     | string        | `"camelCase"`        | Naming convention for generated property names. |
| `typeNaming`       | string\|null  | `null`               | Naming convention for generated type and enum names. `null` leaves names unchanged. |
| `strippedSuffixes` | string[]      | —                    | Column name suffixes to remove in generated property names. |
| `includingViews`   | boolean       | —                    | If `true`, also generates classes for SQL views. |


## User-Defined SQL Functions

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


## Typing

When `types` is set, SMake reads the specified JSON file — an object mapping type names to domain descriptors. Each descriptor requires an `affinity` field (`TEXT`, `INTEGER`, `REAL`, `NUMERIC`, or `BLOB`) and accepts additional validation properties depending on the affinity. An optional `doc` field can be used to annotate any type with a description.

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

### Integer, Real, and Numeric

| Property | Combinable with | Notes |
| -------- | --------------- | ----- |
| `values` | —               | Exclusive with all other properties. |
| `min`    | `max`, `step`   | Lower bound. |
| `max`    | `min`, `step`   | Upper bound. |
| `step`   | `min`, `max`    | Modulo constraint. |

### Text

| Property    | Combinable with                       | Notes |
| ----------- | ------------------------------------- | ----- |
| `values`    | —                                     | Exclusive with all other properties. |
| `like`      | `regexp`                              | Exclusive with `glob`. |
| `glob`      | `regexp`                              | Exclusive with `like`. |
| `regexp`    | `like`, `glob`                        | ORM/TS only. |
| `length`    | `regexp`, `like`, `glob`              | Exact length; exclusive with `minLength`/`maxLength`. |
| `minLength` | `maxLength`, `regexp`, `like`, `glob` | Exclusive with `length`. |
| `maxLength` | `minLength`, `regexp`, `like`, `glob` | Exclusive with `length`. |
| `format`    | `since`, `until`                      | Exclusive with pattern/length properties. Accepted values: `date`, `time`, `datetime`. |
| `since`     | `format`, `until`                     | Requires `format`. |
| `until`     | `format`, `since`                     | Requires `format`. |

By default, SQLite does not provide native support for regular expression matching. The pattern specified under `regexp` is therefore intended for the ORM only.

### Blob

| Property    | Combinable with | Notes |
| ----------- | --------------- | ----- |
| `length`    | —               | Exact size in bytes. |
| `minLength` | `maxLength`     | Minimum size in bytes. |
| `maxLength` | `minLength`     | Maximum size in bytes. |
| `pattern`   | —               | Hex pattern or regex for byte sequences; ORM/TS only. |

### Enums

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