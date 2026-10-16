# Better Cherri

Original Cherri interface, with saved invite-only chat on the free salix.host Matrix service. Games, music, Show all and repeat-one use the existing Cherri client/services. No server runs on your PC.

Open index.html or Better-Cherri-Launcher.html and click Launch Better Cherri. This opens about:blank and loads app.js from the embedded jsDelivr URL. There are no bookmark installation or file-picker steps.

On first use, create your own free account through https://salix.host/matrix/ using a username and password. No email or phone number is required. Complete its human anti-spam check for a single-use registration token, then register at https://chat.salix.host/#/register. A token expires after 10 minutes and requests are limited to one per hour. Return to Better Cherri, open Chatrooms and sign in with that Matrix account. Your Cherri account is separate. The account owner clicks Create private rooms once, which creates General, Games and Music on Matrix with invitation-only joining, guests forbidden, and history visible to joined members. Existing room IDs are saved so repeated launches use the same community.

Invite members by their full Matrix ID from Invites and community settings. Download community launcher shares the same room configuration, without credentials. Members sign in with their own free accounts and click Accept room invitations once. Room IDs alone do not grant access. Messages remain stored on Matrix after every browser closes.

The original Cherri chat screen supports text, replies, edits, deletion, reactions, typing, member lists and search through the Matrix adapter. Matrix text chat is separate from Cherri's original public rooms and members. Voice, media uploads, polls, original friends/shop/moderation and account/cloud-save services are not implemented by this chat adapter; unsupported operations return an explicit error. This release does not enable end-to-end encryption. Invite-only access controls which accounts can read; the Matrix host can access unencrypted content.

Free hosting is not an unlimited-service guarantee. Matrix service rules and rate limits apply. Salix is a volunteer service with no uptime guarantee; its usage rules are at https://salix.host/terms/. No hosting or subscription was purchased.

The launcher is one click after opening it. Account creation, sign-in, community creation and invitations are one-time onboarding actions; it cannot perform those as an unidentified user.

Verification: mocked Matrix server tests cover server-side private room creation, invitations, persisted history/reload, pagination, text mutations, reactions, numeric event ID collision handling, member isolation, restored-session identity checks, token separation and expired sessions. The actual compiled Cherri route tests preserve its original Chat and Members components. Launcher tests verify synchronous about:blank opening and a classic CDN script. No real Matrix account, private room or chat message was created during development; signed-in end-to-end verification awaits the user's own account.

Source and license: upstream https://github.com/cherriunblocked/svg at commit 685e2094ea73d42f9278e5f7e3df1b1a9f183134. GNU AGPL-3.0 license is retained in LICENSE. All modifications/build scripts are in source/. app.js includes the modified compiled client, dependencies, CSS and catalogs; remaining static assets are pinned to that upstream commit. No upstream signed updater or pop-ad loader is used.

To reproduce: clone that upstream commit into work/cherri; copy source/* into work/; save git show HEAD:b/assets/bundle-i7rlf846.js as work/upstream-bundle.js for tests; run node work/assemble-remote.mjs, node work/build-remote-launcher.mjs --repo work/remote-cherri --chat-provider matrix --out work/matrix-full-launcher.html, then node work/build-matrix-release.mjs. The release script expects a checkout of this repository at work/better-cherri-publish. Use --launcher-only --ref COMMIT_SHA to pin the launcher to an already-published app.js commit. Node.js is only a developer build tool.
