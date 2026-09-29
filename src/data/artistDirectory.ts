import { parseArtistFiles } from "./artistProfile";

export const artists = parseArtistFiles(
	import.meta.glob("./artists/*.json", { eager: true, import: "default" }),
);
