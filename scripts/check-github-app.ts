import { createPrivateKey } from "node:crypto";
import {
	createGitHubAppJwt,
	getGitHubConfig,
	GitHubClient,
} from "../netlify/functions/github-submission.mts";

async function checkGitHubApp() {
	console.log("1. Reading GitHub configuration...");
	const config = getGitHubConfig();

	console.log("2. Parsing the private key...");
	createPrivateKey(config.privateKey);

	console.log("3. Signing a GitHub App JWT...");
	createGitHubAppJwt(config);

	console.log("4. Authenticating the installation and reading the base branch...");
	const client = new GitHubClient(config);
	const baseSha = await client.getBranchSha(config.baseBranch);

	console.log("5. Reading and validating directory.json from the base commit...");
	const directory = await client.getDirectory(baseSha);

	console.log(`GitHub App check passed. Validated ${directory.profiles.length} profiles.`);
}

checkGitHubApp().catch((error: unknown) => {
	console.error("GitHub App check failed.");
	if (error instanceof Error) {
		console.error(`Type: ${error.name}`);
		console.error(`Reason: ${error.message}`);
		console.error(error.stack);
	}
	process.exitCode = 1;
});
