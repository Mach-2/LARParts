import { z } from "zod";

export interface ArtistContact {
	website?: string;
	instagram?: string;
	facebook?: string;
	discord?: string;
	tiktok?: string;
	other?: string;
}

export interface ArtistProfile {
	id: string;
	displayName: string;
	kingdom?: string;
	homePark?: string;
	awards: string[];
	skills: string[];
	memberSince?: string;
	biography?: string;
	contact: ArtistContact;
	photoUrl?: string;
}

const optionalNonEmptyString = z.string().trim().min(1).optional();

export const artistContactSchema = z
	.object({
		website: optionalNonEmptyString,
		instagram: optionalNonEmptyString,
		facebook: optionalNonEmptyString,
		discord: optionalNonEmptyString,
		tiktok: optionalNonEmptyString,
		other: optionalNonEmptyString,
	})
	.strict();

export const artistProfileSchema: z.ZodType<ArtistProfile> = z
	.object({
		id: z
			.string()
			.trim()
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "ID must be URL-safe"),
		displayName: z.string().trim().min(1),
		kingdom: optionalNonEmptyString,
		homePark: optionalNonEmptyString,
		awards: z.array(z.string().trim().min(1)),
		skills: z.array(z.string().trim().min(1)),
		memberSince: optionalNonEmptyString,
		biography: optionalNonEmptyString,
		contact: artistContactSchema,
		photoUrl: z
			.string()
			.trim()
			.regex(
				/^(?:\/photos\/[^/?#]+|https:\/\/.+)$/i,
				"Photo must be an HTTPS URL or a root-relative file in /photos",
			)
			.optional(),
	})
	.strict();

export const artistDirectorySchema = z
	.array(artistProfileSchema)
	.superRefine((profiles, context) => {
		const seenIds = new Set<string>();
		const seenIdentities = new Set<string>();

		for (const [index, profile] of profiles.entries()) {
			if (seenIds.has(profile.id)) {
				context.addIssue({
					code: "custom",
					message: `Duplicate artist ID: ${profile.id}`,
					path: [index, "id"],
				});
			}

			seenIds.add(profile.id);
			const identity = JSON.stringify([profile.displayName.toLowerCase(), profile.kingdom?.toLowerCase() ?? ""]);
			if (seenIdentities.has(identity)) {
				context.addIssue({ code: "custom", message: "Duplicate artist name and kingdom", path: [index, "displayName"] });
			}
			seenIdentities.add(identity);
		}
	});

export function parseArtistFiles(files: Record<string, unknown>): ArtistProfile[] {
	const profiles = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => {
		const profile = artistProfileSchema.parse(data);
		if (path.split("/").at(-1) !== `${profile.id}.json`) {
			throw new Error(`Artist filename must match its ID: ${path}`);
		}
		return profile;
	});
	return artistDirectorySchema.parse(profiles);
}
