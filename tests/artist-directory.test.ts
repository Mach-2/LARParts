import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseArtistFiles } from "../src/data/artistProfile";

const directory = new URL("../src/data/artists/", import.meta.url);
const files = Object.fromEntries(readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => [name, JSON.parse(readFileSync(new URL(name, directory), "utf8"))]));
const artists = parseArtistFiles(files);

test("loads all checked-in artist files and rejects invalid records", () => {
	assert.ok(artists.length > 0);
	assert.throws(() => parseArtistFiles({ "wrong-id.json": artists[0] }), /filename/);
	assert.throws(() => parseArtistFiles({ [`${artists[0].id}.json`]: { ...artists[0], submitterEmail: "private@example.com" } }));
	assert.throws(() => parseArtistFiles({ "invalid.json": {} }));
});

test("rejects duplicate IDs and case-insensitive artist identities", () => {
	const artist = artists[0];
	assert.throws(() => parseArtistFiles({ [`a/${artist.id}.json`]: artist, [`b/${artist.id}.json`]: artist }), /Duplicate artist ID/);
	assert.throws(() => parseArtistFiles({ [`${artist.id}.json`]: artist, "another-id.json": { ...artist, id: "another-id", displayName: artist.displayName.toUpperCase() } }), /Duplicate artist name/);
});

test("independent artist additions merge cleanly in either order and retain both profiles", () => {
	const root = mkdtempSync(join(tmpdir(), "artist-merge-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	try {
		git("init", "--initial-branch=staging");
		git("config", "user.name", "Directory Test");
		git("config", "user.email", "test@example.com");
		git("config", "commit.gpgsign", "false");
		git("commit", "--allow-empty", "-m", "Base");
		const base = git("rev-parse", "HEAD").trim();
		for (const id of ["artist-one", "artist-two"]) {
			git("checkout", "-b", id, base);
			mkdirSync(join(root, "src/data/artists"), { recursive: true });
			writeFileSync(join(root, `src/data/artists/${id}.json`), JSON.stringify({ ...artists[0], id, displayName: id }));
			git("add", ".");
			git("commit", "-m", id);
		}
		for (const [first, second] of [["artist-one", "artist-two"], ["artist-two", "artist-one"]]) {
			const tree = git("merge-tree", "--write-tree", first, second).trim();
			const merged = Object.fromEntries([first, second].map((id) => [`${id}.json`, JSON.parse(git("show", `${tree}:src/data/artists/${id}.json`))]));
			assert.equal(parseArtistFiles(merged).length, 2);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
