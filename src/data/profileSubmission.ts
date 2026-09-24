import { z } from "zod";
import kingdomDefinitions from "./kingdoms.json";
import {
	artistProfileSchema,
	type ArtistProfile,
} from "./artistProfile";

const kingdomNames = new Set(
	kingdomDefinitions.map((definition) => definition.name),
);

function collapseWhitespace(value: string) {
	return value.trim().replace(/\s+/g, " ");
}

function optionalText(maximum: number) {
	return z.preprocess(
		(value) =>
			typeof value === "string" && value.trim() === "" ? undefined : value,
		z.string().transform(collapseWhitespace).pipe(z.string().max(maximum)).optional(),
	);
}

function isHttpsUrl(value: string) {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function normalizeUrl(value: string) {
	return new URL(value).toString();
}

function optionalHttpsUrl() {
	return z.preprocess(
		(value) =>
			typeof value === "string" && value.trim() === "" ? undefined : value,
		z
			.string()
			.trim()
			.max(500)
			.refine(isHttpsUrl, "Enter a complete HTTPS URL.")
			.transform(normalizeUrl)
			.optional(),
	);
}

function uniqueTextList(label: string, maximumItems: number, maximumLength: number) {
	return z
		.array(
			z
				.string()
				.transform(collapseWhitespace)
				.pipe(z.string().min(1).max(maximumLength)),
		)
		.max(maximumItems)
		.superRefine((items, context) => {
			const seen = new Set<string>();
			for (const [index, item] of items.entries()) {
				const normalized = item.toLocaleLowerCase();
				if (seen.has(normalized)) {
					context.addIssue({
						code: "custom",
						message: `Duplicate ${label}: ${item}`,
						path: [index],
					});
				}
				seen.add(normalized);
			}
		});
}

const requiredName = (maximum: number) =>
	z
		.string()
		.transform(collapseWhitespace)
		.pipe(z.string().min(1).max(maximum));

export const publicProfileSubmissionSchema = z
	.object({
		displayName: requiredName(100),
		kingdom: z
			.string()
			.transform(collapseWhitespace)
			.refine((kingdom) => kingdomNames.has(kingdom), "Choose a valid kingdom."),
		homePark: requiredName(100),
		skills: uniqueTextList("skill", 20, 80).min(1),
		awards: uniqueTextList("award", 10, 120),
		memberSince: optionalText(100).transform((value) =>
			value && /^\d{4}$/.test(value) ? `Player Since ${value}` : value,
		),
		biography: z.preprocess(
			(value) =>
				typeof value === "string" && value.trim() === "" ? undefined : value,
			z.string().trim().max(1000).optional(),
		),
		contact: z
			.object({
				website: optionalHttpsUrl(),
				instagram: optionalHttpsUrl(),
				facebook: optionalHttpsUrl(),
				discord: optionalHttpsUrl(),
				tiktok: optionalHttpsUrl(),
				other: optionalHttpsUrl(),
			})
			.strict(),
		photoUrl: optionalHttpsUrl(),
	})
	.strict();

export const profileSubmissionSchema = z
	.object({
		profile: publicProfileSubmissionSchema,
		submitterEmail: z
			.string()
			.trim()
			.max(254)
			.pipe(z.email("Enter a valid email address."))
			.transform((email) => email.toLocaleLowerCase()),
		upgradeNotifications: z.boolean(),
		consent: z.literal(true, {
			error: "Consent is required.",
		}),
		companyWebsite: z.string().max(0, "Invalid submission."),
	})
	.strict();

export type ProfileSubmission = z.infer<typeof profileSubmissionSchema>;

export function createPublicArtist(
	profile: z.infer<typeof publicProfileSubmissionSchema>,
	id: string,
): ArtistProfile {
	return artistProfileSchema.parse({
		id,
		...profile,
	});
}
