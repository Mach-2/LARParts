import { z } from "zod";
import type { ArtistProfile } from "../../src/data/artistProfile";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

interface NotificationConfig {
	apiKey: string;
	from: string;
	recipients: string[];
}

export interface AdministratorNotification {
	artist: ArtistProfile;
	pullRequestUrl: string;
	submissionId: string;
	submitterEmail: string;
	upgradeNotifications: boolean;
}

export class NotificationError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly providerType?: string,
		public readonly providerMessage?: string,
	) {
		super(message);
		this.name = "NotificationError";
	}
}

function redactEmailAddresses(value: string) {
	return value.replace(
		/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
		"[redacted email]",
	);
}

function requireEnvironment(name: string) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new NotificationError(`Missing required environment variable: ${name}`);
	}
	return value;
}

export function getNotificationConfig(): NotificationConfig {
	const recipients = requireEnvironment("NOTIFICATION_EMAILS")
		.split(",")
		.map((email) => email.trim())
		.filter(Boolean);
	const recipientValidation = z.array(z.email()).min(1).safeParse(recipients);
	if (!recipientValidation.success) {
		throw new NotificationError("NOTIFICATION_EMAILS contains no valid addresses.");
	}

	return {
		apiKey: requireEnvironment("EMAIL_PROVIDER_API_KEY"),
		from: requireEnvironment("FROM_EMAIL"),
		recipients: recipientValidation.data,
	};
}

export function buildNotificationText(notification: AdministratorNotification) {
	const {
		artist,
		pullRequestUrl,
		submissionId,
		submitterEmail,
		upgradeNotifications,
	} = notification;
	return `A new artist profile has been submitted.

Artist: ${artist.displayName}
Kingdom: ${artist.kingdom || "Not provided"}
Home park: ${artist.homePark || "Not provided"}
Submission reference: ${submissionId}
Submitter email: ${submitterEmail}
Future LARParts upgrade notifications: ${upgradeNotifications ? "Opted in" : "Not opted in"}

Review the proposed profile:
${pullRequestUrl}

Merging the pull request adds the profile to staging. The profile will be published after staging is merged into main and Netlify completes the next production build.

No reply is required.`;
}

export async function sendAdministratorNotification(
	notification: AdministratorNotification,
	config = getNotificationConfig(),
	fetchImplementation: typeof fetch = fetch,
) {
	const response = await fetchImplementation(RESEND_EMAIL_ENDPOINT, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.apiKey}`,
			"content-type": "application/json",
			"idempotency-key": `artist-profile-${notification.submissionId}`,
			"user-agent": "larparts-profile-submission/1.0",
		},
		body: JSON.stringify({
			from: config.from,
			to: config.recipients,
			subject: `Artist profile awaiting review: ${notification.artist.displayName}`,
			text: buildNotificationText(notification),
		}),
	});

	if (!response.ok) {
		let providerType: string | undefined;
		let providerMessage: string | undefined;
		try {
			const providerError = (await response.json()) as {
				message?: unknown;
				name?: unknown;
			};
			providerType =
				typeof providerError.name === "string" ? providerError.name : undefined;
			providerMessage =
				typeof providerError.message === "string"
					? redactEmailAddresses(providerError.message)
					: undefined;
		} catch {
			// Some provider failures do not contain JSON.
		}
		throw new NotificationError(
			"Email provider rejected the notification.",
			response.status,
			providerType,
			providerMessage,
		);
	}
}
