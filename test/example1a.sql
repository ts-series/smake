create table if not exists Option (
		-- Selection options for specific fields.
	section Status not null,
	name Serial not null,
	value Score,
	primary key (section, name)
) without rowid;