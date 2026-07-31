# Artist data migration notes

Phase 1 normalized the original spreadsheet-shaped records in `directory.json`.

- Stable IDs (`nl-0001` through `nl-0008`) were assigned to the existing Northern
  Lights artists. Placeholder records use `placeholder-0001` through
  `placeholder-0003`. These IDs are deliberately independent of display names.
- `Skills` and `Awards` comma-separated strings became `skills` and `awards`
  arrays. Award values were preserved as written.
- Contact values previously stored in `Member Since` moved to dedicated
  `contact.discord`, `contact.instagram`, or `contact.tiktok` fields.
- Values beginning with `Player Since` became `memberSince`, preserving their
  original wording because the source only identifies a year, not a full date.
- `Placeholder profile` did not describe membership. It is preserved as
  `biography` on the three placeholder records so no source information was
  silently discarded.
- Repository-relative photo values such as
  `webpage/public/photos/Adena_Darkstar.jpg` became public root-relative paths
  such as `/photos/Adena_Darkstar.jpg`, stored in the explicit `photoUrl` field.
- The source contained no public website or Facebook values and no private
  submission metadata. No private metadata fields were added.

No individual artist profile page or artist-slug routing existed at migration
time. The stable `id` field is ready to support that routing in a later phase.
