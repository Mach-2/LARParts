import { createSign } from "node:crypto";
import { artistDirectorySchema, type ArtistProfile } from "../../src/data/artistProfile";

const GITHUB_API_URL = "https://api.github.com";
const DIRECTORY_PATH = "src/data/directory.json";

export interface GitHubSubmissionConfig {
	appId: string;
	installationId: string;
	privateKey: string;
	owner: string;
	repo: string;
	baseBranch: string;
	productionBranch: string;
}

export interface ProposedSubmission {
	artist: ArtistProfile;
	branchName: string;
	submissionId: string;
}

export interface QueuedSubmission {
	pullRequestUrl: string;
	submissionId: string;
}

interface GitHubContent {
	content: string;
	encoding: string;
	sha: string;
}

interface GitHubPullRequest {
	head: { ref: string };
	html_url: string;
	number: number;
}

export class GitHubOperationError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
	) {
		super(message);
	}
}

export class SubmissionConflictError extends Error {}

function requireEnvironment(name: string) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new GitHubOperationError(`Missing required environment variable: ${name}`);
	}
	return value;
}

export function getGitHubConfig(): GitHubSubmissionConfig {
	const config = {
		appId: requireEnvironment("GITHUB_APP_ID"),
		installationId: requireEnvironment("GITHUB_INSTALLATION_ID"),
		privateKey: requireEnvironment("GITHUB_PRIVATE_KEY").replaceAll("\\n", "\n"),
		owner: requireEnvironment("GITHUB_OWNER"),
		repo: requireEnvironment("GITHUB_REPO"),
		baseBranch: requireEnvironment("GITHUB_BASE_BRANCH"),
		productionBranch: requireEnvironment("GITHUB_PRODUCTION_BRANCH"),
	};

	if (config.baseBranch === config.productionBranch) {
		throw new GitHubOperationError(
			"The submission base branch must differ from the production branch.",
		);
	}
	return config;
}

function base64Url(value: string | Buffer) {
	return Buffer.from(value)
		.toString("base64")
		.replaceAll("=", "")
		.replaceAll("+", "-")
		.replaceAll("/", "_");
}

export function createGitHubAppJwt(config: GitHubSubmissionConfig, now = Date.now()) {
	const issuedAt = Math.floor(now / 1000) - 60;
	const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = base64Url(
		JSON.stringify({ iat: issuedAt, exp: issuedAt + 9 * 60, iss: config.appId }),
	);
	const unsignedToken = `${header}.${payload}`;
	const signer = createSign("RSA-SHA256");
	signer.update(unsignedToken);
	return `${unsignedToken}.${base64Url(signer.sign(config.privateKey))}`;
}

export class GitHubClient {
	private installationToken?: string;

	constructor(
		private readonly config: GitHubSubmissionConfig,
		private readonly fetchImplementation: typeof fetch = fetch,
	) {}

	private async request<T>(
		path: string,
		init: RequestInit = {},
		token?: string,
	): Promise<T> {
		const response = await this.fetchImplementation(`${GITHUB_API_URL}${path}`, {
			...init,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token ?? (await this.getInstallationToken())}`,
				"content-type": "application/json",
				"user-agent": "larparts-profile-submission",
				"x-github-api-version": "2026-03-10",
				...init.headers,
			},
		});

		if (!response.ok) {
			throw new GitHubOperationError(
				`GitHub operation failed with status ${response.status}`,
				response.status,
			);
		}

		if (response.status === 204) {
			return undefined as T;
		}
		return (await response.json()) as T;
	}

	private async getInstallationToken() {
		if (this.installationToken) {
			return this.installationToken;
		}
		const jwt = createGitHubAppJwt(this.config);
		const response = await this.request<{ token: string }>(
			`/app/installations/${encodeURIComponent(this.config.installationId)}/access_tokens`,
			{ method: "POST" },
			jwt,
		);
		this.installationToken = response.token;
		return response.token;
	}

	private repositoryPath(path: string) {
		return `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}${path}`;
	}

	async getBranchSha(branch: string) {
		const result = await this.request<{ object: { sha: string } }>(
			this.repositoryPath(`/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`),
		);
		return result.object.sha;
	}

	async getDirectory(branch: string) {
		const result = await this.request<GitHubContent>(
			this.repositoryPath(`/contents/${DIRECTORY_PATH}?ref=${encodeURIComponent(branch)}`),
		);
		if (result.encoding !== "base64") {
			throw new GitHubOperationError("Directory file used an unsupported encoding.");
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(Buffer.from(result.content, "base64").toString("utf8"));
		} catch {
			throw new GitHubOperationError("Directory file is not valid JSON.");
		}
		const validation = artistDirectorySchema.safeParse(parsed);
		if (!validation.success) {
			throw new GitHubOperationError("Directory data failed validation.");
		}
		return { profiles: validation.data, sha: result.sha };
	}

	async findOpenPullRequest(branchName: string) {
		const query = new URLSearchParams({
			state: "open",
			base: this.config.baseBranch,
			head: `${this.config.owner}:${branchName}`,
		});
		const pulls = await this.request<GitHubPullRequest[]>(
			this.repositoryPath(`/pulls?${query}`),
		);
		return pulls[0];
	}

	async findOpenArtistPullRequest(artistId: string) {
		const query = new URLSearchParams({
			state: "open",
			base: this.config.baseBranch,
			per_page: "100",
		});
		const pulls = await this.request<GitHubPullRequest[]>(
			this.repositoryPath(`/pulls?${query}`),
		);
		return pulls.find((pull) =>
			pull.head.ref.startsWith(`artist-submission/${artistId}-`),
		);
	}

	async createBranch(branchName: string, sha: string) {
		await this.request(this.repositoryPath("/git/refs"), {
			method: "POST",
			body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
		});
	}

	async deleteBranch(branchName: string) {
		await this.request(
			this.repositoryPath(`/git/refs/heads/${branchName.split("/").map(encodeURIComponent).join("/")}`),
			{ method: "DELETE" },
		);
	}

	async updateDirectory(
		branchName: string,
		fileSha: string,
		profiles: ArtistProfile[],
		displayName: string,
	) {
		const content = `${JSON.stringify(profiles, null, 2)}\n`;
		await this.request(this.repositoryPath(`/contents/${DIRECTORY_PATH}`), {
			method: "PUT",
			body: JSON.stringify({
				message: `Add artist profile: ${displayName}`,
				content: Buffer.from(content).toString("base64"),
				sha: fileSha,
				branch: branchName,
			}),
		});
	}

	async createPullRequest(proposal: ProposedSubmission) {
		return this.request<GitHubPullRequest>(this.repositoryPath("/pulls"), {
			method: "POST",
			body: JSON.stringify({
				title: `Add artist profile: ${proposal.artist.displayName}`,
				head: proposal.branchName,
				base: this.config.baseBranch,
				body: buildPullRequestBody(proposal),
			}),
		});
	}
}

export function insertArtist(
	profiles: ArtistProfile[],
	artist: ArtistProfile,
) {
	return [...profiles, artist];
}

function markdownValue(value?: string) {
	return value || "Not provided";
}

function markdownList(values: string[], emptyText: string) {
	return values.length > 0
		? values.map((value) => `- ${value}`).join("\n")
		: `_${emptyText}_`;
}

export function buildPullRequestBody(proposal: ProposedSubmission) {
	const { artist, submissionId } = proposal;
	const contacts = [
		["Website", artist.contact.website],
		["Instagram", artist.contact.instagram],
		["Facebook", artist.contact.facebook],
		["Discord", artist.contact.discord],
		["TikTok", artist.contact.tiktok],
		["Other", artist.contact.other],
	]
		.filter((contact): contact is [string, string] => Boolean(contact[1]))
		.map(([label, value]) => `- ${label}: ${value}`)
		.join("\n");

	return `## New artist profile submission

### ${artist.displayName}

**First name:** ${markdownValue(artist.firstName)}  
**Last name:** ${markdownValue(artist.lastName)}  
**Kingdom:** ${markdownValue(artist.kingdom)}  
**Home park:** ${markdownValue(artist.homePark)}  
**Member since:** ${markdownValue(artist.memberSince)}

### Biography

${artist.biography || "No biography provided."}

### Skills

${markdownList(artist.skills, "No skills provided.")}

### Awards

${markdownList(artist.awards, "No awards provided.")}

### Public contact information

${contacts || "_No public contact information provided._"}

### Submission information

**Submission reference:** ${submissionId}

The submitter's private email address is intentionally excluded from this pull request.

### Reviewer checklist

- [ ] The name and location information are correct
- [ ] The biography is appropriate for public display
- [ ] Skills and awards are formatted consistently
- [ ] Image permission has been confirmed, if applicable
- [ ] The profile is ready to be added to staging

If any items on the checklist require modifications to the artist's profile, such as correcting typos or modifying information, please resolve as follows: 
* Email the submitter to request permission to make changes
* Leave a comment on the pull request describing the requested changes and date the submitter was contacted
* Update the profile as necessary, and mark the checklist items as complete

### What happens after approval?

Merging this pull request adds the profile to the staging branch. It does not immediately publish the profile on the production website.

Approved profiles are published later when \`staging\` is merged into \`main\`.
`;
}

export async function queueGitHubSubmission(
	proposal: ProposedSubmission,
	config = getGitHubConfig(),
	client = new GitHubClient(config),
): Promise<QueuedSubmission> {
	const existingPullRequest = await client.findOpenPullRequest(proposal.branchName);
	if (existingPullRequest) {
		return {
			pullRequestUrl: existingPullRequest.html_url,
			submissionId: proposal.submissionId,
		};
	}
	const pendingArtistPullRequest = await client.findOpenArtistPullRequest(
		proposal.artist.id,
	);
	if (pendingArtistPullRequest) {
		throw new SubmissionConflictError(
			"A submission for this artist is already awaiting review.",
		);
	}

	const baseSha = await client.getBranchSha(config.baseBranch);
	const { profiles, sha: directorySha } = await client.getDirectory(baseSha);
	if (profiles.some((profile) => profile.id === proposal.artist.id)) {
		throw new SubmissionConflictError("The proposed artist ID already exists.");
	}
	if (
		profiles.some(
			(profile) =>
				profile.displayName.toLocaleLowerCase() ===
					proposal.artist.displayName.toLocaleLowerCase() &&
				profile.kingdom?.toLocaleLowerCase() ===
					proposal.artist.kingdom?.toLocaleLowerCase(),
		)
	) {
		throw new SubmissionConflictError(
			"An artist with that display name already exists in this kingdom.",
		);
	}

	try {
		await client.getBranchSha(proposal.branchName);
		const branchDirectory = await client.getDirectory(proposal.branchName);
		const branchArtist = branchDirectory.profiles.find(
			(profile) => profile.id === proposal.artist.id,
		);
		if (!branchArtist || JSON.stringify(branchArtist) !== JSON.stringify(proposal.artist)) {
			throw new SubmissionConflictError(
				"An existing submission branch contains different profile data.",
			);
		}
		try {
			const pullRequest = await client.createPullRequest(proposal);
			return {
				pullRequestUrl: pullRequest.html_url,
				submissionId: proposal.submissionId,
			};
		} catch (error) {
			console.error("Submission branch requires recovery:", proposal.branchName);
			throw error;
		}
	} catch (error) {
		if (!(error instanceof GitHubOperationError && error.status === 404)) {
			throw error;
		}
	}

	let branchCreated = false;
	let commitCreated = false;
	try {
		await client.createBranch(proposal.branchName, baseSha);
		branchCreated = true;
		await client.updateDirectory(
			proposal.branchName,
			directorySha,
			insertArtist(profiles, proposal.artist),
			proposal.artist.displayName,
		);
		commitCreated = true;
		const pullRequest = await client.createPullRequest(proposal);
		return {
			pullRequestUrl: pullRequest.html_url,
			submissionId: proposal.submissionId,
		};
	} catch (error) {
		if (branchCreated && !commitCreated) {
			try {
				await client.deleteBranch(proposal.branchName);
			} catch {
				console.error("Unable to clean up submission branch:", proposal.branchName);
			}
		} else if (commitCreated) {
			console.error("Submission branch requires recovery:", proposal.branchName);
		}
		throw error;
	}
}
