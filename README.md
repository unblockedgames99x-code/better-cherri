# Better Cherri 3.0 — original Cherri chat

The full app is Better-Cherri.html: one HTML file containing the modified client, CSS and game catalogs. No Node installation or server on your PC is needed. Images, games, music, proxy services and chat still require internet.

Open https://unblockedgames99x-code.github.io/better-cherri/app.html for the full HTML app. The one-button launcher is https://unblockedgames99x-code.github.io/better-cherri/ . Download Better-Cherri-Launcher.html, open it, and click Launch Better Cherri once to request an about:blank tab. That HTML launcher embeds a pinned jsDelivr script URL. Popup restrictions can prevent a blank tab from opening; the full HTML app is the direct alternative.

Chat now uses ordinary Cherri accounts, channels, members, messages, moderation and services at https://cherrion.top. There are no Better-only chat rooms, Matrix/XMPP accounts, owner configuration, invitation setup or custom chat backend in this release. Your regular Cherri account signs in on Cherri's actual page. The original site's permissions and service rules apply.

Chat, Members and account pages load the original Cherri site inside the Better Cherri app. Their forms and requests remain on Cherri's own origin, avoiding the cross-origin sign-in failures of a copied static client. An Open Cherri link opens the same page directly if your browser blocks embedded storage or pages. An existing first-party login may require signing in again inside the embedded page because browsers can partition storage. No account credentials are copied into the launcher or passed through the public game/music proxy transport.

The Better Cherri outer Games and Music pages keep legacy games enabled by default, the Show all filter and repeat-one button. The front-page Discord invitation and inherited signed updater/ad loader remain omitted. Cherri pages displayed inside the embedded original site retain the original site's UI and behavior. No remote chat accounts, rooms or saved messages were deleted during this change.

Verification: guarded source checks and mocked route/fetch tests confirm original native authentication, unfiltered channels/sockets, official-origin embedded account pages, public-only game/music requests, credential stripping and no custom chat adapter. Launcher tests verify synchronous about:blank requests, deferred script loading, document replacement recovery, readiness detection and visible failures. Game catalog/repeat and navigation checks pass. Live checks verify the published HTML/CDN contents and that the actual Cherri account page loads inside the app. No real account credentials were submitted and signed-in message delivery was not tested by the agent.

Source: https://github.com/unblockedgames99x-code/better-cherri . Original project: https://github.com/cherriunblocked/svg at commit 685e2094ea73d42f9278e5f7e3df1b1a9f183134. GNU AGPL-3.0 is retained in LICENSE. Current modification/build/test scripts are in source/. app.html and Better-Cherri.html contain the complete current HTML app; app.js is the CDN mounting wrapper used by the small launcher. Remaining upstream static assets are pinned to that original commit.

To reproduce, clone the original repository at that commit into work/cherri, copy source/* into work/, and save the pristine output of git show HEAD:b/assets/bundle-i7rlf846.js as UTF-8 work/upstream-bundle.js for tests. With Node.js as a developer build tool, run:

    node work/assemble-remote.mjs
    node work/build-standard-app.mjs
    node work/build-matrix-release.mjs

The release builder retains its historical filename but now packages only the standard Cherri build. It expects the publishing checkout at work/better-cherri-publish. After committing the app, use --launcher-only --ref COMMIT_SHA to pin the small HTML launchers to that jsDelivr release. Users only need the HTML file and a browser.
