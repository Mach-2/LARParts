import assert from "node:assert/strict";
import test from "node:test";
import {
	buildNotificationText,
	NotificationError,
	sendAdministratorNotification,
} from "../netlify/functions/administrator-notification.mts";
import type { ArtistProfile } from "../src/data/artistProfile";

const artist: ArtistProfile = {
	id: "artist-0123456789abcdef",
	firstName: "Test",
	lastName: "Artist",
	displayName: "Test Artist",
	kingdom: "Iron Mountains",
	homePark: "Example Park",
	awards: ["Master Owl"],
	skills: ["Sewing"],
	biography: "Private details are unnecessary here.",
	contact: { website: "https://example.com/" },
};

const notification = {
	artist,
	pullRequestUrl: "https://github.com/Mach-2/LARParts/pull/123",
	submissionId: "sub-a1b2c3d4e5f60708",
	submitterEmail: "artist@example.com",
	upgradeNotifications: true,
};

const config = {
	apiKey: "test-api-key",
	from: "LARParts <notifications@example.com>",
	recipients: ["admin-one@example.com", "admin-two@example.com"],
};

test("builds a concise notification with the authenticated PR link", () => {
	const text = buildNotificationText(notification);
	assert.match(text, /Artist: Test Artist/);
	assert.match(text, /Kingdom: Iron Mountains/);
	assert.match(text, /Home park: Example Park/);
	assert.match(text, /Submission reference: sub-a1b2c3d4e5f60708/);
	assert.match(text, /Submitter email: artist@example\.com/);
	assert.match(text, /Future LARParts upgrade notifications: Opted in/);
	assert.match(text, /https:\/\/github\.com\/Mach-2\/LARParts\/pull\/123/);
	assert.match(text, /staging is merged into main/);
	assert.match(text, /No reply is required/);
	assert.equal(text.includes(artist.biography ?? ""), false);
	assert.equal(text.includes(artist.contact.website ?? ""), false);
});

test("sends to every configured administrator with an idempotency key", async () => {
	let requestBody: Record<string, unknown> = {};
	let requestHeaders = new Headers();
	const fetchMock: typeof fetch = async (_input, init = {}) => {
		requestBody = JSON.parse(String(init.body));
		requestHeaders = new Headers(init.headers);
		return Response.json({ id: "email-id" });
	};

	await sendAdministratorNotification(notification, config, fetchMock);

	assert.deepEqual(requestBody.to, config.recipients);
	assert.equal(requestBody.from, config.from);
	assert.equal(
		requestBody.subject,
		"Artist profile awaiting review: Test Artist",
	);
	assert.equal(
		requestHeaders.get("idempotency-key"),
		"artist-profile-sub-a1b2c3d4e5f60708",
	);
	assert.equal(
		requestHeaders.get("user-agent"),
		"larparts-profile-submission/1.0",
	);
	assert.equal(JSON.stringify(requestBody).includes("test-api-key"), false);
});

test("throws a controlled error when the provider rejects the email", async () => {
	const fetchMock: typeof fetch = async () =>
		Response.json(
			{
				name: "validation_error",
				message: "The sender user@example.com is not allowed.",
			},
			{ status: 422 },
		);

	await assert.rejects(
		sendAdministratorNotification(notification, config, fetchMock),
		(error: unknown) =>
			error instanceof NotificationError &&
			error.status === 422 &&
			error.providerType === "validation_error" &&
			error.providerMessage ===
				"The sender [redacted email] is not allowed." &&
			error.message === "Email provider rejected the notification.",
	);
});
