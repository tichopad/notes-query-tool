// Seed DB before running bench:
//   rm -rf dbdata/
//   bun run db:migrate
//   bun dev load --glob 'testdata/**/*.md'

export type Fixture = {
	name: string;
	query: string;
	expectedFiles: string[];
	minMrr?: number;
	notes?: string;
};

export const fixtures: Fixture[] = [
	{
		name: "EN clean — Digital Signage Colorado deployment",
		query: "Digital Signage Colorado deployment",
		expectedFiles: ["testdata/Meetings/2025-10-21 with Rob and Ivan.md"],
		minMrr: 0.5,
		notes:
			"The only file that explicitly discusses deploying Digital Signage in Colorado and the Century Park deadline. Entirely in English with no diacritics, tests the basic full-text path.",
	},
	{
		name: "CZ accented — Armi e-shop kytice",
		query: "Armi e-shop kytice předobjednávky",
		expectedFiles: [
			"testdata/Meetings/2025-12-10 about Armi's online store.md",
		],
		minMrr: 0.5,
		notes:
			"The meeting note about Armi's online flower/art store is 100% Czech and dense with accented terms (kytice, předobjednávky, ceník, pryskyřice). Tests that the indexed form retains diacritics and matches them correctly.",
	},
	{
		name: "CZ unaccented — same target with stripped diacritics",
		query: "Armi e-shop kytice predobjednavky",
		expectedFiles: [
			"testdata/Meetings/2025-12-10 about Armi's online store.md",
		],
		minMrr: 0.5,
		notes:
			"Identical semantic target as fixture #2 but all háčky and čárky removed. Tests the unaccent/normalization code path that should fold both forms to the same tokens.",
	},
	{
		name: "Typo — misspelled surname Kulcycky (missing j)",
		query: "Bohdan Kulcycky",
		expectedFiles: ["testdata/People/Bohdan Kulčyckyj.md"],
		minMrr: 0.4,
		notes:
			"The correct spelling is Kulčyckyj; dropping the final 'j' and stripping the háček gives 'Kulcycky'. Tests the fuzzy/trigram fallback path.",
	},
	{
		name: "Multi-file — BullMQ across multiple meeting notes",
		query: "BullMQ campaign queue",
		expectedFiles: [
			"testdata/Meetings/2025-10-15 1-1 with Bohdan.md",
			"testdata/Meetings/2025-11-12 1-1 with Bohdan.md",
			"testdata/Meetings/2025-12-11 1-1 with Bohdan.md",
		],
		minMrr: 0.4,
		notes:
			"BullMQ is discussed across many meeting files. Tests that the ranking returns multiple relevant documents.",
	},
];
