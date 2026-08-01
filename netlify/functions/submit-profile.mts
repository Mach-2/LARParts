import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import { ZodError } from "zod";
import { artists, type ArtistProfile } from "../../src/data/artistProfile";
import {
	createPublicArtist,
	profileSubmissionSchema,
	type ProfileSubmission,
} from "../../src/data/profileSubmission";

export const MAX_REQUEST_BYTES = 64 * 1024;

interface PreparedSubmission {
	artist: ArtistProfile;
	branchName: string;
	submissionId: string;
	submitterEmail: string;
}

class RequestError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function jsonResponse(body: object, status: number, headers?: HeadersInit) {
	return Response.json(body, {
		status,
		headers: {
			"cache-control": "no-store",
			...headers,
		},
	});
}

async function readLimitedBody(request: Request) {
	const declaredLength = Number(request.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
		throw new RequestError(413, "The submission is too large.");
	}

	if (!request.body) {
		return "";
	}

	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let byteCount = 0;
	let body = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		byteCount += value.byteLength;
		if (byteCount > MAX_REQUEST_BYTES) {
			await reader.cancel();
			throw new RequestError(413, "The submission is too large.");
		}
		body += decoder.decode(value, { stream: true });
	}

	return body + decoder.decode();
}

async function parseJsonRequest(request: Request) {
	const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
	if (!contentType.startsWith("application/json")) {
		throw new RequestError(415, "Send the submission as JSON.");
	}

	const body = await readLimitedBody(request);
	try {
		return JSON.parse(body);
	} catch {
		throw new RequestError(400, "The request body is not valid JSON.");
	}
}

function generateUniqueArtistId(existingProfiles: ArtistProfile[]) {
	const existingIds = new Set(existingProfiles.map((profile) => profile.id));
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const candidate = `artist-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
		if (!existingIds.has(candidate)) {
			return candidate;
		}
	}
	throw new Error("Unable to allocate artist ID");
}

export function findExistingProfileConflict(
	submission: ProfileSubmission,
	existingProfiles: ArtistProfile[],
) {
	const displayName = submission.profile.displayName.toLocaleLowerCase();
	const kingdom = submission.profile.kingdom.toLocaleLowerCase();
	return existingProfiles.some(
		(profile) =>
			profile.displayName.toLocaleLowerCase() === displayName &&
			profile.kingdom?.toLocaleLowerCase() === kingdom,
	);
}

export function prepareSubmission(
	submission: ProfileSubmission,
	existingProfiles: ArtistProfile[] = artists,
): PreparedSubmission {
	if (findExistingProfileConflict(submission, existingProfiles)) {
		throw new RequestError(
			409,
			"An artist with that display name already exists in this kingdom.",
		);
	}

	const submissionId = `sub-${randomUUID()}`;
	const artistId = generateUniqueArtistId(existingProfiles);

	return {
		artist: createPublicArtist(submission.profile, artistId),
		branchName: `profile-submission/${submissionId}`,
		submissionId,
		submitterEmail: submission.submitterEmail,
	};
}

function validationDetails(error: ZodError) {
	return error.issues.slice(0, 20).map((issue) => ({
		field: issue.path.join("."),
		message: issue.message,
	}));
}

export async function handleProfileSubmission(request: Request) {
	if (request.method !== "POST") {
		return jsonResponse(
			{ success: false, message: "Method not allowed." },
			405,
			{ allow: "POST" },
		);
	}

	try {
		const rawSubmission = await parseJsonRequest(request);
		const validation = profileSubmissionSchema.safeParse(rawSubmission);

		if (!validation.success) {
			return jsonResponse(
				{
					success: false,
					message: "Please check the submitted profile.",
					errors: validationDetails(validation.error),
				},
				400,
			);
		}

		const prepared = prepareSubmission(validation.data);

		// GitHub persistence and administrator notification are added in later phases.
		// Do not log the prepared submission: it contains the private submitter email.
		return jsonResponse(
			{
				success: true,
				submissionId: prepared.submissionId,
				message: "Your profile has been submitted for review.",
			},
			201,
		);
	} catch (error) {
		if (error instanceof RequestError) {
			return jsonResponse(
				{ success: false, message: error.message },
				error.status,
			);
		}

		console.error(
			"Profile submission failed:",
			error instanceof Error ? error.name : "UnknownError",
		);
		return jsonResponse(
			{
				success: false,
				message: "The submission could not be processed. Please try again later.",
			},
			500,
		);
	}
}

export default handleProfileSubmission;

export const config: Config = {
	path: "/.netlify/functions/submit-profile",
	method: "POST",
	rateLimit: {
		windowLimit: 5,
		windowSize: 60,
		aggregateBy: ["ip", "domain"],
	},
};

