create table if not exists Currency (
		-- Bundles fiat and cryptocurrencies, since on exchanges (as possible assets in trading pairs) or with payment services, these exist side by side.
	symbol Text not null,
		-- Currency symbol according to ISO 4217 or widely adopted symbols as used by major crypto exchanges.
	logo Text default null check (logo <> ''),
		-- SVG graphics for the UI.
	minor_unit Integer default null,
		-- Number of possible decimal places after the decimal point.
	minor_unit_name Text default null,
	minor_unit_abbr Text default null,
	
	constraint "Currency — symbol as primary key" primary key (symbol),

	constraint "Currency — plausible information on the minor unit" check (
		   minor_unit is null and minor_unit_name is null and minor_unit_abbr is null
		or minor_unit is not null and (minor_unit_name is not null or minor_unit_abbr is null)
	)
) without rowid;