import { createHash } from "node:crypto";
import type { Config } from "@netlify/functions";
import { ZodError } from "zod";
import { artists, type ArtistProfile } from "../../src/data/artistProfile";
import {
	createPublicArtist,
	profileSubmissionSchema,
	type ProfileSubmission,
} from "../../src/data/profileSubmission";
import {
	queueGitHubSubmission,
	SubmissionConflictError,
	type ProposedSubmission,
} from "./github-submission.mts";
import {
	NotificationError,
	sendAdministratorNotification,
} from "./administrator-notification.mts";

export const MAX_REQUEST_BYTES = 64 * 1024;

interface PreparedSubmission extends ProposedSubmission {
	submitterEmail: string;
	upgradeNotifications: boolean;
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

function submissionFingerprint(submission: ProfileSubmission) {
	return createHash("sha256")
		.update(JSON.stringify(submission.profile))
		.digest("hex");
}

function artistIdentityFingerprint(submission: ProfileSubmission) {
	return createHash("sha256")
		.update(
			JSON.stringify({
				displayName: submission.profile.displayName.toLocaleLowerCase(),
				kingdom: submission.profile.kingdom.toLocaleLowerCase(),
			}),
		)
		.digest("hex");
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

	const fingerprint = submissionFingerprint(submission);
	const artistId = `artist-${artistIdentityFingerprint(submission).slice(0, 16)}`;
	const submissionId = `sub-${fingerprint.slice(16, 32)}`;
	if (existingProfiles.some((profile) => profile.id === artistId)) {
		throw new RequestError(409, "The proposed artist ID already exists.");
	}

	return {
		artist: createPublicArtist(submission.profile, artistId),
		branchName: `artist-submission/${artistId}-${submissionId.slice(4, 12)}`,
		submissionId,
		submitterEmail: submission.submitterEmail,
		upgradeNotifications: submission.upgradeNotifications,
	};
}

function validationDetails(error: ZodError) {
	return error.issues.slice(0, 20).map((issue) => ({
		field: issue.path.join("."),
		message: issue.message,
	}));
}

export async function handleProfileSubmission(
	request: Request,
	queueSubmission: typeof queueGitHubSubmission = queueGitHubSubmission,
	notifyAdministrators: typeof sendAdministratorNotification =
		sendAdministratorNotification,
) {
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
		const queued = await queueSubmission({
			artist: prepared.artist,
			branchName: prepared.branchName,
			submissionId: prepared.submissionId,
		});
		let notificationSent = true;
		try {
			await notifyAdministrators({
				artist: prepared.artist,
				pullRequestUrl: queued.pullRequestUrl,
				submissionId: queued.submissionId,
				submitterEmail: prepared.submitterEmail,
				upgradeNotifications: prepared.upgradeNotifications,
			});
		} catch (error) {
			notificationSent = false;
			console.error("Administrator notification failed:", {
				name: error instanceof Error ? error.name : "UnknownError",
				status: error instanceof NotificationError ? error.status : undefined,
				providerType:
					error instanceof NotificationError ? error.providerType : undefined,
				providerMessage:
					error instanceof NotificationError ? error.providerMessage : undefined,
				submissionId: queued.submissionId,
			});
		}

		// Do not log the prepared submission: it contains the private submitter email.
		return jsonResponse(
			{
				success: true,
				submissionId: queued.submissionId,
				notificationSent,
				message: notificationSent
					? "Your profile has been submitted for review."
					: "Your profile was received and is awaiting review. The administrator email could not be sent, but you do not need to resubmit.",
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
		if (error instanceof SubmissionConflictError) {
			return jsonResponse(
				{ success: false, message: error.message },
				409,
			);
		}

		if (error instanceof Error) {
			console.error("Profile submission failed:", {
				name: error.name,
				message: error.message,
				stack: error.stack,
			});
		} else {
			console.error("Profile submission failed: UnknownError");
		}
		return jsonResponse(
			{
				success: false,
				message: "The submission could not be processed. Please try again later.",
			},
			500,
		);
	}
}

export default function submitProfile(request: Request) {
	return handleProfileSubmission(request);
}

export const config: Config = {
	method: "POST",
};
