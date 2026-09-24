export const artistTitles = [
	"Serpent Knight",
	"Master Dragon",
	"Master Owl",
	"Master Garber",
] as const;

export type ArtistTitle = (typeof artistTitles)[number];