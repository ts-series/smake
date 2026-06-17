create table if not exists Model (
		-- Versioned trading algorithms.
	name Text not null,
		-- For simplicity, contains abbreviation and version of the model in one.
	release_date Text not null,
	deprecated Integer not null default 0 check (deprecated in (0, 1)),
		-- Is this model outdated and should no longer be used?

	constraint "Model — name as primary key" primary key (name),

	constraint "Model — valid date format: YYYY-MM-DD" check (
		length(release_date) = 10 and julianday(release_date) is not null
	)
) without rowid;