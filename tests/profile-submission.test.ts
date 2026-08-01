import assert from "node:assert/strict";
import test from "node:test";
import {
	MAX_REQUEST_BYTES,
	handleProfileSubmission,
	prepareSubmission,
} from "../netlify/functions/submit-profile.mts";
import { profileSubmissionSchema } from "../src/data/profileSubmission";

const endpoint = "http://localhost/.netlify/functions/submit-profile";

function validPayload() {
	return {
		profile: {
			displayName: "Test Artist",
			firstName: "Test",
			lastName: "Artist",
			kingdom: "Iron Mountains",
			homePark: "Example Park",
			skills: ["Leatherwork", "Sewing"],
			awards: ["Master Owl"],
			memberSince: "2020",
			biography: "Makes useful things.",
			photoUrl: "https://example.com/photo.jpg",
			contact: {
				website: "https://example.com",
			},
		},
		submitterEmail: "artist@example.com",
		consent: true,
		companyWebsite: "",
	};
}

function jsonRequest(payload: unknown, init: RequestInit = {}) {
	return new Request(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json", ...init.headers },
		body: JSON.stringify(payload),
		...init,
	});
}

test("rejects methods other than POST", async () => {
	const response = await handleProfileSubmission(
		new Request(endpoint, { method: "GET" }),
	);
	assert.equal(response.status, 405);
	assert.equal(response.headers.get("allow"), "POST");
	assert.deepEqual(await response.json(), {
		success: false,
		message: "Method not allowed.",
	});
});

test("rejects malformed JSON with a controlled response", async () => {
	const response = await handleProfileSubmission(
		new Request(endpoint, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not-json",
		}),
	);
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), {
		success: false,
		message: "The request body is not valid JSON.",
	});
});

test("rejects unsupported content types", async () => {
	const response = await handleProfileSubmission(
		new Request(endpoint, {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body: "{}",
		}),
	);
	assert.equal(response.status, 415);
});

test("rejects requests over the configured size limit", async () => {
	const response = await handleProfileSubmission(
		jsonRequest(validPayload(), {
			headers: {
				"content-type": "application/json",
				"content-length": String(MAX_REQUEST_BYTES + 1),
			},
		}),
	);
	assert.equal(response.status, 413);
	assert.equal((await response.json()).message, "The submission is too large.");
});

test("rejects invalid fields, duplicate list values, and insecure URLs", async () => {
	const payload = validPayload();
	payload.profile.kingdom = "Made Up Kingdom";
	payload.profile.skills = ["Sewing", " sewing "];
	payload.profile.photoUrl = "http://example.com/photo.jpg";
	payload.submitterEmail = "not-an-email";
	payload.consent = false;

	const response = await handleProfileSubmission(jsonRequest(payload));
	const body = await response.json();

	assert.equal(response.status, 400);
	assert.equal(body.success, false);
	assert.equal(body.message, "Please check the submitted profile.");
	assert.ok(Array.isArray(body.errors));
	assert.ok(body.errors.length >= 4);
	assert.equal(JSON.stringify(body).includes("stack"), false);
});

test("rejects a filled honeypot", async () => {
	const payload = validPayload();
	payload.companyWebsite = "bot content";

	const response = await handleProfileSubmission(jsonRequest(payload));
	assert.equal(response.status, 400);
	assert.equal((await response.json()).success, false);
});

test("rejects a profile that conflicts with the public directory", async () => {
	const payload = validPayload();
	payload.profile.displayName = "Adena Darkstar";
	payload.profile.kingdom = "Northern Lights";

	const response = await handleProfileSubmission(jsonRequest(payload));
	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), {
		success: false,
		message: "An artist with that display name already exists in this kingdom.",
	});
});

test("normalizes input and keeps private fields out of the public artist", () => {
	const payload = validPayload();
	payload.profile.displayName = "  Test   Artist  ";
	payload.profile.skills = ["  Leatherwork  ", "Sewing"];
	payload.profile.memberSince = "2020";
	payload.profile.contact.website = "https://EXAMPLE.com";
	payload.submitterEmail = "ARTIST@EXAMPLE.COM";

	const parsed = profileSubmissionSchema.parse(payload);
	const prepared = prepareSubmission(parsed, []);

	assert.equal(prepared.artist.displayName, "Test Artist");
	assert.deepEqual(prepared.artist.skills, ["Leatherwork", "Sewing"]);
	assert.equal(prepared.artist.memberSince, "Player Since 2020");
	assert.equal(prepared.artist.contact.website, "https://example.com/");
	assert.match(prepared.artist.id, /^artist-[a-f0-9]{16}$/);
	assert.match(prepared.submissionId, /^sub-[a-f0-9-]{36}$/);
	assert.equal(
		prepared.branchName,
		`profile-submission/${prepared.submissionId}`,
	);
	assert.equal(prepared.submitterEmail, "artist@example.com");
	assert.equal("submitterEmail" in prepared.artist, false);
	assert.equal("consent" in prepared.artist, false);
	assert.equal("companyWebsite" in prepared.artist, false);
});

test("returns a structured success response", async () => {
	const response = await handleProfileSubmission(jsonRequest(validPayload()));
	const body = await response.json();

	assert.equal(response.status, 201);
	assert.equal(body.success, true);
	assert.match(body.submissionId, /^sub-[a-f0-9-]{36}$/);
	assert.equal(body.message, "Your profile has been submitted for review.");
	assert.equal(response.headers.get("cache-control"), "no-store");
});

