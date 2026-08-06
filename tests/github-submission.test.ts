import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
	buildPullRequestBody,
	GitHubClient,
	insertArtist,
	queueGitHubSubmission,
	type GitHubSubmissionConfig,
	type ProposedSubmission,
} from "../netlify/functions/github-submission.mts";
import { artists, type ArtistProfile } from "../src/data/artistProfile";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
	.privateKey.export({ type: "pkcs8", format: "pem" })
	.toString();

const config: GitHubSubmissionConfig = {
	appId: "12345",
	installationId: "67890",
	privateKey,
	owner: "Mach-2",
	repo: "LARParts",
	baseBranch: "staging",
	productionBranch: "main",
};

const artist: ArtistProfile = {
	id: "artist-0123456789abcdef",
	firstName: "Test",
	lastName: "Artist",
	displayName: "Test Artist",
	kingdom: "Iron Mountains",
	homePark: "Example Park",
	awards: [],
	skills: ["Sewing", "Leatherwork"],
	memberSince: "Player Since 2020",
	biography: "Makes useful things.",
	contact: { website: "https://example.com/" },
};

const proposal: ProposedSubmission = {
	artist,
	branchName: "artist-submission/artist-0123456789abcdef-a1b2c3d4",
	submissionId: "sub-a1b2c3d4e5f60708",
};

function jsonResponse(value: unknown, status = 200) {
	return Response.json(value, { status });
}

test("inserts new artists before placeholder records", () => {
	const inserted = insertArtist(artists, artist);
	const artistIndex = inserted.findIndex((profile) => profile.id === artist.id);
	const placeholderIndex = inserted.findIndex((profile) =>
		profile.id.startsWith("placeholder-"),
	);
	assert.equal(artistIndex, placeholderIndex - 1);
	assert.equal(inserted.length, artists.length + 1);
});

test("builds a readable pull request body without private email", () => {
	const body = buildPullRequestBody(proposal);
	assert.match(body, /## New artist profile submission/);
	assert.match(body, /### Test Artist/);
	assert.match(body, /- Sewing/);
	assert.match(body, /_No awards provided\._/);
	assert.match(body, /Website: https:\/\/example\.com\//);
	assert.match(body, /Submission reference:\*\* sub-a1b2c3d4e5f60708/);
	assert.match(body, /merged into `main`/);
	assert.equal(body.includes("artist@example.com"), false);
});

test("creates a branch, one directory commit, and a pull request against staging", async () => {
	const calls: Array<{ body?: unknown; method: string; url: string }> = [];
	const fetchMock: typeof fetch = async (input, init = {}) => {
		const url = String(input);
		const method = init.method ?? "GET";
		const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ body, method, url });

		if (url.includes("/access_tokens")) return jsonResponse({ token: "installation-token" });
		if (url.includes("/pulls?") && method === "GET") return jsonResponse([]);
		if (url.endsWith("/git/ref/heads/staging")) return jsonResponse({ object: { sha: "base-sha" } });
		if (url.includes("/contents/src/data/directory.json?ref=base-sha")) {
			return jsonResponse({
				content: Buffer.from(`${JSON.stringify(artists, null, 2)}\n`).toString("base64"),
				encoding: "base64",
				sha: "directory-sha",
			});
		}
		if (url.includes("/git/ref/heads/artist-submission/")) {
			return jsonResponse({ message: "Not Found" }, 404);
		}
		if (url.endsWith("/git/refs") && method === "POST") return jsonResponse({}, 201);
		if (url.endsWith("/contents/src/data/directory.json") && method === "PUT") return jsonResponse({}, 200);
		if (url.endsWith("/pulls") && method === "POST") {
			return jsonResponse({ html_url: "https://github.com/Mach-2/LARParts/pull/123", number: 123, head: { ref: proposal.branchName } }, 201);
		}
		throw new Error(`Unexpected GitHub request: ${method} ${url}`);
	};

	const result = await queueGitHubSubmission(
		proposal,
		config,
		new GitHubClient(config, fetchMock),
	);

	assert.equal(result.pullRequestUrl, "https://github.com/Mach-2/LARParts/pull/123");
	const branchCall = calls.find((call) => call.url.endsWith("/git/refs"));
	assert.deepEqual(branchCall?.body, {
		ref: `refs/heads/${proposal.branchName}`,
		sha: "base-sha",
	});
	const contentCalls = calls.filter((call) => call.url.includes("/contents/"));
	assert.equal(contentCalls.length, 2);
	const updateBody = contentCalls.find((call) => call.method === "PUT")?.body as {
		branch: string;
		content: string;
		message: string;
	};
	assert.equal(updateBody.branch, proposal.branchName);
	assert.equal(updateBody.message, "Add artist profile: Test Artist");
	const updatedProfiles = JSON.parse(Buffer.from(updateBody.content, "base64").toString("utf8"));
	assert.equal(updatedProfiles.filter((profile: ArtistProfile) => profile.id === artist.id).length, 1);
	assert.equal(JSON.stringify(updatedProfiles).includes("submitterEmail"), false);
	const pullBody = calls.find(
		(call) => call.url.endsWith("/pulls") && call.method === "POST",
	)?.body as { base: string; head: string; title: string };
	assert.equal(pullBody.base, "staging");
	assert.equal(pullBody.head, proposal.branchName);
	assert.equal(pullBody.title, "Add artist profile: Test Artist");
});

test("reuses a committed orphan branch when retrying pull-request creation", async () => {
	let branchCreateCount = 0;
	const branchProfiles = insertArtist(artists, artist);
	const fetchMock: typeof fetch = async (input, init = {}) => {
		const url = String(input);
		const method = init.method ?? "GET";
		if (url.includes("/access_tokens")) return jsonResponse({ token: "installation-token" });
		if (url.includes("/pulls?") && method === "GET") return jsonResponse([]);
		if (url.endsWith("/git/ref/heads/staging")) return jsonResponse({ object: { sha: "base-sha" } });
		if (url.includes("/contents/src/data/directory.json?ref=base-sha")) {
			return jsonResponse({ content: Buffer.from(JSON.stringify(artists)).toString("base64"), encoding: "base64", sha: "directory-sha" });
		}
		if (url.includes("/git/ref/heads/artist-submission/")) return jsonResponse({ object: { sha: "branch-sha" } });
		if (url.includes(`/contents/src/data/directory.json?ref=${encodeURIComponent(proposal.branchName)}`)) {
			return jsonResponse({ content: Buffer.from(JSON.stringify(branchProfiles)).toString("base64"), encoding: "base64", sha: "branch-directory-sha" });
		}
		if (url.endsWith("/git/refs") && method === "POST") {
			branchCreateCount += 1;
			return jsonResponse({}, 201);
		}
		if (url.endsWith("/pulls") && method === "POST") {
			return jsonResponse({ html_url: "https://github.com/Mach-2/LARParts/pull/124", number: 124, head: { ref: proposal.branchName } }, 201);
		}
		throw new Error(`Unexpected GitHub request: ${method} ${url}`);
	};

	const result = await queueGitHubSubmission(
		proposal,
		config,
		new GitHubClient(config, fetchMock),
	);
	assert.equal(result.pullRequestUrl, "https://github.com/Mach-2/LARParts/pull/124");
	assert.equal(branchCreateCount, 0);
});

test("reuses an existing open pull request without creating another branch", async () => {
	const mutationMethods: string[] = [];
	const fetchMock: typeof fetch = async (input, init = {}) => {
		const url = String(input);
		const method = init.method ?? "GET";
		if (method !== "GET") mutationMethods.push(method);
		if (url.includes("/access_tokens")) return jsonResponse({ token: "installation-token" });
		if (url.includes("/pulls?")) {
			return jsonResponse([
				{ html_url: "https://github.com/Mach-2/LARParts/pull/123", number: 123, head: { ref: proposal.branchName } },
			]);
		}
		throw new Error(`Unexpected GitHub request: ${method} ${url}`);
	};

	const result = await queueGitHubSubmission(
		proposal,
		config,
		new GitHubClient(config, fetchMock),
	);
	assert.equal(result.pullRequestUrl, "https://github.com/Mach-2/LARParts/pull/123");
	assert.deepEqual(mutationMethods, ["POST"]); // Installation-token request only.
});
