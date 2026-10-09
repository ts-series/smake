# Changelog

## 2.2

Replaced the standalone `strict` flag with a structured `pragmas` object, supporting `foreign_keys`, `journal_mode`, `application_id`, `user_version`, `page_size`, `encoding`, and `auto_vacuum`. Pragmas can be set globally and overridden per database.

Renamed `orm.libraryPath` to `libraryImport` and `orm.zodPath` to `validatorImport`. Decoupled the definitions module's write target from its import path: `definitionsPath` controls where it is written, while the new `definitionsImport` controls how it is referenced in generated code, defaulting to a relative import derived from `definitionsPath`.

Added a direct mode for `smake orm`: `smake orm <db> <dir>` generates the ORM for a single database without a `smake.json`.

Added the ORM option `useSafeIntegers`, which types `INTEGER` columns as `bigint`.


## 2.1

Introduced global settings in SMake and restructured the project overall.


## 2.0

Rewritten in TypeScript on Deno, with the project split into separate modules and custom types added.

Advantage: SMake can be distributed as a single binary with all dependencies, cross-platform, and runs significantly faster.


## 1.0

First implementation as a single Python script that read a `smake.json` file describing one or more database builds and executed the listed SQL scripts against each target database.