// Seeding is handled automatically by the test setup in retrieval.test.ts.
// No manual DB preparation required.

export type Fixture = {
	name: string;
	vectorQuery: string;
	ftsQuery: string;
	expectedFiles: string[];
	minMrr?: number;
	notes?: string;
};

export const fixtures: Fixture[] = [
	{
		name: "EN clean — Digital Signage Eldorado deployment",
		vectorQuery: "deploying digital signage screens in Eldorado",
		ftsQuery: "Digital Signage Eldorado deployment",
		expectedFiles: ["benchdata/Meetings/2026-01-14 with June and Pavel.md"],
		minMrr: 0.5,
		notes:
			"Synthetic meeting note that explicitly discusses deploying Digital Signage in Eldorado and theMillenium Garden deadline. Entirely in English with no diacritics, tests the basic full-text path.",
	},
	{
		name: "CZ accented — Darina e-shop kytice",
		vectorQuery: "Kdy jsem mluvil s Darinou o jejím e-shopu?",
		ftsQuery: "darina e-shop",
		expectedFiles: [
			"benchdata/Meetings/2026-03-10 about Darina's online store.md",
		],
		minMrr: 0.5,
		notes:
			"Synthetic meeting note about Darina's online flower/art store is 100% Czech and dense with accented terms (kytice, předobjednávky, ceník, pryskyřice). Tests that the indexed form retains diacritics and matches them correctly.",
	},
	{
		name: "CZ unaccented — same target with stripped diacritics",
		vectorQuery: "Kdy jsem mluvil s Darinou o jejim e-shopu?",
		ftsQuery: "darina e-shop",
		expectedFiles: [
			"benchdata/Meetings/2026-03-10 about Darina's online store.md",
		],
		minMrr: 0.5,
		notes:
			"Identical semantic target as fixture #2 but all háčky and čárky removed. Tests the unaccent/normalization code path that should fold both forms to the same tokens.",
	},
	{
		name: "Typo — misspelled surname Cerny (missing j + no háček)",
		vectorQuery: "Who's Valerij Černyj?",
		ftsQuery: "valerij cerny",
		expectedFiles: ["benchdata/People/Valerij Černyj.md"],
		minMrr: 0.4,
		notes:
			"The correct spelling is Černyj; stripping the háček and dropping the final 'j' gives 'Cerny'. Tests the fuzzy/trigram fallback path.",
	},
	{
		name: "Multi-file — CowQM across multiple meeting notes",
		vectorQuery: "background job queue for campaign processing with CowQM",
		ftsQuery: "CowQM campaign queue background jobs",
		expectedFiles: [
			"benchdata/Meetings/2026-04-02 1-1 with Nadia.md",
			"benchdata/Meetings/2026-05-07 1-1 with Nadia.md",
			"benchdata/Meetings/2026-06-11 1-1 with Nadia.md",
		],
		minMrr: 0.4,
		notes:
			"CowQM is discussed across many synthetic meeting files. Tests that the ranking returns multiple relevant documents.",
	},
	{
		name: "Cross-language person-specific note using subjective language - 'my girlfriend'",
		vectorQuery: "Who is my girlfriend?",
		ftsQuery: "my girlfriend",
		expectedFiles: ["benchdata/People/Jane Doe.md"],
		minMrr: 0.4,
		notes:
			"Tests that the system can handle subjective language ('my girlfriend') in a cross-language context and still retrieve the correct person note, which is in Czech but contains the key phrase.",
	},
	{
		name: "Daily notes — Millenium Garden panel RMA across three entries",
		vectorQuery: "What happened with the Millenium Garden screen panels?",
		ftsQuery: "Millenium Garden RMA panels",
		expectedFiles: [
			"benchdata/Daily/2026-01-29.md",
			"benchdata/Daily/2026-02-01.md",
			"benchdata/Daily/2026-02-11.md",
			"benchdata/Daily/2026-04-08.md",
		],
		minMrr: 0.4,
		notes:
			"The Millenium Garden panel RMA is tracked across three daily notes: artifacts first noticed and investigated (Jan 29), RMA finally opened (Feb 11), replacement panels arrived back (Apr 8). Tests that relevant information scattered across daily notes is retrieved, not just meeting notes.",
	},
	{
		name: "Cross-language daily notes — unified content pipeline proposal",
		vectorQuery:
			"writing and sharing the unified content pipeline proposal with the team",
		ftsQuery: "pipeline proposal",
		expectedFiles: [
			"benchdata/Daily/2026-03-26.md",
			"benchdata/Daily/2026-03-18.md",
			"benchdata/Daily/2026-03-11.md",
			"benchdata/Daily/2026-04-01.md",
		],
		minMrr: 0.4,
		notes:
			"2026-03-26 (English) describes writing the pipeline proposal draft with Valerij — unified config format, pluggable connectors, staging env. 2026-04-01 (Czech) records sending it out and the first reactions from Pavel and Milan. Same topic, two languages. Tests cross-language recall across daily notes.",
	},
];
